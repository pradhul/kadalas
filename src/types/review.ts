import { ScanCandidate } from './document';

/** Drive file under the Kadalas vault root — overwrite only, never delete. */
export const REVIEW_STATE_FILENAME = 'review-state.json';

export type ReviewState = {
  version: 1;
  updatedAt: string;
  /** Full review queue (pending / approved / rejected / duplicate). */
  candidates: ScanCandidate[];
  /**
   * Stable Gmail attachment keys that must never reappear in future scans.
   * Format: `${gmailMessageId}::${gmailAttachmentId}`
   */
  skippedIds: string[];
  /** Last successful write to Drive (ISO). */
  lastSyncedAt: string | null;
};

export function emptyReviewState(nowIso = new Date().toISOString()): ReviewState {
  return {
    version: 1,
    updatedAt: nowIso,
    candidates: [],
    skippedIds: [],
    lastSyncedAt: null,
  };
}

export function attachmentSkipKey(c: {
  gmailMessageId: string;
  gmailAttachmentId: string;
}): string {
  return `${c.gmailMessageId}::${c.gmailAttachmentId}`;
}

/** Merge engine/scan candidates with persisted review decisions. */
export function mergeReviewCandidates(
  incoming: ScanCandidate[],
  review: ReviewState,
): ScanCandidate[] {
  const skipped = new Set(review.skippedIds);
  const priorByKey = new Map(
    review.candidates.map((c) => [attachmentSkipKey(c), c] as const),
  );
  const seen = new Set<string>();
  const out: ScanCandidate[] = [];

  for (const c of incoming) {
    const key = attachmentSkipKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    const prior = priorByKey.get(key);
    if (skipped.has(key) || prior?.status === 'rejected') {
      out.push({ ...c, ...(prior || {}), status: 'rejected' });
      continue;
    }
    if (prior?.status === 'approved') {
      out.push({ ...c, ...prior, status: 'approved' });
      continue;
    }
    out.push(c);
  }

  // Keep prior rejected/approved that are no longer in the incoming scan list
  for (const c of review.candidates) {
    const key = attachmentSkipKey(c);
    if (seen.has(key)) continue;
    if (c.status === 'rejected' || c.status === 'approved') {
      seen.add(key);
      out.push(c);
    }
  }

  return out;
}

export function reviewCounts(candidates: ScanCandidate[]): {
  toReview: number;
  approved: number;
  skipped: number;
} {
  let toReview = 0;
  let approved = 0;
  let skipped = 0;
  for (const c of candidates) {
    if (c.status === 'pending' || c.status === 'needs_subject_confirm') toReview += 1;
    else if (c.status === 'approved') approved += 1;
    else if (c.status === 'rejected') skipped += 1;
  }
  return { toReview, approved, skipped };
}
