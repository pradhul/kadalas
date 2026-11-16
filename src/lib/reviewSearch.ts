import { ScanCandidate } from '../types/document';

/** Case-insensitive match over filename, subject, sender, category, AI summary. */
export function candidateMatchesQuery(c: ScanCandidate, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    c.fileName,
    c.subject,
    c.from,
    c.classification?.category,
    c.categoryOverride,
    c.classification?.title,
    c.classification?.reason,
    c.previewSnippet,
    c.aiDetail?.summary,
    c.aiDetail?.issuer,
    c.aiDetail?.documentType,
    c.groupLabel,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

export function filterCandidatesByQuery(
  candidates: ScanCandidate[],
  query: string,
): ScanCandidate[] {
  const q = query.trim();
  if (!q) return candidates;
  return candidates.filter((c) => candidateMatchesQuery(c, q));
}

export function pendingApprovable(candidates: ScanCandidate[]): ScanCandidate[] {
  return candidates.filter(
    (c) =>
      (c.status === 'pending' || c.status === 'needs_subject_confirm') &&
      c.isGroupLatest !== false,
  );
}
