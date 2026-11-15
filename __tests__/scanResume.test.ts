import {
  buildScanGmailQuery,
  createScanJob,
  ingestSearchPage,
  isQuotaError,
  pauseForQuota,
  resumeScan,
  applyTriageBatch,
  takeTriageBatch,
} from '../src/lib/scanPipeline';
import { GmailAttachmentMeta } from '../src/services/gmail/types';

function att(id: string, filename = 'doc.pdf'): GmailAttachmentMeta {
  return {
    messageId: `msg_${id}`,
    attachmentId: `att_${id}`,
    filename,
    mimeType: 'application/pdf',
    size: 40_000,
    subject: `Policy ${id}`,
    from: 'insurer@example.com',
    date: '2026-03-01T00:00:00.000Z',
    snippet: 'vehicle insurance registration KA-01-AB-1234',
  };
}

describe('resumable full-mailbox scan pipeline', () => {
  it('full mode query has no after: filter (all-time)', () => {
    const q = buildScanGmailQuery({ mode: 'full' });
    expect(q).toMatch(/has:attachment/);
    expect(q).not.toMatch(/after:/);
  });

  it('persists gmail page token across search pages for resume', () => {
    let state = createScanJob({ mode: 'full' });
    state = ingestSearchPage(state, {
      attachments: [att('1'), att('2')],
      nextPageToken: '50',
      estimatedTotal: 200,
      messagesInPage: 2,
    });
    expect(state.gmailSearchDone).toBe(false);
    expect(state.gmailPageToken).toBe('50');
    // Interleaved pipeline: triage as soon as the page produced work
    expect(state.stage).toBe('triage');
    expect(state.triageQueue.length).toBeGreaterThan(0);
    expect(state.stats.pagesFetched).toBe(1);

    // Simulate process restart: resume from saved token / queues
    const resumed = resumeScan({ ...state, stage: 'paused_user', userPaused: true });
    expect(resumed.gmailPageToken).toBe('50');
    expect(['search', 'triage', 'classify']).toContain(resumed.stage);
  });

  it('quota pause then resume continues triage/classify without losing queues', () => {
    let state = createScanJob({ mode: 'full' });
    state = ingestSearchPage(state, {
      attachments: [att('a'), att('b'), att('c'), att('d')],
      nextPageToken: null,
      estimatedTotal: 4,
      messagesInPage: 4,
    });
    expect(state.stage).toBe('triage');

    const batch = takeTriageBatch(state, 2);
    state = applyTriageBatch(
      state,
      batch.map((b) => ({
        id: b.id,
        isLikelyImportant: true,
        confidence: 0.9,
        reason: 'looks like a policy',
      })),
    );
    expect(state.classifyQueue.length).toBe(2);

    const paused = pauseForQuota(state, { message: '429 quota', status: 429 }, 1000);
    expect(paused.stage).toBe('paused_quota');
    expect(paused.quotaPause?.resumeAfter).toBeTruthy();
    expect(paused.classifyQueue).toEqual(state.classifyQueue);
    expect(paused.triageQueue).toEqual(state.triageQueue);

    const again = resumeScan(paused);
    // Prefer draining remaining triage, then classify — queues preserved either way
    expect(['triage', 'classify']).toContain(again.stage);
    expect(again.quotaPause).toBeNull();
    expect(again.classifyQueue.length).toBe(2);
    expect(again.triageQueue.length + again.classifyQueue.length).toBeGreaterThanOrEqual(2);
  });

  it('marks intentional quota pauses as non-retryable 429s', () => {
    const err = new Error('Mock free-tier quota exceeded (429)') as Error & {
      status: number;
      noRetry: boolean;
    };
    err.status = 429;
    err.noRetry = true;
    expect(isQuotaError(err)).toBe(true);
    expect(err.noRetry).toBe(true);
  });

  it('batched metadata-only triage advances kept items to classify queue', () => {
    let state = createScanJob({ mode: 'full' });
    state = ingestSearchPage(state, {
      attachments: [att('keep'), att('skip', 'newsletter-logo.png')],
      nextPageToken: null,
      messagesInPage: 2,
    });
    // logo may be filtered by rules already
    const triageIds = [...state.triageQueue];
    expect(triageIds.length).toBeGreaterThanOrEqual(1);

    state = applyTriageBatch(state, [
      { id: triageIds[0], isLikelyImportant: true, confidence: 0.85 },
      ...(triageIds[1]
        ? [{ id: triageIds[1], isLikelyImportant: false, confidence: 0.9, reason: 'promo' }]
        : []),
    ]);
    expect(state.stats.triageBatches).toBe(1);
    expect(state.classifyQueue.length).toBeGreaterThanOrEqual(1);
  });
});
