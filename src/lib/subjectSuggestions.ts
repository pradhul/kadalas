import { DocumentMetadata, ScanCandidate, VaultDocument } from '../types/document';
import { documentTypeFamily, normalizeIdentifier, normalizeRegistration } from './subjectKey';

/** Mock/demo plates that must never appear as real-vault subject suggestions. */
export const DEMO_VEHICLE_PLATES = ['KA01AB1234', 'MH12XY9876', 'DL01CD4321'] as const;

export const DEMO_VEHICLE_SUBJECT_KEYS = DEMO_VEHICLE_PLATES.map(
  (p) => `vehicle:reg:${p}`,
) as readonly string[];

export function isDemoVehiclePlate(value?: string | null): boolean {
  const n = normalizeRegistration(value);
  return (DEMO_VEHICLE_PLATES as readonly string[]).includes(n);
}

export function isDemoVehicleSubjectKey(key?: string | null): boolean {
  if (!key) return false;
  if ((DEMO_VEHICLE_SUBJECT_KEYS as readonly string[]).includes(key)) return true;
  if (key.startsWith('vehicle:reg:') && isDemoVehiclePlate(key.slice('vehicle:reg:'.length))) {
    return true;
  }
  return false;
}

/** True when the compact identifier appears in the document/email text. */
export function isIdentifierGroundedInText(id: string | null | undefined, text: string): boolean {
  const compact = normalizeIdentifier(id);
  if (!compact || compact.length < 4) return false;
  return normalizeIdentifier(text).includes(compact);
}

export function candidateGroundingText(candidate: {
  subject?: string;
  fileName?: string;
  previewSnippet?: string;
  classification?: { title?: string; metadata?: DocumentMetadata; reason?: string };
}): string {
  const m = candidate.classification?.metadata ?? {};
  return [
    candidate.subject,
    candidate.fileName,
    candidate.previewSnippet,
    candidate.classification?.title,
    candidate.classification?.reason,
    m.issuer,
    m.documentType,
    m.holderName,
    m.referenceNumber,
    m.registrationNumber,
    m.chassisNumber,
    m.notes,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Drop AI-hallucinated vehicle ids that are not present in the document text,
 * and strip known demo plates outside mock mode.
 */
export function sanitizeMetadataAgainstText(
  metadata: DocumentMetadata,
  text: string,
  opts?: { allowDemoPlates?: boolean },
): DocumentMetadata {
  const next = { ...metadata };
  if (next.registrationNumber) {
    const grounded = isIdentifierGroundedInText(next.registrationNumber, text);
    const demo = isDemoVehiclePlate(next.registrationNumber);
    if (!grounded || (demo && !opts?.allowDemoPlates)) {
      delete next.registrationNumber;
    }
  }
  if (next.chassisNumber && !isIdentifierGroundedInText(next.chassisNumber, text)) {
    delete next.chassisNumber;
  }
  if (next.engineNumber && !isIdentifierGroundedInText(next.engineNumber, text)) {
    delete next.engineNumber;
  }
  if (next.subjectKey && isDemoVehicleSubjectKey(next.subjectKey) && !opts?.allowDemoPlates) {
    delete next.subjectKey;
    delete next.subjectLabel;
  }
  return next;
}

export function isVehicleReviewFamily(category?: string, documentType?: string): boolean {
  const family = documentTypeFamily(category, documentType);
  if (family === 'vehicle_insurance') return true;
  const hay = `${category ?? ''} ${documentType ?? ''}`;
  return /vehicle|motor|rc\b|registration certificate|puc|pollution/i.test(hay);
}

export type SubjectSuggestion = {
  key: string;
  label: string;
  kind: 'vault_vehicle' | 'new_vehicle' | 'group';
};

function formatPlateDisplay(compactOrRaw: string): string {
  const raw = compactOrRaw.trim().toUpperCase();
  if (/[-\s]/.test(raw)) return raw.replace(/\s+/g, '-');
  // KA01AB1234 → KA-01-AB-1234 (best-effort Indian plate spacing)
  const m = raw.match(/^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/);
  if (m) return [m[1], m[2], m[3], m[4]].filter(Boolean).join('-');
  return raw;
}

function humanizeToken(token: string): string {
  return token
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** Friendly chip label — never show raw vehicle:reg: / weak: keys. */
export function formatSubjectSuggestionLabel(
  key: string,
  vaultDocs: VaultDocument[] = [],
): string {
  if (key.startsWith('vehicle:reg:')) {
    const plate = formatPlateDisplay(key.slice('vehicle:reg:'.length));
    const inVault = vaultDocs.some((d) => d.metadata.subjectKey === key);
    return inVault ? `Link to vehicle ${plate} (from your vault)` : `New vehicle: ${plate}`;
  }
  if (key.startsWith('vehicle:chassis:')) {
    return `New vehicle: chassis ${key.slice('vehicle:chassis:'.length)}`;
  }
  if (key.startsWith('weak:')) {
    const parts = key.split(':');
    const issuer = humanizeToken(parts[1] || 'account');
    const holder = humanizeToken(parts[2] || '');
    return holder
      ? `Add to: ${issuer} · ${holder} statements`
      : `Add to: ${issuer} statements`;
  }
  if (key.startsWith('account:')) {
    const parts = key.split(':');
    return `Add to: ${humanizeToken(parts[1] || 'account')} · ${parts[2] || 'account'}`;
  }
  if (key.startsWith('person:')) {
    const parts = key.split(':');
    return `Add to: ${humanizeToken(parts[1] || 'person')}`;
  }
  return key;
}

/**
 * Vehicle subject chips: grounded plate from this doc + existing vault vehicles only.
 * Never injects demo plates.
 */
export function buildVehicleSubjectSuggestions(input: {
  metadata: DocumentMetadata;
  groundingText: string;
  vaultDocuments: VaultDocument[];
  allowDemoPlates?: boolean;
}): SubjectSuggestion[] {
  const out: SubjectSuggestion[] = [];
  const seen = new Set<string>();

  const push = (key: string, kind: SubjectSuggestion['kind']) => {
    if (!key || seen.has(key)) return;
    if (!input.allowDemoPlates && isDemoVehicleSubjectKey(key)) return;
    seen.add(key);
    out.push({
      key,
      label: formatSubjectSuggestionLabel(key, input.vaultDocuments),
      kind,
    });
  };

  // Existing vault vehicles
  for (const doc of input.vaultDocuments) {
    const key =
      doc.metadata.subjectKey ||
      (doc.metadata.registrationNumber
        ? `vehicle:reg:${normalizeRegistration(doc.metadata.registrationNumber)}`
        : null);
    if (!key?.startsWith('vehicle:')) continue;
    if (!input.allowDemoPlates && isDemoVehicleSubjectKey(key)) continue;
    push(key, 'vault_vehicle');
  }

  // Grounded registration / chassis from this document
  if (
    input.metadata.registrationNumber &&
    isIdentifierGroundedInText(input.metadata.registrationNumber, input.groundingText)
  ) {
    const key = `vehicle:reg:${normalizeRegistration(input.metadata.registrationNumber)}`;
    push(key, seen.has(key) ? 'vault_vehicle' : 'new_vehicle');
  }
  if (
    input.metadata.chassisNumber &&
    isIdentifierGroundedInText(input.metadata.chassisNumber, input.groundingText)
  ) {
    push(
      `vehicle:chassis:${normalizeIdentifier(input.metadata.chassisNumber)}`,
      'new_vehicle',
    );
  }

  return out;
}

/** Deduplicate review candidates by Gmail attachment identity or content hash. */
export function dedupeScanCandidates(candidates: ScanCandidate[]): ScanCandidate[] {
  const byKey = new Map<string, ScanCandidate>();
  const rank = (c: ScanCandidate) => {
    if (c.status === 'pending' || c.status === 'needs_subject_confirm') return 3;
    if (c.status === 'approved') return 2;
    if (c.status === 'duplicate') return 1;
    return 0;
  };

  for (const c of candidates) {
    const key = c.contentRef
      ? `hash:${c.contentRef}`
      : `att:${c.gmailMessageId}::${c.gmailAttachmentId}`;
    const existing = byKey.get(key);
    if (!existing || rank(c) > rank(existing)) {
      byKey.set(key, c);
    }
  }
  return [...byKey.values()];
}
