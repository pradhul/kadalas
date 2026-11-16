import { ScanJobState } from '../types/scan';
import { ScanCandidate } from '../types/document';

export type ScanCtaKind = 'progress' | 'resume' | 'review' | 'scan';

export type ScanCta = {
  kind: ScanCtaKind;
  title: string;
  subtitle?: string;
  percent?: number;
  stageLabel?: string;
  pendingCount?: number;
};

const ACTIVE = new Set(['search', 'filter', 'triage', 'classify', 'dedupe']);
const PAUSED = new Set(['paused_quota', 'paused_user']);

export function buildScanCta(input: {
  scanJob: ScanJobState | null;
  scanEngineRunning: boolean;
  candidates: ScanCandidate[];
  stageLabel?: string;
}): ScanCta {
  const pending = input.candidates.filter(
    (c) => c.status === 'pending' || c.status === 'needs_subject_confirm',
  ).length;
  const job = input.scanJob;

  if (job && ACTIVE.has(job.stage) && input.scanEngineRunning) {
    const percent = Math.min(100, Math.max(0, job.stats.progressHighWater || 0));
    return {
      kind: 'progress',
      title: 'View scan',
      subtitle: `${input.stageLabel || job.stage} · ${percent}%`,
      percent,
      stageLabel: input.stageLabel || job.stage,
    };
  }

  if (job && (PAUSED.has(job.stage) || (ACTIVE.has(job.stage) && !input.scanEngineRunning))) {
    return {
      kind: 'resume',
      title: 'Resume scan',
      subtitle: job.stage === 'paused_quota' ? 'Paused for quota / auth' : 'Scan stopped mid-way',
      percent: job.stats.progressHighWater,
      stageLabel: job.stage,
    };
  }

  if (pending > 0) {
    return {
      kind: 'review',
      title: `Review ${pending} document${pending === 1 ? '' : 's'}`,
      subtitle: 'Approve copies into Google Drive · Skip ignores',
      pendingCount: pending,
    };
  }

  return {
    kind: 'scan',
    title: 'Scan Gmail',
    subtitle: 'Find statements, policies, and IDs in your mailbox',
  };
}
