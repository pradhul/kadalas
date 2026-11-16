import { AttachmentDedupeSet } from '../lib/attachmentFilter';
import { classifyWithRules } from '../lib/categorisation';
import { hashBytes } from '../lib/hash';
import { appendScanEvent } from '../lib/scanPersistSlim';
import {
  applyClassificationResult,
  applyTriageBatch,
  cancelScan,
  createScanJob,
  DEFAULT_GMAIL_PAGE_SIZE,
  DEFAULT_TRIAGE_BATCH_SIZE,
  estimateRemaining,
  finalizeDedupeGrouping,
  getActiveStageLabel,
  ingestSearchPage,
  isQuotaError,
  pauseByUser,
  pauseForAuth,
  pauseForQuota,
  resumeScan,
  takeTriageBatch,
} from '../lib/scanPipeline';
import { ScanMode, ScanJobState } from '../types/scan';
import { ScanCandidate, VaultIndex } from '../types/document';
import { getAiService, ruleTriage } from './ai';
import { isAuthError } from './auth/errors';
import { getGmailService } from './gmail';
import { yieldToUi } from '../lib/asyncUtils';
import { clearScanJobState, loadScanJobState, saveScanJobState } from './scanPersist';
import { useMocks } from './config';

export type ScanEngineListener = (state: ScanJobState) => void;

const PERSIST_EVERY_STEPS = 5;
const PERSIST_EVERY_MS = 15_000;
/** Max UI notify rate (~4/sec) to reduce main-thread jank. */
const EMIT_MIN_MS = 250;

export class ScanEngine {
  private state: ScanJobState | null = null;
  private running = false;
  private listeners = new Set<ScanEngineListener>();
  private stopRequested: 'pause' | 'cancel' | null = null;
  private vaultDocuments: VaultIndex['documents'] = [];
  /** Gmail attachment keys the user previously skipped — never re-suggest. */
  private skippedAttachmentIds = new Set<string>();
  private stepsSincePersist = 0;
  private lastPersistAt = 0;
  /** Cross-email decoration fingerprint dedupe for the active job. */
  private attachmentDedupe = new AttachmentDedupeSet();

  subscribe(listener: ScanEngineListener): () => void {
    this.listeners.add(listener);
    if (this.state) listener(this.state);
    return () => this.listeners.delete(listener);
  }

  getState(): ScanJobState | null {
    return this.state;
  }

  isRunning(): boolean {
    return this.running;
  }

  private lastEmitAt = 0;
  private pendingEmit: ScanJobState | null = null;
  private emitTimer: ReturnType<typeof setTimeout> | null = null;

  private emit(state: ScanJobState, force = false) {
    this.state = state;
    const terminal = ['completed', 'cancelled', 'paused_quota', 'paused_user', 'idle'].includes(
      state.stage,
    );
    const shouldForce = force || terminal;
    const now = Date.now();
    if (shouldForce || now - this.lastEmitAt >= EMIT_MIN_MS) {
      this.lastEmitAt = now;
      this.pendingEmit = null;
      if (this.emitTimer) {
        clearTimeout(this.emitTimer);
        this.emitTimer = null;
      }
      this.listeners.forEach((l) => l(state));
      return;
    }
    this.pendingEmit = state;
    if (!this.emitTimer) {
      this.emitTimer = setTimeout(() => {
        this.emitTimer = null;
        if (this.pendingEmit) {
          const s = this.pendingEmit;
          this.pendingEmit = null;
          this.lastEmitAt = Date.now();
          this.listeners.forEach((l) => l(s));
        }
      }, EMIT_MIN_MS);
    }
  }

  /** Public debug log for approve/skip failures (scan debug card). */
  logEvent(message: string): void {
    this.note(message);
  }

  private note(message: string, api?: { label: string; status: string }) {
    if (!this.state) {
      // No active job — still allow a one-off event by creating a transient log on null state
      return;
    }
    let next = appendScanEvent(this.state, message);
    next = {
      ...next,
      lastStepAt: new Date().toISOString(),
      lastApiCall: api
        ? { at: new Date().toISOString(), label: api.label, status: api.status }
        : next.lastApiCall ?? null,
    };
    this.emit(next);
  }

  private async persist(force = false): Promise<void> {
    if (!this.state) return;
    this.stepsSincePersist += 1;
    const due =
      force ||
      this.stepsSincePersist >= PERSIST_EVERY_STEPS ||
      Date.now() - this.lastPersistAt >= PERSIST_EVERY_MS;
    if (!due) return;
    this.stepsSincePersist = 0;
    this.lastPersistAt = Date.now();
    await saveScanJobState(this.state);
  }

  async hydrate(): Promise<ScanJobState | null> {
    const loaded = await loadScanJobState();
    if (loaded) this.emit(loaded);
    return loaded;
  }

  setSkippedAttachmentIds(ids: Iterable<string>): void {
    this.skippedAttachmentIds = new Set(ids);
  }

  async start(options: {
    mode: ScanMode;
    lookbackDays?: number;
    sinceIso?: string | null;
    vaultIndex: VaultIndex;
    /** In mock mode, force quota after N AI calls for demos */
    mockQuotaAfter?: number;
    skippedAttachmentIds?: Iterable<string>;
  }): Promise<void> {
    this.vaultDocuments = options.vaultIndex.documents;
    if (options.skippedAttachmentIds) {
      this.skippedAttachmentIds = new Set(options.skippedAttachmentIds);
    }
    if (options.mockQuotaAfter != null || useMocks()) {
      getAiService().__setMockQuotaFailAfter?.(options.mockQuotaAfter ?? 8);
    }

    const job = createScanJob({
      mode: options.mode,
      lookbackDays: options.lookbackDays,
      sinceIso: options.sinceIso ?? options.vaultIndex.lastScanAt,
    });
    job.stage = 'search';
    this.stopRequested = null;
    this.stepsSincePersist = 0;
    this.lastPersistAt = 0;
    this.attachmentDedupe = new AttachmentDedupeSet();
    this.emit(appendScanEvent(job, `Scan started (${options.mode})`));
    await this.persist(true);
    await this.runLoop();
  }

  async resume(
    vaultIndex: VaultIndex,
    options?: { skippedAttachmentIds?: Iterable<string> },
  ): Promise<void> {
    this.vaultDocuments = vaultIndex.documents;
    if (options?.skippedAttachmentIds) {
      this.skippedAttachmentIds = new Set(options.skippedAttachmentIds);
    }
    if (!this.state) await this.hydrate();
    if (!this.state) return;
    if (useMocks()) getAiService().__setMockQuotaFailAfter?.(3);
    const next = resumeScan(this.state);
    this.stopRequested = null;
    this.emit(appendScanEvent(next, 'Scan resumed'));
    await this.persist(true);
    await this.runLoop();
  }

  async pause(): Promise<void> {
    this.stopRequested = 'pause';
    if (this.state && !this.running) {
      const next = pauseByUser(this.state);
      this.emit(appendScanEvent(next, 'Paused by user'));
      await this.persist(true);
    }
  }

  async cancel(): Promise<void> {
    this.stopRequested = 'cancel';
    if (this.state) {
      const next = cancelScan(this.state);
      this.emit(appendScanEvent(next, 'Scan cancelled'));
      await this.persist(true);
    }
  }

  /** Stop the loop and clear persisted state (overwrite, never delete Drive files). */
  async reset(): Promise<void> {
    this.stopRequested = 'cancel';
    this.running = false;
    this.state = null;
    await clearScanJobState();
  }

  private async runLoop(): Promise<void> {
    if (this.running || !this.state) return;
    this.running = true;
    try {
      while (this.state && !['completed', 'cancelled', 'paused_quota', 'paused_user'].includes(this.state.stage)) {
        if (this.stopRequested === 'cancel') {
          this.emit(appendScanEvent(cancelScan(this.state), 'Scan cancelled'));
          await this.persist(true);
          break;
        }
        if (this.stopRequested === 'pause') {
          this.emit(appendScanEvent(pauseByUser(this.state), 'Paused by user'));
          await this.persist(true);
          break;
        }

        try {
          if (this.state.stage === 'search' || (this.state.stage === 'idle' && !this.state.gmailSearchDone)) {
            await this.stepSearch();
          } else if (this.state.stage === 'triage' || this.state.stage === 'filter') {
            await this.stepTriage();
          } else if (this.state.stage === 'classify') {
            await this.stepClassify();
          } else if (this.state.stage === 'dedupe') {
            const next = finalizeDedupeGrouping(this.state, new Date().toISOString(), {
              vaultDocuments: this.vaultDocuments,
              allowDemoPlates: useMocks(),
            });
            this.emit(appendScanEvent(next, 'Scan completed'));
            await this.persist(true);
          } else {
            break;
          }
          // Yield so React can paint progress between batches
          await yieldToUi();
        } catch (err) {
          if (isAuthError(err)) {
            const next = pauseForAuth(this.state, {
              message: err instanceof Error ? err.message : 'Session expired — tap to reconnect Google',
              status: (err as { status?: number }).status ?? 401,
            });
            this.emit(appendScanEvent(next, `Auth pause: ${next.quotaPause?.reason}`));
            await this.persist(true);
            break;
          }
          if (isQuotaError(err)) {
            const status = (err as { status?: number }).status;
            const next = pauseForQuota(
              this.state,
              { message: err instanceof Error ? err.message : String(err), status },
              useMocks() ? 30 * 60 * 1000 : 60 * 60 * 1000,
            );
            this.emit(appendScanEvent(next, `Quota pause: ${next.quotaPause?.reason}`));
            await this.persist(true);
            break;
          }
          const msg = err instanceof Error ? err.message : String(err);
          this.note(`Step error: ${msg}`);
          await this.persist(true);
          throw err;
        }

        await this.persist(false);
      }
    } finally {
      this.running = false;
      // Notify UI that the engine stopped (stuck-running detection)
      if (this.state) this.emit({ ...this.state });
    }
  }

  private async stepSearch(): Promise<void> {
    if (!this.state) return;
    const gmail = getGmailService();
    this.note('Gmail search page…', { label: 'gmail.search', status: 'pending' });
    const page = await gmail.searchAttachmentsPage({
      query: this.state.gmailQuery,
      maxResults: useMocks() ? 40 : DEFAULT_GMAIL_PAGE_SIZE,
      pageToken: this.state.gmailPageToken,
    });
    let next = ingestSearchPage(this.state, page, new Date().toISOString(), this.attachmentDedupe);
    if (useMocks() && next.stats.emailsChecked >= 100) {
      next = {
        ...next,
        gmailSearchDone: true,
        gmailPageToken: null,
        stage: next.triageQueue.length ? 'triage' : next.classifyQueue.length ? 'classify' : 'dedupe',
      };
    }
    next = appendScanEvent(
      next,
      `Search page ${next.stats.pagesFetched}: +${page.attachments.length} attachments → ${next.stage}`,
    );
    next = {
      ...next,
      lastStepAt: new Date().toISOString(),
      lastApiCall: { at: new Date().toISOString(), label: 'gmail.search', status: '200' },
    };
    this.emit(next);
  }

  private async stepTriage(): Promise<void> {
    if (!this.state) return;
    const batch = takeTriageBatch(this.state, useMocks() ? 6 : DEFAULT_TRIAGE_BATCH_SIZE);
    if (!batch.length) {
      const next = {
        ...this.state,
        stage: this.state.classifyQueue.length
          ? ('classify' as const)
          : !this.state.gmailSearchDone
            ? ('search' as const)
            : ('dedupe' as const),
        updatedAt: new Date().toISOString(),
        lastStepAt: new Date().toISOString(),
      };
      this.emit(next);
      return;
    }

    const ai = getAiService();
    const triageInput = batch.map((b) => ({
      id: b.id,
      attachment: {
        from: b.attachment.from,
        subject: b.attachment.subject,
        filename: b.attachment.filename,
        mimeType: b.attachment.mimeType,
        snippet: b.attachment.snippet,
        size: b.attachment.size,
      },
    }));

    let decisions;
    let warning: string | null = null;
    this.note(`AI triage batch (${batch.length})…`, { label: 'ai.triage', status: 'pending' });
    try {
      decisions = await ai.triageBatch(triageInput);
      this.note(`AI triage ok (${batch.length})`, { label: 'ai.triage', status: '200' });
    } catch (err) {
      if (isQuotaError(err) || isAuthError(err)) throw err;
      decisions = ruleTriage(triageInput);
      warning =
        err instanceof Error
          ? `AI triage unavailable (${err.message}); using rule triage`
          : 'AI triage unavailable; using rule triage';
      this.note(warning, { label: 'ai.triage', status: 'fallback' });
    }
    const next = {
      ...applyTriageBatch(this.state, decisions),
      lastWarning: warning ?? this.state.lastWarning ?? null,
      lastStepAt: new Date().toISOString(),
    };
    this.emit(next);
  }

  private async stepClassify(): Promise<void> {
    if (!this.state) return;
    const itemId = this.state.classifyQueue[0];
    if (!itemId) {
      this.emit({
        ...this.state,
        stage: this.state.triageQueue.length
          ? 'triage'
          : !this.state.gmailSearchDone
            ? 'search'
            : 'dedupe',
        updatedAt: new Date().toISOString(),
        lastStepAt: new Date().toISOString(),
      });
      return;
    }

    const item = this.state.items[itemId];
    if (!item?.attachment) {
      this.emit({
        ...this.state,
        classifyQueue: this.state.classifyQueue.filter((id) => id !== itemId),
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    const gmail = getGmailService();
    const ai = getAiService();
    let contentHash: string | undefined;
    let classification;

    try {
      this.note(`Classify ${item.attachment.filename}`, { label: 'gmail.attachment', status: 'pending' });
      const content = await gmail.getAttachment(
        item.attachment.messageId,
        item.attachment.attachmentId,
        item.attachment,
      );
      contentHash = await hashBytes(content.dataBase64);
      const hasKey = await ai.hasApiKey();
      classification = hasKey
        ? await ai.classifyDocument({
            fileName: item.attachment.filename,
            mimeType: item.attachment.mimeType,
            dataBase64: content.dataBase64,
            subject: item.attachment.subject,
            from: item.attachment.from,
            textExcerpt: item.attachment.snippet,
          })
        : classifyWithRules({
            subject: item.attachment.subject,
            from: item.attachment.from,
            fileName: item.attachment.filename,
            mimeType: item.attachment.mimeType,
            snippet: item.attachment.snippet,
          });
      this.note(`Classified ${item.attachment.filename}`, { label: 'ai.classify', status: '200' });
    } catch (err) {
      if (isQuotaError(err) || isAuthError(err)) throw err;
      classification = classifyWithRules({
        subject: item.attachment.subject,
        from: item.attachment.from,
        fileName: item.attachment.filename,
        mimeType: item.attachment.mimeType,
        snippet: item.attachment.snippet,
      });
      this.note(
        `Classify fallback for ${item.attachment.filename}: ${err instanceof Error ? err.message : String(err)}`,
        { label: 'ai.classify', status: 'fallback' },
      );
    }

    const next = applyClassificationResult(
      this.state,
      itemId,
      classification,
      contentHash,
      this.vaultDocuments,
      new Date().toISOString(),
      { allowDemoPlates: useMocks(), skippedAttachmentIds: this.skippedAttachmentIds },
    );
    this.emit({ ...next, lastStepAt: new Date().toISOString() });
  }
}

let engineSingleton: ScanEngine | null = null;

export function getScanEngine(): ScanEngine {
  if (!engineSingleton) engineSingleton = new ScanEngine();
  return engineSingleton;
}

export function resetScanEngine(): void {
  engineSingleton = null;
}

export function scanProgressView(state: ScanJobState): {
  stageLabel: string;
  percent: number;
  estimateLabel: string;
  candidates: ScanCandidate[];
} {
  const est = estimateRemaining(state);
  return {
    stageLabel: getActiveStageLabel(state.stage),
    percent: est.percent,
    estimateLabel: est.label,
    candidates: state.candidates,
  };
}

export { clearScanJobState };
