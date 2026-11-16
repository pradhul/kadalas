import { DECORATION_SKIP_LABEL, isPendingDecorationCandidate } from './attachmentFilter';
import { ScanCandidate } from '../types/document';
import { attachmentSkipKey } from '../types/review';

/** Move pending decoration-like review items into the skipped bucket. */
export function autoSkipDecorationCandidates(candidates: ScanCandidate[]): {
  candidates: ScanCandidate[];
  skippedIds: string[];
  changedIds: string[];
} {
  const changedIds: string[] = [];
  const skippedIds: string[] = [];
  const next = candidates.map((c) => {
    if (!isPendingDecorationCandidate(c)) return c;
    changedIds.push(c.id);
    skippedIds.push(attachmentSkipKey(c));
    return {
      ...c,
      status: 'rejected' as const,
      skipReason: DECORATION_SKIP_LABEL,
      saveError: undefined,
    };
  });
  return { candidates: next, skippedIds, changedIds };
}
