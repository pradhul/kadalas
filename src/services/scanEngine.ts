import { classifyWithRules } from '../lib/categorisation';
import { hashBytes } from '../lib/hash';
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
import { clearScanJobState, loadScanJobState, saveScanJobState } from './scanPersist';
import { useMocks } from './config';

export type ScanEngineListener = (state: ScanJobState) => void;

export class ScanEngine {
  private state: ScanJobState | null = null;
  private running = false;
  private listeners = new Set<ScanEngineListener>();
  private stopRequested: 'pause' | 'cancel' | null = null;
  private vaultDocuments: VaultIndex['documents'] = [];

  subscribe(listener: ScanEngineListener): () => void {
    this.listeners.add(listener);
    if (this.state) listener(this.state);
    return () => this.listeners.delete(listener);
  }

  getState(): ScanJobState | null {
    return this.state;
  }

  private emit(state: ScanJobState) {
    this.state = state;
    this.listeners.forEach((l) => l(state));
  }

  async hydrate(): Promise<ScanJobState | null> {
    const loaded = await loadScanJobState();
    if (loaded) this.emit(loaded);
    return loaded;
  }

  async start(options: {
    mode: ScanMode;
    lookbackDays?: number;
    sinceIso?: string | null;
    vaultIndex: VaultIndex;
    /** In mock mode, force quota after N AI calls for demos */
    mockQuotaAfter?: number;
  }): Promise<void> {
    this.vaultDocuments = options.vaultIndex.documents;
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
    this.emit(job);
    await saveScanJobState(job);
    await this.runLoop();
  }

  async resume(vaultIndex: VaultIndex): Promise<void> {
    this.vaultDocuments = vaultIndex.documents;
    if (!this.state) await this.hydrate();
    if (!this.state) return;
    // After a quota pause, allow another short burst then pause again in mocks
    if (useMocks()) getAiService().__setMockQuotaFailAfter?.(3);
    const next = resumeScan(this.state);
    this.stopRequested = null;
    this.emit(next);
    await saveScanJobState(next);
    await this.runLoop();
  }

  async pause(): Promise<void> {
    this.stopRequested = 'pause';
    if (this.state && !this.running) {
      const next = pauseByUser(this.state);
      this.emit(next);
      await saveScanJobState(next);
    }
  }

  async cancel(): Promise<void> {
    this.stopRequested = 'cancel';
    if (this.state) {
      const next = cancelScan(this.state);
      this.emit(next);
      await saveScanJobState(next);
    }
  }

  private async runLoop(): Promise<void> {
    if (this.running || !this.state) return;
    this.running = true;
    try {
      while (this.state && !['completed', 'cancelled', 'paused_quota', 'paused_user'].includes(this.state.stage)) {
        if (this.stopRequested === 'cancel') {
          this.emit(cancelScan(this.state));
          await saveScanJobState(this.state!);
          break;
        }
        if (this.stopRequested === 'pause') {
          this.emit(pauseByUser(this.state));
          await saveScanJobState(this.state!);
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
            const next = finalizeDedupeGrouping(this.state);
            this.emit(next);
            await saveScanJobState(next);
          } else {
            break;
          }
        } catch (err) {
          if (isAuthError(err)) {
            const next = pauseForAuth(this.state, {
              message: err instanceof Error ? err.message : 'Session expired — tap to reconnect Google',
              status: (err as { status?: number }).status ?? 401,
            });
            this.emit(next);
            await saveScanJobState(next);
            break;
          }
          if (isQuotaError(err)) {
            const status = (err as { status?: number }).status;
            const next = pauseForQuota(
              this.state,
              { message: err instanceof Error ? err.message : String(err), status },
              // Keep paused long enough to inspect / screenshot; user can Resume anytime
              useMocks() ? 30 * 60 * 1000 : 60 * 60 * 1000,
            );
            this.emit(next);
            await saveScanJobState(next);
            break;
          }
          throw err;
        }

        // Persist frequently so resume works across restarts
        if (this.state) await saveScanJobState(this.state);
      }
    } finally {
      this.running = false;
    }
  }

  private async stepSearch(): Promise<void> {
    if (!this.state) return;
    const gmail = getGmailService();
    const page = await gmail.searchAttachmentsPage({
      query: this.state.gmailQuery,
      maxResults: useMocks() ? 40 : DEFAULT_GMAIL_PAGE_SIZE,
      pageToken: this.state.gmailPageToken,
    });
    let next = ingestSearchPage(this.state, page);
    // Keep mock UI responsive: after a few pages, finish search and drain queues
    if (useMocks() && next.stats.emailsChecked >= 100) {
      next = {
        ...next,
        gmailSearchDone: true,
        gmailPageToken: null,
        stage: next.triageQueue.length ? 'triage' : next.classifyQueue.length ? 'classify' : 'dedupe',
      };
    }
    this.emit(next);
  }

  private async stepTriage(): Promise<void> {
    if (!this.state) return;
    const batch = takeTriageBatch(this.state, useMocks() ? 6 : DEFAULT_TRIAGE_BATCH_SIZE);
    if (!batch.length) {
      // Nothing to triage — advance stage
      const next = {
        ...this.state,
        stage: !this.state.gmailSearchDone
          ? ('search' as const)
          : this.state.classifyQueue.length
            ? ('classify' as const)
            : ('dedupe' as const),
        updatedAt: new Date().toISOString(),
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
    try {
      decisions = await ai.triageBatch(triageInput);
    } catch (err) {
      if (isQuotaError(err) || isAuthError(err)) throw err;
      // Non-fatal (e.g. model 404) — fall back to rule triage so the scan can finish
      decisions = ruleTriage(triageInput);
      warning =
        err instanceof Error
          ? `AI triage unavailable (${err.message}); using rule triage`
          : 'AI triage unavailable; using rule triage';
    }
    const next = {
      ...applyTriageBatch(this.state, decisions),
      lastWarning: warning ?? this.state.lastWarning ?? null,
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
      });
      return;
    }

    const item = this.state.items[itemId];
    const gmail = getGmailService();
    const ai = getAiService();
    let contentHash: string | undefined;
    let classification;

    try {
      const content = await gmail.getAttachment(item.attachment.messageId, item.attachment.attachmentId);
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
    } catch (err) {
      if (isQuotaError(err)) throw err;
      classification = classifyWithRules({
        subject: item.attachment.subject,
        from: item.attachment.from,
        fileName: item.attachment.filename,
        mimeType: item.attachment.mimeType,
        snippet: item.attachment.snippet,
      });
    }

    const next = applyClassificationResult(
      this.state,
      itemId,
      classification,
      contentHash,
      this.vaultDocuments,
    );
    this.emit(next);
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
