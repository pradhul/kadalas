import {
  buildScanGmailQuery,
  createScanJob,
  finalizeDedupeGrouping,
  ingestSearchPage,
  isQuotaError,
  pauseForQuota,
  resumeScan,
} from '../src/lib/scanPipeline';
import { GmailAttachmentMeta } from '../src/services/gmail/types';
import { ScanCandidate as DocCandidate } from '../src/types/document';

function att(
  partial: Partial<GmailAttachmentMeta> & { messageId: string; attachmentId: string },
): GmailAttachmentMeta {
  return {
    filename: 'policy.pdf',
    mimeType: 'application/pdf',
    size: 50_000,
    subject: 'Policy',
    from: 'insurer@example.com',
    date: '2026-01-01T00:00:00.000Z',
    snippet: '',
    ...partial,
  };
}

describe('scan pipeline', () => {
  it('builds full vs lookback vs incremental queries', () => {
    expect(buildScanGmailQuery({ mode: 'full' })).toMatch(/has:attachment/);
    expect(buildScanGmailQuery({ mode: 'full' })).not.toMatch(/after:/);
    expect(buildScanGmailQuery({ mode: 'lookback', lookbackDays: 30 })).toMatch(/after:/);
    expect(
      buildScanGmailQuery({ mode: 'incremental', sinceIso: '2026-01-15T00:00:00.000Z' }),
    ).toMatch(/after:2026\/01\/15/);
  });

  it('ingests search pages and marks search done when no next page', () => {
    let state = createScanJob({ mode: 'full' });
    state = ingestSearchPage(state, {
      attachments: [
        att({ messageId: 'm1', attachmentId: 'a1', filename: 'good.pdf', size: 40_000 }),
        att({
          messageId: 'm2',
          attachmentId: 'a2',
          filename: 'logo.png',
          mimeType: 'image/png',
          size: 2_000,
        }),
      ],
      nextPageToken: null,
      estimatedTotal: 2,
      messagesInPage: 2,
    });
    expect(state.gmailSearchDone).toBe(true);
    expect(state.stats.emailsChecked).toBeGreaterThan(0);
    expect(state.stats.attachmentsFound).toBeGreaterThanOrEqual(1);
  });

  it('pauses for quota and resumes to the right stage', () => {
    let state = createScanJob({ mode: 'full' });
    state = {
      ...state,
      gmailSearchDone: true,
      stage: 'classify',
      classifyQueue: ['x'],
      items: {
        x: {
          id: 'x',
          attachment: att({ messageId: 'm', attachmentId: 'a' }),
          status: 'queued_classify',
        },
      },
    };
    const paused = pauseForQuota(state, { message: '429', status: 429 });
    expect(paused.stage).toBe('paused_quota');
    expect(paused.quotaPause?.resumeAfter).toBeTruthy();
    const resumed = resumeScan(paused);
    expect(resumed.stage).toBe('classify');
    expect(resumed.quotaPause).toBeNull();
  });

  it('detects quota errors', () => {
    expect(isQuotaError({ status: 429 })).toBe(true);
    expect(isQuotaError(new Error('RESOURCE_EXHAUSTED quota'))).toBe(true);
    expect(isQuotaError(new Error('boom'))).toBe(false);
  });

  it('finalizeDedupeGrouping groups vehicle OD+TP', () => {
    const od: DocCandidate = {
      id: 'od',
      gmailMessageId: 'm1',
      gmailAttachmentId: 'a1',
      subject: 'Standalone OD KA-01-AB-1234',
      from: 'Progressive <docs@progressive.com>',
      date: '2026-02-18T00:00:00.000Z',
      fileName: 'od.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1000,
      status: 'pending',
      classification: {
        category: 'Insurance/Vehicle',
        title: 'OD',
        metadata: {
          issuer: 'Progressive',
          coverageType: 'od_only',
          registrationNumber: 'KA-01-AB-1234',
          issueDate: '2026-02-18',
          expiryDate: '2027-02-17',
        },
        confidence: 0.9,
        isImportantDocument: true,
      },
    };
    const tp: DocCandidate = {
      id: 'tp',
      gmailMessageId: 'm2',
      gmailAttachmentId: 'a2',
      subject: 'Liability Only KA-01-AB-1234',
      from: 'Go Digit <motor@godigit.com>',
      date: '2025-02-15T00:00:00.000Z',
      fileName: 'tp.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1000,
      status: 'pending',
      classification: {
        category: 'Insurance/Vehicle',
        title: 'TP',
        metadata: {
          issuer: 'Go Digit',
          coverageType: 'tp_only',
          registrationNumber: 'KA-01-AB-1234',
          issueDate: '2025-02-15',
          expiryDate: '2030-02-14',
        },
        confidence: 0.9,
        isImportantDocument: true,
      },
    };

    let state = createScanJob({ mode: 'full' });
    state = {
      ...state,
      gmailSearchDone: true,
      stage: 'dedupe',
      candidates: [od, tp],
      classifyQueue: [],
      triageQueue: [],
    };
    const next = finalizeDedupeGrouping(state);
    expect(next.stage).toBe('completed');
    expect(next.candidates.filter((c) => c.isGroupLatest).length).toBeGreaterThanOrEqual(2);
  });
});
