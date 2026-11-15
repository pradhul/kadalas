import { DocumentMetadata, VaultDocument } from '../types/document';
import { parseFlexibleDate } from './dates';

/** Generic coverage slot — reusable beyond vehicles later. */
export interface CoverageSlotDefinition {
  id: string;
  label: string;
  shortLabel: string;
}

export interface CoverageSchema {
  id: string;
  subjectKind: string;
  slots: CoverageSlotDefinition[];
  /** Which slots a coverage type fills */
  slotsForType: (coverageType: string) => string[];
  normalizeType: (raw?: string | null) => string;
}

export const VEHICLE_SLOTS: CoverageSlotDefinition[] = [
  { id: 'own_damage', label: 'Own Damage (OD)', shortLabel: 'OD' },
  { id: 'third_party', label: 'Third Party (TP)', shortLabel: 'TP' },
];

/** Alias used by vehicle cover UI */
export const VEHICLE_COVERAGE_SLOTS = VEHICLE_SLOTS.map((s) => s.id) as Array<
  'own_damage' | 'third_party'
>;

export function formatCoverageType(raw?: string | null): string {
  const t = normalizeVehicleCoverageType(raw);
  switch (t) {
    case 'comprehensive':
      return 'Package / comprehensive';
    case 'od_only':
      return 'Standalone OD';
    case 'tp_only':
      return 'Third Party / liability only';
    default:
      return raw?.trim() || 'Unknown cover';
  }
}

export type VehicleCoverageType = 'comprehensive' | 'od_only' | 'tp_only' | 'unknown';

/**
 * Recognise Indian motor policy wording:
 * Package / Bundled / Comprehensive → both slots
 * Standalone OD / OD only → own_damage
 * Liability Only / Act Only / TP only / Third Party → third_party
 */
export function normalizeVehicleCoverageType(raw?: string | null): VehicleCoverageType {
  const t = (raw ?? '').toLowerCase().trim().replace(/[_-]+/g, ' ');
  if (!t) return 'unknown';

  // Already-canonical values (after underscore → space: "od only", "tp only")
  if (t === 'comprehensive' || t === 'comp') return 'comprehensive';
  if (t === 'od only' || t === 'od') return 'od_only';
  if (t === 'tp only' || t === 'tp') return 'tp_only';
  if (t === 'unknown') return 'unknown';

  if (
    /comprehensive|package\s*policy|bundled|\bpkg\b|full\s*cover|\bcomp\b/.test(t) &&
    !/stand\s*alone\s*od|od\s*only/.test(t)
  ) {
    return 'comprehensive';
  }
  if (
    /stand\s*alone\s*od|od\s*only|own\s*damage|\bod\b/.test(t) &&
    !/third\s*party|liability|act\s*only|\btp\b/.test(t)
  ) {
    return 'od_only';
  }
  if (
    /third\s*party|liability\s*only|act\s*only|tp\s*only|stand\s*alone\s*tp|\btp\b/.test(t) &&
    !/own\s*damage|comprehensive|package/.test(t)
  ) {
    return 'tp_only';
  }
  // Combined OD+TP wording without "comprehensive"
  if (/own\s*damage/.test(t) && /third\s*party|liability/.test(t)) {
    return 'comprehensive';
  }
  return 'unknown';
}

export function vehicleSlotsForType(coverageType: string): string[] {
  const t = normalizeVehicleCoverageType(coverageType);
  if (t === 'comprehensive') return ['own_damage', 'third_party'];
  if (t === 'od_only') return ['own_damage'];
  if (t === 'tp_only') return ['third_party'];
  // Unknown vehicle insurance — treat as comprehensive so we don't drop cover silently
  return ['own_damage', 'third_party'];
}

export const VEHICLE_COVERAGE_SCHEMA: CoverageSchema = {
  id: 'vehicle_insurance',
  subjectKind: 'vehicle',
  slots: VEHICLE_SLOTS,
  slotsForType: vehicleSlotsForType,
  normalizeType: (raw) => normalizeVehicleCoverageType(raw),
};

const SCHEMAS: Record<string, CoverageSchema> = {
  vehicle_insurance: VEHICLE_COVERAGE_SCHEMA,
};

export function getCoverageSchema(family: string): CoverageSchema | null {
  return SCHEMAS[family] ?? null;
}

export function detectCoverageTypeFromText(haystack: string): VehicleCoverageType {
  return normalizeVehicleCoverageType(haystack);
}

export function applyCoverageMetadata(
  metadata: DocumentMetadata,
  coverageType: VehicleCoverageType | string,
  schema: CoverageSchema = VEHICLE_COVERAGE_SCHEMA,
): DocumentMetadata {
  const normalized = schema.normalizeType(coverageType);
  const slots = schema.slotsForType(normalized);
  return {
    ...metadata,
    coverageType: normalized,
    coverageSlots: slots.join(','),
  };
}

export interface SlotDocumentRef {
  slotId: string;
  document: VaultDocument | ScanLikeDoc;
  coverageType: string;
  active: boolean;
  periodEnd?: string;
  periodStart?: string;
  insurer?: string;
}

export interface SubjectCoverageView {
  subjectKey: string;
  subjectLabel: string;
  schemaId: string;
  slots: Array<{
    slot: CoverageSlotDefinition;
    current: SlotDocumentRef | null;
    superseded: Array<VaultDocument | ScanLikeDoc>;
    gap: boolean;
    expiringSoon: boolean;
    daysLeft: number | null;
  }>;
  summary: string;
}

/** Minimal shape used when grouping scan candidates before vault save. */
export interface ScanLikeDoc {
  id: string;
  title?: string;
  category?: string;
  metadata: DocumentMetadata;
  date?: string; // email date
  fileName?: string;
}

function periodBounds(meta: DocumentMetadata): { start: number | null; end: number | null } {
  const start = parseFlexibleDate(meta.policyStartDate || meta.issueDate);
  const end = parseFlexibleDate(meta.expiryDate || meta.renewalDate);
  return { start, end };
}

export function isActiveOnDate(meta: DocumentMetadata, on: Date = new Date()): boolean {
  const { start, end } = periodBounds(meta);
  const t = Date.UTC(on.getUTCFullYear(), on.getUTCMonth(), on.getUTCDate());
  if (end != null && t > end) return false;
  if (start != null && t < start) return false;
  // If we only have an end date in the future (or today), treat as active
  if (end != null && t <= end) return true;
  if (start != null && end == null) return t >= start;
  return false;
}

/**
 * Prefer policies active on `on`. Among active ones, prefer the newest start/issue
 * (so a new comprehensive supersedes an older long-term TP). End date is a
 * tie-breaker only — farthest expiry must not beat a newer overlapping policy.
 */
function rankForSlot(doc: VaultDocument | ScanLikeDoc, on: Date): number {
  const meta = doc.metadata;
  const activeBoost = isActiveOnDate(meta, on) ? 1e15 : 0;
  const start = parseFlexibleDate(meta.policyStartDate || meta.issueDate) ?? 0;
  const end = parseFlexibleDate(meta.expiryDate || meta.renewalDate) ?? 0;
  const email = parseFlexibleDate('date' in doc ? doc.date : undefined) ?? 0;
  // start weighted above end so newer OD/comp beat older long-term TP when both active
  return activeBoost + start * 1e6 + end + email / 1e10;
}

function docFillsSlot(doc: VaultDocument | ScanLikeDoc, slotId: string, schema: CoverageSchema): boolean {
  const type = schema.normalizeType(doc.metadata.coverageType || doc.metadata.documentType);
  const slots =
    doc.metadata.coverageSlots?.split(',').map((s) => s.trim()).filter(Boolean) ??
    schema.slotsForType(type);
  return slots.includes(slotId);
}

/**
 * For each coverage slot under a subject, pick the current document:
 * prefer a policy whose period covers `on`, else the most recent by end/issue/email.
 * Comprehensive fills both slots; OD-only does not displace an active long-term TP.
 */
export function resolveSubjectCoverage(input: {
  subjectKey: string;
  subjectLabel: string;
  schema: CoverageSchema;
  documents: Array<VaultDocument | ScanLikeDoc>;
  on?: Date;
  expiringWithinDays?: number;
}): SubjectCoverageView {
  const on = input.on ?? new Date();
  const within = input.expiringWithinDays ?? 60;
  const slots = input.schema.slots.map((slot) => {
    const candidates = input.documents.filter((d) => docFillsSlot(d, slot.id, input.schema));
    const sorted = [...candidates].sort((a, b) => rankForSlot(b, on) - rankForSlot(a, on));
    const current = sorted[0] ?? null;
    const superseded = sorted.slice(1);
    const active = current ? isActiveOnDate(current.metadata, on) : false;
    const periodEnd = current?.metadata.expiryDate || current?.metadata.renewalDate;
    const endMs = parseFlexibleDate(periodEnd);
    const daysLeft =
      endMs != null
        ? Math.ceil((endMs - Date.UTC(on.getUTCFullYear(), on.getUTCMonth(), on.getUTCDate())) / 86400000)
        : null;
    const gap = !current || !active;
    const expiringSoon = daysLeft != null && daysLeft <= within;

    const ref: SlotDocumentRef | null = current
      ? {
          slotId: slot.id,
          document: current,
          coverageType: input.schema.normalizeType(current.metadata.coverageType || current.metadata.documentType),
          active,
          periodEnd,
          periodStart: current.metadata.policyStartDate || current.metadata.issueDate,
          insurer: current.metadata.issuer,
        }
      : null;

    return { slot, current: ref, superseded, gap, expiringSoon, daysLeft };
  });

  const parts = slots.map((s) => {
    if (!s.current) return `${s.slot.shortLabel} uncovered`;
    const until = s.current.periodEnd
      ? formatMonthYear(s.current.periodEnd)
      : 'unknown date';
    const insurer = s.current.insurer || 'Unknown insurer';
    const status = s.current.active ? 'covered by' : 'last policy from';
    return `${s.slot.shortLabel} ${status} ${insurer} until ${until}`;
  });

  return {
    subjectKey: input.subjectKey,
    subjectLabel: input.subjectLabel,
    schemaId: input.schema.id,
    slots,
    summary: `${input.subjectLabel}: ${parts.join(', ')}`,
  };
}

/**
 * Given a set of policies for one vehicle, decide which docs are "current"
 * (one per slot — same comprehensive doc may occupy both) vs superseded.
 */
export function selectCurrentAndSupersededForSubject(input: {
  schema: CoverageSchema;
  documents: Array<VaultDocument | ScanLikeDoc>;
  on?: Date;
}): {
  currentIds: Set<string>;
  supersededIds: Set<string>;
  currentBySlot: Record<string, string>;
} {
  const view = resolveSubjectCoverage({
    subjectKey: 'tmp',
    subjectLabel: 'tmp',
    schema: input.schema,
    documents: input.documents,
    on: input.on,
  });
  const currentIds = new Set<string>();
  const currentBySlot: Record<string, string> = {};
  for (const s of view.slots) {
    if (s.current) {
      currentIds.add(s.current.document.id);
      currentBySlot[s.slot.id] = s.current.document.id;
    }
  }
  const supersededIds = new Set<string>();
  for (const d of input.documents) {
    if (!currentIds.has(d.id)) supersededIds.add(d.id);
  }
  return { currentIds, supersededIds, currentBySlot };
}

function formatMonthYear(iso: string): string {
  const ms = parseFlexibleDate(iso);
  if (ms == null) return iso;
  const d = new Date(ms);
  return d.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Expiring / gap items for the Expiring soon view. */
export function collectCoverageExpiryAlerts(
  views: SubjectCoverageView[],
  withinDays: number,
): Array<{
  subjectLabel: string;
  subjectKey: string;
  slotId: string;
  slotLabel: string;
  kind: 'gap' | 'expiry';
  daysLeft: number | null;
  insurer?: string;
  documentId?: string;
  date?: string;
}> {
  const out: Array<{
    subjectLabel: string;
    subjectKey: string;
    slotId: string;
    slotLabel: string;
    kind: 'gap' | 'expiry';
    daysLeft: number | null;
    insurer?: string;
    documentId?: string;
    date?: string;
  }> = [];

  for (const view of views) {
    for (const s of view.slots) {
      if (s.gap) {
        out.push({
          subjectLabel: view.subjectLabel,
          subjectKey: view.subjectKey,
          slotId: s.slot.id,
          slotLabel: s.slot.shortLabel,
          kind: 'gap',
          daysLeft: s.daysLeft,
          insurer: s.current?.insurer,
          documentId: s.current?.document.id,
          date: s.current?.periodEnd,
        });
      } else if (s.expiringSoon && s.daysLeft != null && s.daysLeft <= withinDays) {
        out.push({
          subjectLabel: view.subjectLabel,
          subjectKey: view.subjectKey,
          slotId: s.slot.id,
          slotLabel: s.slot.shortLabel,
          kind: 'expiry',
          daysLeft: s.daysLeft,
          insurer: s.current?.insurer,
          documentId: s.current?.document.id,
          date: s.current?.periodEnd,
        });
      }
    }
  }
  return out.sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));
}
