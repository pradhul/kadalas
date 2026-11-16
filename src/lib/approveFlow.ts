import { ScanCandidate, VaultDocument } from '../types/document';

export type ApproveSuccess = {
  candidateId: string;
  folderPath: string;
  fileName: string;
  driveFileId: string;
  webViewLink?: string;
};

export type ApproveFailure = {
  candidateId: string;
  reason: string;
};

export type ApproveFlowResult = {
  candidates: ScanCandidate[];
  saved: ApproveSuccess[];
  failed: ApproveFailure[];
};

export type SavedVaultFile = {
  category: string;
  title: string;
  driveFileId: string;
  webViewLink?: string;
};

const APPROVABLE = new Set(['pending', 'needs_subject_confirm']);

/** Pick candidates that should be uploaded for the given ids. */
export function selectCandidatesToApprove(
  candidates: ScanCandidate[],
  ids: string[],
): { toSave: ScanCandidate[]; emptyReason: string | null } {
  const wanted = new Set(ids);
  const primary = candidates.filter(
    (c) =>
      wanted.has(c.id) &&
      APPROVABLE.has(c.status) &&
      c.isGroupLatest !== false,
  );
  if (primary.length) return { toSave: primary, emptyReason: null };

  // Fallback: same ids still pending/needs_subject (ignore isGroupLatest only if explicitly pending)
  const fallback = candidates.filter(
    (c) => wanted.has(c.id) && APPROVABLE.has(c.status),
  );
  if (fallback.length) return { toSave: fallback, emptyReason: null };

  const found = candidates.filter((c) => wanted.has(c.id));
  if (!found.length) {
    return {
      toSave: [],
      emptyReason: 'Could not find that item in the review queue (stale id). Pull to refresh and try again.',
    };
  }
  const statuses = found.map((c) => `${c.fileName}:${c.status}`).join(', ');
  return {
    toSave: [],
    emptyReason: `Nothing to upload — item is not pending (${statuses}).`,
  };
}

/**
 * Upload each selected candidate. Only mark a candidate `approved` when save()
 * returns a Drive file id. Failures stay pending with saveError set.
 */
export async function runApproveFlow(input: {
  ids: string[];
  candidates: ScanCandidate[];
  subjectOverrides?: Record<string, string>;
  applySubjectOverride: (c: ScanCandidate, key: string) => ScanCandidate;
  save: (c: ScanCandidate) => Promise<SavedVaultFile>;
}): Promise<ApproveFlowResult> {
  const { toSave, emptyReason } = selectCandidatesToApprove(input.candidates, input.ids);
  if (!toSave.length) {
    return {
      candidates: input.candidates.map((c) =>
        input.ids.includes(c.id)
          ? { ...c, saveError: emptyReason ?? 'Nothing to save to Drive' }
          : c,
      ),
      saved: [],
      failed: input.ids.map((id) => ({
        candidateId: id,
        reason: emptyReason ?? 'Nothing to save to Drive',
      })),
    };
  }

  const saved: ApproveSuccess[] = [];
  const failed: ApproveFailure[] = [];
  const byId = new Map<string, ScanCandidate>();

  for (const raw of toSave) {
    const overrideKey = input.subjectOverrides?.[raw.id];
    const candidate = overrideKey
      ? input.applySubjectOverride(raw, overrideKey)
      : raw;
    try {
      const file = await input.save(candidate);
      if (!file.driveFileId) {
        throw new Error('Drive upload returned no file id');
      }
      saved.push({
        candidateId: raw.id,
        folderPath: `Kadalas/${file.category}`,
        fileName: file.title || candidate.fileName,
        driveFileId: file.driveFileId,
        webViewLink: file.webViewLink,
      });
      byId.set(raw.id, {
        ...candidate,
        status: 'approved',
        saveError: undefined,
        driveFileId: file.driveFileId,
        driveWebViewLink: file.webViewLink,
      });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      failed.push({ candidateId: raw.id, reason });
      byId.set(raw.id, {
        ...candidate,
        status: candidate.status === 'needs_subject_confirm' ? 'needs_subject_confirm' : 'pending',
        saveError: reason,
      });
    }
  }

  const savedIds = new Set(saved.map((s) => s.candidateId));
  const candidates = input.candidates.map((c) => {
    if (byId.has(c.id)) return byId.get(c.id)!;
    // Older duplicates of a successfully approved current doc → mark approved too
    if (c.duplicateOfId && savedIds.has(c.duplicateOfId)) {
      return { ...c, status: 'approved' as const, saveError: undefined };
    }
    return c;
  });

  return { candidates, saved, failed };
}

/** Roll back false approvals that never landed a Drive file / vault doc. */
export function reclaimFalseApprovals(
  candidates: ScanCandidate[],
  vaultDocs: VaultDocument[],
): { candidates: ScanCandidate[]; reclaimedIds: string[] } {
  const reclaimedIds: string[] = [];
  const next = candidates.map((c) => {
    if (c.status !== 'approved') return c;
    const hasVault = vaultDocs.some((d) =>
      d.versions.some(
        (v) =>
          (v.gmailMessageId &&
            v.gmailAttachmentId &&
            v.gmailMessageId === c.gmailMessageId &&
            v.gmailAttachmentId === c.gmailAttachmentId) ||
          (Boolean(c.driveFileId) && v.driveFileId === c.driveFileId) ||
          (Boolean(c.contentRef) && v.hash === c.contentRef),
      ),
    );
    if (hasVault || c.driveFileId) return c;
    reclaimedIds.push(c.id);
    return {
      ...c,
      status: 'pending' as const,
      saveError: 'Previously marked approved but no Drive file was found — tap Approve to save again.',
    };
  });
  return { candidates: next, reclaimedIds };
}

export function destinationFolderPath(category?: string): string {
  return `Kadalas/${category || 'Other'}`;
}
