import {
  attachmentSkipKey,
  emptyReviewState,
  mergeReviewCandidates,
  reviewCounts,
} from '../src/types/review';
import { applyClassificationResult, createScanJob } from '../src/lib/scanPipeline';
import { ScanCandidate } from '../src/types/document';

function cand(
  id: string,
  status: ScanCandidate['status'] = 'pending',
  msg = 'm1',
  att = 'a1',
): ScanCandidate {
  return {
    id,
    gmailMessageId: msg,
    gmailAttachmentId: att,
    subject: 's',
    from: 'f',
    date: '2026-01-01T00:00:00.000Z',
    fileName: `${id}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 1,
    status,
    classification: {
      category: 'Banking',
      title: id,
      metadata: { issuer: 'Bank', documentType: 'Statement' },
      confidence: 0.9,
      isImportantDocument: true,
    },
  };
}

describe('review state merge + skip keys', () => {
  it('builds stable attachment skip keys', () => {
    expect(attachmentSkipKey({ gmailMessageId: 'msg', gmailAttachmentId: 'att' })).toBe(
      'msg::att',
    );
  });

  it('counts to-review / approved / skipped', () => {
    expect(
      reviewCounts([
        cand('1', 'pending'),
        cand('2', 'needs_subject_confirm', 'm2', 'a2'),
        cand('3', 'approved', 'm3', 'a3'),
        cand('4', 'rejected', 'm4', 'a4'),
        cand('5', 'duplicate', 'm5', 'a5'),
      ]),
    ).toEqual({ toReview: 2, approved: 1, skipped: 1 });
  });

  it('applies skipped ids so prior skips win over fresh pending', () => {
    const review = emptyReviewState();
    review.skippedIds = ['m1::a1'];
    review.candidates = [cand('old', 'rejected')];
    const merged = mergeReviewCandidates([cand('fresh', 'pending')], review);
    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe('rejected');
  });

  it('keeps approved status across reload merge', () => {
    const review = emptyReviewState();
    review.candidates = [cand('x', 'approved')];
    const merged = mergeReviewCandidates([cand('x', 'pending')], review);
    expect(merged[0].status).toBe('approved');
  });

  it('retains skipped-only items that are no longer in the incoming scan list', () => {
    const review = emptyReviewState();
    review.candidates = [cand('gone', 'rejected', 'oldMsg', 'oldAtt')];
    review.skippedIds = ['oldMsg::oldAtt'];
    const merged = mergeReviewCandidates([cand('new', 'pending', 'n', 'n')], review);
    expect(merged.map((c) => c.id).sort()).toEqual(['gone', 'new']);
    expect(merged.find((c) => c.id === 'gone')?.status).toBe('rejected');
  });
});

describe('scan pipeline respects skippedAttachmentIds', () => {
  it('marks previously skipped Gmail attachments as rejected (not pending)', () => {
    let state = createScanJob({ mode: 'full' });
    const itemId = 'item1';
    state = {
      ...state,
      items: {
        [itemId]: {
          id: itemId,
          status: 'queued_classify',
          attachment: {
            messageId: 'msgSkip',
            attachmentId: 'attSkip',
            filename: 'stmt.pdf',
            mimeType: 'application/pdf',
            size: 10,
            subject: 'Bank stmt',
            from: 'bank@x.com',
            date: '2026-01-01T00:00:00.000Z',
            snippet: 'statement',
          },
        },
      },
      classifyQueue: [itemId],
    };

    const next = applyClassificationResult(
      state,
      itemId,
      {
        category: 'Banking',
        title: 'Statement',
        metadata: { issuer: 'Bank of Baroda', documentType: 'BankStatement' },
        confidence: 0.9,
        isImportantDocument: true,
      },
      'hash1',
      [],
      new Date().toISOString(),
      { skippedAttachmentIds: ['msgSkip::attSkip'] },
    );

    const candidate = next.candidates.find((c) => c.gmailMessageId === 'msgSkip');
    expect(candidate).toBeTruthy();
    expect(candidate!.status).toBe('rejected');
  });
});
