import {
  applyClassificationResult,
  applyTriageBatch,
  estimateRemaining,
  ingestSearchPage,
  takeTriageBatch,
  createScanJob,
} from '../src/lib/scanPipeline';
import { slimScanStateForPersist } from '../src/lib/scanPersistSlim';
import { RULE_TRIAGE_DOC_KEYWORDS, ruleTriage } from '../src/lib/ruleTriage';
import { GmailAttachmentMeta } from '../src/services/gmail/types';

function att(id: string, opts?: Partial<GmailAttachmentMeta>): GmailAttachmentMeta {
  return {
    messageId: `msg_${id}`,
    attachmentId: `att_${id}`,
    filename: opts?.filename ?? 'policy.pdf',
    mimeType: 'application/pdf',
    size: 40_000,
    subject: opts?.subject ?? `Vehicle insurance renewal ${id}`,
    from: opts?.from ?? 'insurer@example.com',
    date: '2026-03-01T00:00:00.000Z',
    snippet: opts?.snippet ?? 'policy renewal registration KA-01-AB-1234',
    ...opts,
  };
}

describe('interleaved search → triage', () => {
  it('switches to triage after page 1 even when more pages remain', () => {
    let state = createScanJob({ mode: 'full' });
    state = ingestSearchPage(state, {
      attachments: [att('1'), att('2')],
      nextPageToken: 'page2',
      estimatedTotal: 201,
      messagesInPage: 2,
    });
    expect(state.gmailSearchDone).toBe(false);
    expect(state.stage).toBe('triage');
    expect(state.triageQueue.length).toBe(2);
  });

  it('can produce documentsFound > 0 before mailbox search finishes', () => {
    let state = createScanJob({ mode: 'full' });
    state = ingestSearchPage(state, {
      attachments: [att('keep')],
      nextPageToken: 'more',
      estimatedTotal: 500,
      messagesInPage: 1,
    });
    const batch = takeTriageBatch(state, 10);
    state = applyTriageBatch(
      state,
      batch.map((b) => ({ id: b.id, isLikelyImportant: true, confidence: 0.9 })),
    );
    expect(state.stage).toBe('classify');
    expect(state.classifyQueue.length).toBe(1);

    const itemId = state.classifyQueue[0];
    state = applyClassificationResult(
      state,
      itemId,
      {
        category: 'Insurance/Vehicle',
        title: 'OD policy',
        confidence: 0.9,
        isImportantDocument: true,
        metadata: { registrationNumber: 'KA-01-AB-1234', documentType: 'policy' },
      },
      'hash1',
      [],
    );
    expect(state.stats.documentsFound).toBeGreaterThan(0);
    expect(state.gmailSearchDone).toBe(false);
  });
});

describe('estimateRemaining', () => {
  it('is stage-weighted, never shrinks, and shows about N', () => {
    let state = createScanJob({ mode: 'full' });
    state = ingestSearchPage(state, {
      attachments: [att('1')],
      nextPageToken: 't',
      estimatedTotal: 201,
      messagesInPage: 50,
    });
    // Simulate more checked than estimate (Gmail under-report)
    state = {
      ...state,
      stats: { ...state.stats, emailsChecked: 400, emailsEstimatedTotal: 400, progressHighWater: 30 },
    };
    const est1 = estimateRemaining(state);
    expect(est1.percent).toBeGreaterThanOrEqual(30);
    expect(est1.label).toMatch(/about 400/i);

    state = {
      ...state,
      stage: 'classify',
      stats: { ...state.stats, progressHighWater: 85, classifyCalls: 5 },
      classifyQueue: ['a', 'b'],
    };
    const est2 = estimateRemaining(state);
    expect(est2.percent).toBeGreaterThanOrEqual(85);
    expect(est2.percent).toBeLessThan(100);
  });
});

describe('applyTriageBatch missing AI ids', () => {
  it('falls back to rule triage instead of skipping', () => {
    let state = createScanJob({ mode: 'full' });
    state = ingestSearchPage(state, {
      attachments: [
        att('bill', { subject: 'Electricity bill March', filename: 'bill.pdf', snippet: 'bill receipt' }),
      ],
      nextPageToken: null,
      messagesInPage: 1,
    });
    const id = state.triageQueue[0];
    // AI returned empty results for this batch id
    state = applyTriageBatch(state, []);
    // processed uses triageQueue slice — with empty decisions, batchIds uses Math.max(0,1)=1
    // Actually: decisions.length is 0, batchIds = triageQueue.slice(0, 1), so one id processed without decision → rule fallback
    expect(state.items[id]?.status === 'queued_classify' || state.items[id]?.status === 'triaged_skip').toBe(
      true,
    );
    // bill keywords should keep it
    expect(state.items[id]?.status).toBe('queued_classify');
    expect(state.classifyQueue).toContain(id);
  });
});

describe('rule triage keywords', () => {
  it('matches expanded document keywords', () => {
    expect(RULE_TRIAGE_DOC_KEYWORDS.test('your aadhaar card copy')).toBe(true);
    expect(RULE_TRIAGE_DOC_KEYWORDS.test('Form 16 for FY')).toBe(true);
    expect(RULE_TRIAGE_DOC_KEYWORDS.test('e-ticket itinerary')).toBe(true);
    const decisions = ruleTriage([
      {
        id: '1',
        attachment: {
          subject: 'Salary payslip',
          from: 'hr@co.com',
          filename: 'payslip.pdf',
          mimeType: 'application/pdf',
          snippet: 'payslip salary',
          size: 10_000,
        },
      },
    ]);
    expect(decisions[0].isLikelyImportant).toBe(true);
  });
});

describe('slimScanStateForPersist', () => {
  it('drops snippets and trims skipped/filtered items', () => {
    let state = createScanJob({ mode: 'full' });
    state = ingestSearchPage(state, {
      attachments: [att('1', { snippet: 'LONG SNIPPET DATA' }), att('logo', { filename: 'logo.png', size: 100 })],
      nextPageToken: null,
      messagesInPage: 2,
    });
    // force one skip
    const triageId = state.triageQueue[0];
    if (triageId) {
      state = applyTriageBatch(state, [
        { id: triageId, isLikelyImportant: false, confidence: 0.2, reason: 'skip' },
      ]);
    }
    const slim = slimScanStateForPersist(state);
    for (const item of Object.values(slim.items)) {
      if (item.status === 'filtered_out' || item.status === 'triaged_skip') {
        expect(item.attachment).toBeUndefined();
        expect(Object.keys(item).sort()).toEqual(['id', 'status'].sort());
      } else if (item.attachment) {
        expect(item.attachment.snippet).toBe('');
      }
    }
  });
});
