import { AttachmentDedupeSet, shouldKeepAttachment } from './attachmentFilter';
import { shouldConsiderAttachment } from './categorisation';
import { findDuplicateInVault } from './dedup';
import { GmailAttachmentMeta } from '../services/gmail/types';
import {
  createEmptyScanJob,
  PipelineItem,
  QuotaPauseInfo,
  ScanJobState,
  ScanMode,
  ScanStage,
} from '../types/scan';
import { ClassificationResult, ScanCandidate, VaultDocument } from '../types/document';
import { enrichCandidateWithSubject, groupCandidatesBySubject } from './grouping';
import { resolveSubjectKey, applySubjectToMetadata } from './subjectKey';
import { ruleTriageOne } from './ruleTriage';

export const DEFAULT_TRIAGE_BATCH_SIZE = 12;
export const DEFAULT_GMAIL_PAGE_SIZE = 50;

/** Build Gmail query for full / lookback / incremental scans. */
export function buildScanGmailQuery(options: {
  mode: ScanMode;
  lookbackDays?: number;
  sinceIso?: string | null;
}): string {
  // in:anywhere — no category/tab limits (Primary/Updates/Promotions/Social/Forums)
  const base =
    'in:anywhere has:attachment (filename:pdf OR filename:jpg OR filename:jpeg OR filename:png OR filename:webp OR filename:doc OR filename:docx)';

  if (options.mode === 'full') {
    // Full mailbox: no after: — paged + resumable via gmailPageToken
    return base;
  }

  const afterDate =
    options.mode === 'incremental' && options.sinceIso
      ? new Date(options.sinceIso)
      : new Date(Date.now() - (options.lookbackDays ?? 90) * 24 * 60 * 60 * 1000);

  const y = afterDate.getUTCFullYear();
  const m = String(afterDate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(afterDate.getUTCDate()).padStart(2, '0');
  return `${base} after:${y}/${m}/${d}`;
}

export function createScanJob(options: {
  mode: ScanMode;
  lookbackDays?: number;
  sinceIso?: string | null;
  nowIso?: string;
}): ScanJobState {
  return createEmptyScanJob({
    mode: options.mode,
    lookbackDays: options.lookbackDays,
    sinceIso: options.sinceIso,
    gmailQuery: buildScanGmailQuery(options),
    nowIso: options.nowIso,
  });
}

/** Junk / decoration + promo heuristics before triage. */
export function passesRulePrefilter(
  att: GmailAttachmentMeta,
  dedupe?: AttachmentDedupeSet,
): boolean {
  const keepDecoration = shouldKeepAttachment(
    {
      fileName: att.filename,
      mimeType: att.mimeType,
      size: att.size,
      subject: att.subject,
      from: att.from,
      snippet: att.snippet,
      contentDisposition: att.contentDisposition,
      contentId: att.contentId,
      referencedAsCid: att.referencedAsCid,
      isInline: att.isInline,
    },
    dedupe,
  );
  if (!keepDecoration) return false;

  return shouldConsiderAttachment({
    subject: att.subject,
    from: att.from,
    snippet: att.snippet,
    fileName: att.filename,
    mimeType: att.mimeType,
  });
}

export function itemIdForAttachment(att: GmailAttachmentMeta): string {
  return `${att.messageId}::${att.attachmentId}`;
}

/** Ingest a Gmail search page into scan state (stage: search → filter). */
export function ingestSearchPage(
  state: ScanJobState,
  page: {
    attachments: GmailAttachmentMeta[];
    nextPageToken: string | null;
    estimatedTotal?: number | null;
    messagesInPage?: number;
  },
  nowIso: string = new Date().toISOString(),
  dedupe?: AttachmentDedupeSet,
): ScanJobState {
  const checked = state.stats.emailsChecked + (page.messagesInPage ?? page.attachments.length);
  // Gmail resultSizeEstimate often under-reports (~201) and resets every page — never shrink.
  const priorEst = state.stats.emailsEstimatedTotal;
  const pageEst = page.estimatedTotal ?? null;
  const emailsEstimatedTotal =
    pageEst == null
      ? priorEst
      : Math.max(priorEst ?? 0, pageEst, checked);

  const next: ScanJobState = {
    ...state,
    stage: 'filter',
    updatedAt: nowIso,
    gmailPageToken: page.nextPageToken,
    gmailSearchDone: !page.nextPageToken,
    stats: {
      ...state.stats,
      emailsChecked: checked,
      emailsEstimatedTotal,
      pagesFetched: (state.stats.pagesFetched ?? 0) + 1,
    },
    processedMessageIds: [...state.processedMessageIds],
    triageQueue: [...state.triageQueue],
    items: { ...state.items },
  };

  const seenMessages = new Set(next.processedMessageIds);

  for (const att of page.attachments) {
    if (!seenMessages.has(att.messageId)) {
      next.processedMessageIds.push(att.messageId);
      seenMessages.add(att.messageId);
    }

    const id = itemIdForAttachment(att);
    if (next.items[id]) continue;

    next.stats.attachmentsFound += 1;
    const keep = passesRulePrefilter(att, dedupe);
    if (!keep) {
      next.stats.filteredOut += 1;
      next.items[id] = { id, attachment: att, status: 'filtered_out' };
      continue;
    }

    next.items[id] = { id, attachment: att, status: 'queued_triage' };
    next.triageQueue.push(id);
  }

  // Interleave: triage/classify as soon as this page produced work — don't wait for full mailbox.
  if (next.triageQueue.length > 0) {
    next.stage = 'triage';
  } else if (next.classifyQueue.length > 0) {
    next.stage = 'classify';
  } else if (!next.gmailSearchDone) {
    next.stage = 'search';
  } else {
    next.stage = 'dedupe';
  }

  return bumpProgressHighWater(next);
}

export interface TriageDecision {
  id: string;
  isLikelyImportant: boolean;
  confidence: number;
  reason?: string;
}

/** Apply cheap AI triage batch results. */
export function applyTriageBatch(
  state: ScanJobState,
  decisions: TriageDecision[],
  nowIso: string = new Date().toISOString(),
): ScanJobState {
  const decisionMap = new Map(decisions.map((d) => [d.id, d]));
  const batchIds = state.triageQueue.slice(0, Math.max(decisions.length, 1));
  const ids = batchIds.length ? batchIds : [...decisionMap.keys()];

  const next: ScanJobState = {
    ...state,
    updatedAt: nowIso,
    items: { ...state.items },
    triageQueue: state.triageQueue.filter((id) => !ids.includes(id) && !decisionMap.has(id)),
    classifyQueue: [...state.classifyQueue],
    stats: {
      ...state.stats,
      aiCallsUsed: state.stats.aiCallsUsed + 1,
      triageBatches: state.stats.triageBatches + 1,
    },
  };

  const processed = ids.length ? ids : [...decisionMap.keys()];
  next.triageQueue = state.triageQueue.filter((id) => !processed.includes(id));

  for (const id of processed) {
    const item = next.items[id];
    if (!item?.attachment) continue;
    // Items missing from the AI response fall back to rule triage (not auto-skip).
    const d =
      decisionMap.get(id) ??
      (() => {
        const rule = ruleTriageOne(item.attachment!);
        return {
          id,
          isLikelyImportant: rule.isLikelyImportant,
          confidence: rule.confidence,
          reason: rule.reason,
        };
      })();
    if (!d.isLikelyImportant) {
      next.stats.triageSkipped += 1;
      next.items[id] = {
        ...item,
        status: 'triaged_skip',
        triageReason: d.reason || 'Not an important document',
        triageConfidence: d.confidence ?? 0,
      };
    } else {
      next.stats.triageKept += 1;
      next.items[id] = {
        ...item,
        status: 'queued_classify',
        triageReason: d.reason,
        triageConfidence: d.confidence,
      };
      next.classifyQueue.push(id);
    }
  }

  // Prefer draining triage → classify before fetching the next Gmail page.
  if (next.triageQueue.length) next.stage = 'triage';
  else if (next.classifyQueue.length) next.stage = 'classify';
  else if (!next.gmailSearchDone) next.stage = 'search';
  else next.stage = 'dedupe';

  return bumpProgressHighWater(next);
}

/** Take next triage batch of metadata-only payloads. */
export function takeTriageBatch(
  state: ScanJobState,
  batchSize: number = DEFAULT_TRIAGE_BATCH_SIZE,
): Array<{ id: string; attachment: GmailAttachmentMeta }> {
  return state.triageQueue
    .slice(0, batchSize)
    .map((id) => {
      const attachment = state.items[id]?.attachment;
      if (!attachment) return null;
      return { id, attachment };
    })
    .filter((x): x is { id: string; attachment: GmailAttachmentMeta } => Boolean(x));
}

export function applyClassificationResult(
  state: ScanJobState,
  itemId: string,
  classification: ClassificationResult,
  contentHash: string | undefined,
  vaultDocuments: VaultDocument[],
  nowIso: string = new Date().toISOString(),
  enrichOptions: { allowDemoPlates?: boolean; skippedAttachmentIds?: Set<string> | string[] } = {},
): ScanJobState {
  const item = state.items[itemId];
  if (!item) return state;

  const resolution = resolveSubjectKey({
    category: classification.category,
    metadata: classification.metadata,
    title: classification.title,
  });
  const metadata = applySubjectToMetadata(classification.metadata, resolution);
  const finalClassification = { ...classification, metadata };

  const att = item.attachment;
  if (!att) return state;
  const skipKey = `${att.messageId}::${att.attachmentId}`;
  const skippedSet =
    enrichOptions.skippedAttachmentIds instanceof Set
      ? enrichOptions.skippedAttachmentIds
      : new Set(enrichOptions.skippedAttachmentIds ?? []);
  const previouslySkipped = skippedSet.has(skipKey);

  let candidate: ScanCandidate = {
    id: `cand_${itemId.replace(/[^a-zA-Z0-9]/g, '_')}`,
    gmailMessageId: att.messageId,
    gmailAttachmentId: att.attachmentId,
    subject: att.subject,
    from: att.from,
    date: att.date,
    fileName: att.filename,
    mimeType: att.mimeType,
    sizeBytes: att.size,
    previewSnippet: att.snippet,
    classification: finalClassification,
    contentRef: contentHash,
    status: previouslySkipped
      ? 'rejected'
      : finalClassification.isImportantDocument
        ? 'pending'
        : 'skipped',
  };
  const subjectOpts = {
    vaultDocuments,
    allowDemoPlates: Boolean(enrichOptions.allowDemoPlates),
  };
  candidate = enrichCandidateWithSubject(candidate, subjectOpts);
  if (previouslySkipped) {
    candidate = { ...candidate, status: 'rejected' };
  }

  const dup = findDuplicateInVault(
    {
      hash: contentHash,
      metadata: finalClassification.metadata,
      title: finalClassification.title,
      category: finalClassification.category,
    },
    vaultDocuments,
  );

  // Also treat same subject+type against already-found candidates as version, not separate
  if (dup.isDuplicate && !previouslySkipped) {
    candidate = {
      ...candidate,
      status: 'duplicate',
      duplicateOfId: dup.duplicateOfId,
    };
  }

  const next: ScanJobState = {
    ...state,
    updatedAt: nowIso,
    items: {
      ...state.items,
      [itemId]: {
        ...item,
        status: dup.isDuplicate ? 'duplicate' : 'classified',
        classification: finalClassification,
        contentHash,
        candidateId: candidate.id,
      },
    },
    classifyQueue: state.classifyQueue.filter((id) => id !== itemId),
    candidates: [...state.candidates.filter((c) => c.id !== candidate.id), candidate],
    stats: {
      ...state.stats,
      aiCallsUsed: state.stats.aiCallsUsed + 1,
      classifyCalls: state.stats.classifyCalls + 1,
      documentsFound:
        state.stats.documentsFound +
        (candidate.status === 'pending' || candidate.status === 'needs_subject_confirm' ? 1 : 0),
      duplicates: state.stats.duplicates + (dup.isDuplicate ? 1 : 0),
    },
  };

  // Re-group all candidates so review list shows entity groups incrementally
  const grouped = groupCandidatesBySubject(next.candidates, subjectOpts);
  next.candidates = grouped.flat;

  if (next.classifyQueue.length) next.stage = 'classify';
  else if (next.triageQueue.length) next.stage = 'triage';
  else if (!next.gmailSearchDone) next.stage = 'search';
  else next.stage = 'dedupe';

  return bumpProgressHighWater(next);
}

export function finalizeDedupeGrouping(
  state: ScanJobState,
  nowIso = new Date().toISOString(),
  options: { vaultDocuments?: VaultDocument[]; allowDemoPlates?: boolean } = {},
): ScanJobState {
  const grouped = groupCandidatesBySubject(state.candidates, {
    vaultDocuments: options.vaultDocuments,
    allowDemoPlates: Boolean(options.allowDemoPlates),
  });
  return bumpProgressHighWater({
    ...state,
    stage: 'completed',
    updatedAt: nowIso,
    candidates: grouped.flat,
    gmailSearchDone: true,
    stats: { ...state.stats, progressHighWater: 100 },
  });
}

export function pauseForQuota(
  state: ScanJobState,
  err: { message?: string; status?: number },
  resumeAfterMs: number = 60 * 60 * 1000,
  now: Date = new Date(),
): ScanJobState {
  const pause: QuotaPauseInfo = {
    reason: err.message || 'AI quota / rate limit reached',
    pausedAt: now.toISOString(),
    resumeAfter: new Date(now.getTime() + resumeAfterMs).toISOString(),
    httpStatus: err.status,
    stageWhenPaused: state.stage === 'paused_quota' ? state.quotaPause?.stageWhenPaused || 'triage' : state.stage,
  };
  return {
    ...state,
    stage: 'paused_quota',
    quotaPause: pause,
    updatedAt: now.toISOString(),
  };
}

/**
 * Pause when Google access token expires (web GIS has no refresh_token).
 * Reuses paused_quota persistence so Resume works after reconnect.
 * Long resumeAfter so we do not auto-resume before the user reconnects.
 */
export function pauseForAuth(
  state: ScanJobState,
  err: { message?: string; status?: number } = {},
  now: Date = new Date(),
): ScanJobState {
  return pauseForQuota(
    state,
    {
      message: err.message || 'Session expired — tap to reconnect Google',
      status: err.status ?? 401,
    },
    30 * 24 * 60 * 60 * 1000,
    now,
  );
}

export function isAuthPause(state: ScanJobState | null | undefined): boolean {
  return state?.stage === 'paused_quota' && state.quotaPause?.httpStatus === 401;
}

export function pauseByUser(state: ScanJobState, nowIso = new Date().toISOString()): ScanJobState {
  return {
    ...state,
    stage: 'paused_user',
    userPaused: true,
    updatedAt: nowIso,
  };
}

export function resumeScan(state: ScanJobState, nowIso = new Date().toISOString()): ScanJobState {
  if (state.cancelled || state.stage === 'completed') return state;
  let stage: ScanStage = 'search';
  // knownDocsPassDone === false means the new pass is in progress; undefined = legacy job
  if (!state.gmailSearchDone || state.knownDocsPassDone === false) stage = 'search';
  else if (state.triageQueue.length) stage = 'triage';
  else if (state.classifyQueue.length) stage = 'classify';
  else stage = 'dedupe';

  return {
    ...state,
    stage,
    userPaused: false,
    quotaPause: null,
    updatedAt: nowIso,
  };
}

export function cancelScan(state: ScanJobState, nowIso = new Date().toISOString()): ScanJobState {
  return { ...state, stage: 'cancelled', cancelled: true, updatedAt: nowIso };
}

export function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: number; statusCode?: number; message?: string };
  const status = e.status ?? e.statusCode;
  if (status === 401) return false; // auth — handled separately
  if (status === 429) return true;
  const msg = (e.message || '').toLowerCase();
  return (
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('resource_exhausted') ||
    msg.includes('too many requests')
  );
}

/** Raw stage-weighted progress (search 0–60, triage 60–80, classify 80–100). */
export function computeStageProgress(state: ScanJobState): number {
  if (state.stage === 'completed') return 100;
  if (state.stage === 'cancelled') return state.stats.progressHighWater ?? 0;

  const aboutN = Math.max(
    state.stats.emailsEstimatedTotal ?? 0,
    state.stats.emailsChecked,
    1,
  );
  const searchFrac = Math.min(1, state.stats.emailsChecked / aboutN);
  const searchPct = Math.round(searchFrac * 60);

  const triageDone = state.stats.triageKept + state.stats.triageSkipped;
  const triageTotal = Math.max(triageDone + state.triageQueue.length, 1);
  const triageFrac = Math.min(1, triageDone / triageTotal);

  const classifyDone = state.stats.classifyCalls;
  const classifyTotal = Math.max(classifyDone + state.classifyQueue.length, 1);
  const classifyFrac = Math.min(1, classifyDone / classifyTotal);

  if (state.stage === 'search' || state.stage === 'filter' || state.stage === 'idle') {
    return Math.min(59, searchPct);
  }
  if (state.stage === 'triage') {
    return 60 + Math.round(triageFrac * 20);
  }
  if (state.stage === 'classify') {
    return 80 + Math.round(classifyFrac * 19);
  }
  if (state.stage === 'dedupe') return 98;
  // paused_* — hold last computed band from queues/search
  if (state.classifyQueue.length) return 80 + Math.round(classifyFrac * 19);
  if (state.triageQueue.length) return 60 + Math.round(triageFrac * 20);
  return Math.min(59, searchPct);
}

export function bumpProgressHighWater(state: ScanJobState): ScanJobState {
  const raw = computeStageProgress(state);
  const progressHighWater = Math.max(state.stats.progressHighWater ?? 0, raw);
  if (progressHighWater === state.stats.progressHighWater) return state;
  return { ...state, stats: { ...state.stats, progressHighWater } };
}

export function estimateRemaining(state: ScanJobState): {
  percent: number;
  label: string;
} {
  const aboutN = Math.max(state.stats.emailsEstimatedTotal ?? 0, state.stats.emailsChecked, 0);
  const percent =
    state.stage === 'completed'
      ? 100
      : Math.max(state.stats.progressHighWater ?? 0, computeStageProgress(state));
  const label =
    state.stage === 'completed'
      ? 'Done'
      : aboutN > 0
        ? `about ${aboutN} emails · ${state.stats.pagesFetched || 0} pages`
        : `${state.stats.pagesFetched || 0} pages fetched`;
  return { percent, label };
}

export function getActiveStageLabel(stage: ScanStage, opts?: { authPause?: boolean }): string {
  switch (stage) {
    case 'search':
      return 'Searching Gmail (no AI)';
    case 'filter':
      return 'Rule-based pre-filter';
    case 'triage':
      return 'Cheap AI triage (metadata batches)';
    case 'classify':
      return 'Full document classification';
    case 'dedupe':
      return 'Grouping & dedupe';
    case 'paused_quota':
      return opts?.authPause
        ? 'Paused — Google session expired'
        : 'Paused — AI quota / rate limit';
    case 'paused_user':
      return 'Paused by you';
    case 'completed':
      return 'Completed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Idle';
  }
}

/** Pure helper: chunk an array for triage batching. */
export function chunkForBatch<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
