import {
  reclaimFalseApprovals,
  runApproveFlow,
  selectCandidatesToApprove,
} from '../src/lib/approveFlow';
import { ScanCandidate, VaultDocument } from '../src/types/document';

function cand(
  id: string,
  status: ScanCandidate['status'] = 'pending',
  extras: Partial<ScanCandidate> = {},
): ScanCandidate {
  return {
    id,
    gmailMessageId: `msg_${id}`,
    gmailAttachmentId: `att_${id}`,
    subject: 's',
    from: 'f',
    date: '2026-01-01T00:00:00.000Z',
    fileName: `${id}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 10,
    status,
    classification: {
      category: 'Insurance/Health',
      title: id,
      metadata: { issuer: 'Medi', documentType: 'Policy' },
      confidence: 0.9,
      isImportantDocument: true,
    },
    ...extras,
  };
}

describe('selectCandidatesToApprove', () => {
  it('selects pending items', () => {
    const { toSave, emptyReason } = selectCandidatesToApprove(
      [cand('a'), cand('b', 'rejected')],
      ['a'],
    );
    expect(toSave.map((c) => c.id)).toEqual(['a']);
    expect(emptyReason).toBeNull();
  });

  it('returns emptyReason when nothing is pending', () => {
    const { toSave, emptyReason } = selectCandidatesToApprove(
      [cand('a', 'approved')],
      ['a'],
    );
    expect(toSave).toHaveLength(0);
    expect(emptyReason).toMatch(/not pending/i);
  });
});

describe('runApproveFlow', () => {
  it('does not mark approved when save fails', async () => {
    const candidates = [cand('x')];
    const result = await runApproveFlow({
      ids: ['x'],
      candidates,
      applySubjectOverride: (c) => c,
      save: async () => {
        throw new Error('Drive API 403: insufficient permissions');
      },
    });
    expect(result.saved).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toMatch(/403/);
    expect(result.candidates[0].status).toBe('pending');
    expect(result.candidates[0].saveError).toMatch(/403/);
  });

  it('does not mark approved when selection is empty', async () => {
    const candidates = [cand('x', 'approved')];
    const save = jest.fn();
    const result = await runApproveFlow({
      ids: ['x'],
      candidates,
      applySubjectOverride: (c) => c,
      save,
    });
    expect(save).not.toHaveBeenCalled();
    expect(result.saved).toHaveLength(0);
    expect(result.failed[0].reason).toMatch(/not pending|Nothing/i);
    expect(result.candidates[0].status).toBe('approved'); // unchanged prior status
    expect(result.candidates[0].saveError).toBeTruthy();
  });

  it('marks approved only after Drive file id is returned, with correct category folder', async () => {
    const candidates = [cand('ok')];
    const save = jest.fn(async (c: ScanCandidate) => ({
      category: c.classification!.category,
      title: c.classification!.title,
      driveFileId: 'drive_file_123',
      webViewLink: 'https://drive.google.com/file/d/drive_file_123/view',
      storageKind: 'drive_copy' as const,
    }));
    const result = await runApproveFlow({
      ids: ['ok'],
      candidates,
      applySubjectOverride: (c) => c,
      save,
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].classification?.category).toBe('Insurance/Health');
    expect(result.saved).toHaveLength(1);
    expect(result.saved[0].driveFileId).toBe('drive_file_123');
    expect(result.saved[0].folderPath).toBe('Kadalas/Insurance/Health');
    expect(result.saved[0].webViewLink).toContain('drive_file_123');
    expect(result.saved[0].message).toMatch(/Saved to your Google Drive/i);
    expect(result.candidates[0].status).toBe('approved');
    expect(result.candidates[0].driveFileId).toBe('drive_file_123');
    expect(result.failed).toHaveLength(0);
  });

  it('approves gmail_index saves without a Drive file id', async () => {
    const result = await runApproveFlow({
      ids: ['x'],
      candidates: [cand('x')],
      applySubjectOverride: (c) => c,
      save: async () => ({
        category: 'Banking',
        title: 'x',
        driveFileId: '',
        storageKind: 'gmail_index',
      }),
    });
    expect(result.saved).toHaveLength(1);
    expect(result.saved[0].storageKind).toBe('gmail_index');
    expect(result.saved[0].message).toBe('Saved to your vault');
    expect(result.candidates[0].status).toBe('approved');
    expect(result.failed).toHaveLength(0);
  });

  it('rejects drive_copy uploads that return no file id', async () => {
    const result = await runApproveFlow({
      ids: ['x'],
      candidates: [cand('x')],
      applySubjectOverride: (c) => c,
      save: async () => ({
        category: 'Banking',
        title: 'x',
        driveFileId: '',
        storageKind: 'drive_copy',
      }),
    });
    expect(result.saved).toHaveLength(0);
    expect(result.candidates[0].status).toBe('pending');
    expect(result.failed[0].reason).toMatch(/no file id/i);
  });
});

describe('reclaimFalseApprovals', () => {
  it('returns false approvals without vault Drive files to pending', () => {
    const { candidates, reclaimedIds } = reclaimFalseApprovals(
      [cand('fake', 'approved'), cand('real', 'approved', { driveFileId: 'f1' })],
      [],
    );
    expect(reclaimedIds).toEqual(['fake']);
    expect(candidates.find((c) => c.id === 'fake')?.status).toBe('pending');
    expect(candidates.find((c) => c.id === 'real')?.status).toBe('approved');
  });

  it('keeps approvals that match a vault document version', () => {
    const docs: VaultDocument[] = [
      {
        id: 'd1',
        title: 'x',
        category: 'Banking',
        metadata: {},
        currentVersionId: 'v1',
        versions: [
          {
            id: 'v1',
            driveFileId: 'df',
            fileName: 'x.pdf',
            mimeType: 'application/pdf',
            hash: 'h',
            sizeBytes: 1,
            createdAt: '2026-01-01T00:00:00.000Z',
            source: 'gmail',
            gmailMessageId: 'msg_x',
            gmailAttachmentId: 'att_x',
          },
        ],
        driveFolderPath: 'Banking',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    const { reclaimedIds, candidates } = reclaimFalseApprovals(
      [cand('x', 'approved')],
      docs,
    );
    expect(reclaimedIds).toHaveLength(0);
    expect(candidates[0].status).toBe('approved');
  });
});
