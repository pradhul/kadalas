import { ClassificationResult, ScanCandidate } from '../types/document';
import {
  applyCoverageMetadata,
  detectCoverageTypeFromText,
  getCoverageSchema,
  resolveSubjectCoverage,
  ScanLikeDoc,
  selectCurrentAndSupersededForSubject,
  VEHICLE_COVERAGE_SCHEMA,
} from './coverageSlots';
import { parseFlexibleDate } from './dates';
import {
  buildGroupId,
  documentTypeFamily,
  resolveSubjectKey,
  applySubjectToMetadata,
} from './subjectKey';

export { parseFlexibleDate } from './dates';

export interface VersionedCandidate extends ScanCandidate {
  rankTimeMs: number;
}

export interface DocumentGroup {
  groupId: string;
  groupLabel: string;
  documentTypeFamily: string;
  subjectKey: string;
  subjectLabel: string;
  subjectAmbiguous: boolean;
  members: VersionedCandidate[];
  /** Highest-ranked member (compat); prefer currentDocs for multi-slot */
  latest: VersionedCandidate;
  older: VersionedCandidate[];
  currentDocs: VersionedCandidate[];
  coverageSummary?: string;
  summary: string;
}

export function versionRankTime(input: {
  metadata?: ClassificationResult['metadata'];
  emailDate?: string;
  classification?: ClassificationResult;
  date?: string;
}): number {
  const meta = input.classification?.metadata ?? input.metadata ?? {};
  const candidates = [meta.expiryDate, meta.renewalDate, meta.issueDate, input.emailDate ?? input.date];
  for (const value of candidates) {
    const ms = parseFlexibleDate(value);
    if (ms != null) return ms;
  }
  return 0;
}

/** Attach subject keys + coverage type from classification / text. */
export function enrichCandidateWithSubject(candidate: ScanCandidate): ScanCandidate {
  if (!candidate.classification) return candidate;

  const hay = [
    candidate.classification.metadata.documentType,
    candidate.classification.metadata.coverageType,
    candidate.classification.title,
    candidate.subject,
    candidate.fileName,
    candidate.previewSnippet,
  ]
    .filter(Boolean)
    .join(' ');

  let metadata = { ...candidate.classification.metadata };
  const family = documentTypeFamily(candidate.classification.category, metadata.documentType);

  if (family === 'vehicle_insurance') {
    const detected =
      detectCoverageTypeFromText(hay) !== 'unknown'
        ? detectCoverageTypeFromText(hay)
        : detectCoverageTypeFromText(metadata.coverageType || metadata.documentType || '');
    metadata = applyCoverageMetadata(metadata, detected === 'unknown' ? 'comprehensive' : detected);
    if (!metadata.documentType || /insurance|policy|document/i.test(metadata.documentType)) {
      metadata.documentType =
        metadata.coverageType === 'od_only'
          ? 'Standalone OD'
          : metadata.coverageType === 'tp_only'
            ? 'Third Party liability'
            : 'Package / comprehensive policy';
    }
  }

  const resolution = resolveSubjectKey({
    category: candidate.classification.category,
    metadata,
    title: candidate.classification.title,
  });
  metadata = applySubjectToMetadata(metadata, resolution);

  const groupId = resolution.subjectKey
    ? buildGroupId(family, resolution.subjectKey)
    : undefined;
  const ambiguous = resolution.ambiguous || !resolution.subjectKey || resolution.confidence < 0.7;

  return {
    ...candidate,
    classification: { ...candidate.classification, metadata },
    groupId,
    groupLabel: buildGroupLabel(resolution.subjectLabel, family, metadata.documentType),
    subjectAmbiguous: ambiguous,
    status: ambiguous && candidate.status === 'pending' ? 'needs_subject_confirm' : candidate.status,
  };
}

export function buildGroupLabel(
  subjectLabel: string | null | undefined,
  family: string,
  documentType?: string,
): string {
  const typeLabel =
    family === 'vehicle_insurance'
      ? 'vehicle insurance'
      : (documentType || family.replace(/_/g, ' ')).toLowerCase();
  if (subjectLabel) return `${subjectLabel} ${typeLabel}`;
  return typeLabel;
}

/**
 * Group candidates by (document type family + subject key).
 * Vehicle insurance uses coverage slots so OD + TP can both be current.
 */
export function groupCandidatesBySubject(candidates: ScanCandidate[]): {
  groups: DocumentGroup[];
  flat: ScanCandidate[];
  ungrouped: ScanCandidate[];
} {
  const enriched = candidates.map(enrichCandidateWithSubject);
  const byGroup = new Map<string, VersionedCandidate[]>();
  const ungrouped: ScanCandidate[] = [];

  for (const c of enriched) {
    if (!c.groupId || c.subjectAmbiguous) {
      ungrouped.push(c);
      continue;
    }
    const ranked: VersionedCandidate = {
      ...c,
      rankTimeMs: versionRankTime({
        classification: c.classification,
        emailDate: c.date,
      }),
    };
    const list = byGroup.get(c.groupId) ?? [];
    list.push(ranked);
    byGroup.set(c.groupId, list);
  }

  const groups: DocumentGroup[] = [];
  const flat: ScanCandidate[] = [];

  for (const [groupId, members] of byGroup) {
    const sorted = [...members].sort((a, b) => b.rankTimeMs - a.rankTimeMs);
    const head = sorted[0];
    const subjectLabel = head.classification?.metadata.subjectLabel || head.groupLabel || groupId;
    const subjectKey = head.classification?.metadata.subjectKey || '';
    const family = documentTypeFamily(
      head.classification?.category,
      head.classification?.metadata.documentType,
    );
    const schema = getCoverageSchema(family);

    let currentDocs: VersionedCandidate[];
    let older: VersionedCandidate[];
    let coverageSummary: string | undefined;
    let summary: string;

    if (schema) {
      const asDocs: ScanLikeDoc[] = members.map((m) => ({
        id: m.id,
        title: m.classification?.title,
        category: m.classification?.category,
        metadata: m.classification?.metadata || {},
        date: m.date,
        fileName: m.fileName,
      }));
      const { currentIds, supersededIds } = selectCurrentAndSupersededForSubject({
        schema,
        documents: asDocs,
      });
      currentDocs = members.filter((m) => currentIds.has(m.id));
      older = members.filter((m) => supersededIds.has(m.id));
      const view = resolveSubjectCoverage({
        subjectKey,
        subjectLabel,
        schema,
        documents: asDocs,
      });
      coverageSummary = view.summary;
      summary =
        older.length > 0
          ? `${view.summary} · ${members.length} policies found, ${older.length} superseded`
          : view.summary;
    } else {
      currentDocs = [sorted[0]];
      older = sorted.slice(1);
      const period = latestPeriodLabel(sorted[0]);
      summary =
        older.length > 0
          ? `${subjectLabel}: ${sorted.length} versions found, keeping ${period}`
          : `${subjectLabel}: latest document`;
    }

    const olderIds = older.map((o) => o.id);
    const currentOut: ScanCandidate[] = currentDocs.map((c) => ({
      ...c,
      isGroupLatest: true,
      groupVersionCount: members.length,
      olderVersionIds: olderIds,
      groupLabel: subjectLabel,
      status: c.status === 'skipped' || c.status === 'duplicate' ? c.status : 'pending',
    }));
    const olderOut: ScanCandidate[] = older.map((o) => ({
      ...o,
      isGroupLatest: false,
      groupVersionCount: members.length,
      groupLabel: subjectLabel,
      status: 'duplicate' as const,
      duplicateOfId: currentOut[0]?.id,
    }));

    const latest = currentOut[0] ? { ...members.find((m) => m.id === currentOut[0].id)!, ...currentOut[0] } : sorted[0];

    groups.push({
      groupId,
      groupLabel: subjectLabel,
      documentTypeFamily: family,
      subjectKey,
      subjectLabel,
      subjectAmbiguous: false,
      members: sorted,
      latest,
      older: older.map((o) => ({
        ...o,
        ...(olderOut.find((x) => x.id === o.id) || {}),
        rankTimeMs: o.rankTimeMs,
      })),
      currentDocs: currentOut.map((c) => ({
        ...members.find((m) => m.id === c.id)!,
        ...c,
        rankTimeMs: members.find((m) => m.id === c.id)!.rankTimeMs,
      })),
      coverageSummary,
      summary,
    });

    flat.push(...currentOut, ...olderOut);
  }

  flat.push(...ungrouped);
  return { groups, flat, ungrouped };
}

function latestPeriodLabel(c: VersionedCandidate): string {
  const meta = c.classification?.metadata ?? {};
  if (meta.expiryDate) {
    const y = meta.expiryDate.slice(0, 4);
    const prev = String(Number(y) - 1);
    return `${prev.slice(2)}-${y.slice(2)}`;
  }
  if (meta.issueDate) return meta.issueDate.slice(0, 4);
  if (c.date) return c.date.slice(0, 4);
  return 'latest';
}

export function selectLatestInGroup(members: ScanCandidate[]): {
  latest: ScanCandidate;
  older: ScanCandidate[];
  currentDocs: ScanCandidate[];
} {
  const { groups } = groupCandidatesBySubject(members);
  if (groups.length === 1) {
    return {
      latest: groups[0].latest,
      older: groups[0].older,
      currentDocs: groups[0].currentDocs,
    };
  }
  const ranked = members
    .map((c) => ({
      ...c,
      rankTimeMs: versionRankTime({ classification: c.classification, emailDate: c.date }),
    }))
    .sort((a, b) => b.rankTimeMs - a.rankTimeMs);
  return { latest: ranked[0], older: ranked.slice(1), currentDocs: ranked.slice(0, 1) };
}

/** UI-friendly grouped review rows for the scan-review screen. */
export function buildGroupedReview(candidates: ScanCandidate[]): Array<{
  id: string;
  title: string;
  subtitle?: string;
  kind: 'subject' | 'ambiguous' | 'ungrouped';
  candidates: ScanCandidate[];
}> {
  const { groups, ungrouped } = groupCandidatesBySubject(candidates);
  const rows: Array<{
    id: string;
    title: string;
    subtitle?: string;
    kind: 'subject' | 'ambiguous' | 'ungrouped';
    candidates: ScanCandidate[];
  }> = [];

  for (const g of groups) {
    rows.push({
      id: g.groupId,
      title: g.subjectLabel,
      subtitle: g.coverageSummary || g.summary,
      kind: 'subject',
      candidates: [...g.currentDocs, ...g.older],
    });
  }

  const ambiguous = ungrouped.filter((c) => c.subjectAmbiguous || c.status === 'needs_subject_confirm');
  const plain = ungrouped.filter((c) => !c.subjectAmbiguous && c.status !== 'needs_subject_confirm');

  if (ambiguous.length) {
    rows.push({
      id: 'ambiguous',
      title: 'Needs subject confirmation',
      subtitle: 'Registration / chassis unclear — confirm before grouping',
      kind: 'ambiguous',
      candidates: ambiguous,
    });
  }
  if (plain.length) {
    rows.push({
      id: 'ungrouped',
      title: 'Other documents',
      kind: 'ungrouped',
      candidates: plain,
    });
  }
  return rows;
}

/** Build vehicle cover views from vault documents. */
export function buildVehicleCoverViews(
  documents: Array<{
    id: string;
    title: string;
    category: string;
    metadata: import('../types/document').DocumentMetadata;
  }>,
  on?: Date,
) {
  const bySubject = new Map<string, typeof documents>();
  for (const doc of documents) {
    if (!doc.category.startsWith('Insurance/Vehicle')) continue;
    const key =
      doc.metadata.subjectKey ||
      resolveSubjectKey({ category: doc.category, metadata: doc.metadata }).subjectKey;
    if (!key) continue;
    const list = bySubject.get(key) ?? [];
    list.push(doc);
    bySubject.set(key, list);
  }

  return [...bySubject.entries()].map(([subjectKey, docs]) => {
    const label = docs[0].metadata.subjectLabel || subjectKey;
    return resolveSubjectCoverage({
      subjectKey,
      subjectLabel: label,
      schema: VEHICLE_COVERAGE_SCHEMA,
      documents: docs,
      on,
    });
  });
}
