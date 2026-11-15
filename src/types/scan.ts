import { ClassificationResult, ScanCandidate } from './document';
import { GmailAttachmentMeta } from '../services/gmail/types';

export type ScanMode = 'full' | 'lookback' | 'incremental';

export type ScanStage =
  | 'idle'
  | 'search'
  | 'filter'
  | 'triage'
  | 'classify'
  | 'dedupe'
  | 'paused_quota'
  | 'paused_user'
  | 'completed'
  | 'cancelled';

export type PipelineItemStatus =
  | 'discovered'
  | 'filtered_out'
  | 'queued_triage'
  | 'triaged_keep'
  | 'triaged_skip'
  | 'queued_classify'
  | 'classified'
  | 'duplicate'
  | 'ready_for_review';

export interface PipelineItem {
  id: string;
  attachment: GmailAttachmentMeta;
  status: PipelineItemStatus;
  triageReason?: string;
  triageConfidence?: number;
  classification?: ClassificationResult;
  contentHash?: string;
  candidateId?: string;
}

export interface ScanStats {
  emailsChecked: number;
  emailsEstimatedTotal: number | null;
  attachmentsFound: number;
  filteredOut: number;
  triageKept: number;
  triageSkipped: number;
  documentsFound: number;
  duplicates: number;
  aiCallsUsed: number;
  triageBatches: number;
  classifyCalls: number;
}

export interface QuotaPauseInfo {
  reason: string;
  pausedAt: string;
  /** ISO time when auto-resume is suggested */
  resumeAfter: string;
  httpStatus?: number;
  stageWhenPaused: ScanStage;
}

export interface ScanJobState {
  version: 1;
  jobId: string;
  mode: ScanMode;
  lookbackDays?: number;
  stage: ScanStage;
  createdAt: string;
  updatedAt: string;
  /** Gmail list pagination */
  gmailQuery: string;
  gmailPageToken: string | null;
  gmailSearchDone: boolean;
  processedMessageIds: string[];
  /** Stage queues (ids into items) */
  triageQueue: string[];
  classifyQueue: string[];
  items: Record<string, PipelineItem>;
  /** Review-ready candidates accumulated incrementally */
  candidates: ScanCandidate[];
  stats: ScanStats;
  quotaPause: QuotaPauseInfo | null;
  userPaused: boolean;
  cancelled: boolean;
  /** Last vault index snapshot time used for incremental */
  sinceIso: string | null;
}

export const SCAN_STATE_FILENAME = 'scan-state.json';

export function emptyScanStats(): ScanStats {
  return {
    emailsChecked: 0,
    emailsEstimatedTotal: null,
    attachmentsFound: 0,
    filteredOut: 0,
    triageKept: 0,
    triageSkipped: 0,
    documentsFound: 0,
    duplicates: 0,
    aiCallsUsed: 0,
    triageBatches: 0,
    classifyCalls: 0,
  };
}

export function createEmptyScanJob(input: {
  mode: ScanMode;
  gmailQuery: string;
  lookbackDays?: number;
  sinceIso?: string | null;
  nowIso?: string;
}): ScanJobState {
  const now = input.nowIso ?? new Date().toISOString();
  return {
    version: 1,
    jobId: `scan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    mode: input.mode,
    lookbackDays: input.lookbackDays,
    stage: 'idle',
    createdAt: now,
    updatedAt: now,
    gmailQuery: input.gmailQuery,
    gmailPageToken: null,
    gmailSearchDone: false,
    processedMessageIds: [],
    triageQueue: [],
    classifyQueue: [],
    items: {},
    candidates: [],
    stats: emptyScanStats(),
    quotaPause: null,
    userPaused: false,
    cancelled: false,
    sinceIso: input.sinceIso ?? null,
  };
}
