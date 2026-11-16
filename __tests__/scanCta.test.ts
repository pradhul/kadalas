import { buildScanCta } from '../src/lib/scanCta';
import { emptyScanStats, ScanJobState } from '../src/types/scan';
import { ScanCandidate } from '../src/types/document';

function job(stage: ScanJobState['stage'], progress = 40): ScanJobState {
  return {
    version: 1,
    jobId: 'j1',
    mode: 'lookback',
    stage,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    gmailQuery: '',
    gmailPageToken: null,
    gmailSearchDone: false,
    processedMessageIds: [],
    triageQueue: [],
    classifyQueue: [],
    items: {},
    candidates: [],
    stats: { ...emptyScanStats(), progressHighWater: progress },
    quotaPause: null,
    userPaused: false,
    cancelled: false,
    sinceIso: null,
  };
}

function candidate(status: ScanCandidate['status']): ScanCandidate {
  return {
    id: `c-${status}`,
    gmailMessageId: 'm',
    gmailAttachmentId: 'a',
    subject: 's',
    from: 'f',
    receivedAt: '2026-01-01T00:00:00Z',
    fileName: 'doc.pdf',
    mimeType: 'application/pdf',
    size: 1,
    status,
  };
}

describe('buildScanCta', () => {
  it('shows progress while engine is running', () => {
    const cta = buildScanCta({
      scanJob: job('classify'),
      scanEngineRunning: true,
      candidates: [],
      stageLabel: 'Full document classification',
    });
    expect(cta.kind).toBe('progress');
    expect(cta.percent).toBe(40);
  });

  it('shows resume when paused or stalled', () => {
    expect(
      buildScanCta({
        scanJob: job('paused_quota'),
        scanEngineRunning: false,
        candidates: [],
      }).kind,
    ).toBe('resume');

    expect(
      buildScanCta({
        scanJob: job('search'),
        scanEngineRunning: false,
        candidates: [],
      }).kind,
    ).toBe('resume');
  });

  it('shows review when pending candidates remain', () => {
    const cta = buildScanCta({
      scanJob: job('completed'),
      scanEngineRunning: false,
      candidates: [candidate('pending'), candidate('approved')],
    });
    expect(cta.kind).toBe('review');
    expect(cta.pendingCount).toBe(1);
  });

  it('defaults to scan', () => {
    expect(
      buildScanCta({
        scanJob: null,
        scanEngineRunning: false,
        candidates: [],
      }).kind,
    ).toBe('scan');
  });
});
