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
  /** Omitted on slimmed filtered/skipped persist entries */
  attachment?: GmailAttachmentMeta;
  status: PipelineItemStatus;
  triageReason?: string;
  triageConfidence?: number;
  classification?: ClassificationResult;
  contentHash?: string;
  candidateId?: string;
}

export interface ScanEventLogEntry {
  at: string;
  message: string;
}

export interface ScanStats {
  emailsChecked: number;
  emailsEstimatedTotal: number | null;
  /** Gmail list pages fetched so far */
  pagesFetched: number;
  attachmentsFound: number;
  filteredOut: number;
  triageKept: number;
  triageSkipped: number;
  documentsFound: number;
  duplicates: number;
  aiCallsUsed: number;
  triageBatches: number;
  classifyCalls: number;
  /** High-water progress percent — never shrinks mid-job */
  progressHighWater: number;
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
  /**
   * After the primary query finishes, a date-unlimited "known important docs"
   * pass runs (insurer domains, policy keywords, per-vehicle regs).
   */
  knownDocsPassDone?: boolean;
  knownDocsQueryIndex?: number;
  knownDocsPageToken?: string | null;
  knownDocsQueries?: string[];
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
  /** Non-fatal scan warning (e.g. AI triage fell back to rules) */
  lastWarning?: string | null;
  /** Last engine step timestamp (ISO) */
  lastStepAt?: string | null;
  /** Last outbound API call summary for the debug card */
  lastApiCall?: { at: string; label: string; status: string } | null;
  /** Rolling debug event log (capped) */
  eventLog?: ScanEventLogEntry[];
}

export const SCAN_STATE_FILENAME = 'scan-state.json';

export function emptyScanStats(): ScanStats {
  return {
    emailsChecked: 0,
    emailsEstimatedTotal: null,
    pagesFetched: 0,
    attachmentsFound: 0,
    filteredOut: 0,
    triageKept: 0,
    triageSkipped: 0,
    documentsFound: 0,
    duplicates: 0,
    aiCallsUsed: 0,
    triageBatches: 0,
    classifyCalls: 0,
    progressHighWater: 0,
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
    // true until ScanEngine.start arms the known-docs pass (avoids resume→search on legacy jobs)
    knownDocsPassDone: true,
    knownDocsQueryIndex: 0,
    knownDocsPageToken: null,
    knownDocsQueries: [],
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
