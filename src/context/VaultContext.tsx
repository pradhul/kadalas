import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ClassificationResult,
  ScanCandidate,
  SyncSuggestion,
  VaultDocument,
  VaultIndex,
} from '../types/document';
import {
  attachmentSkipKey,
  emptyReviewState,
  mergeReviewCandidates,
  reviewCounts,
  ReviewState,
} from '../types/review';
import { ScanJobState, ScanMode } from '../types/scan';
import { getDriveService } from '../services/drive';
import {
  addLocalDocument,
  applySyncSuggestion,
  approveCandidateByMode,
  syncDocumentFromGmail,
} from '../services/vaultOps';
import { clearScanJobState, getScanEngine } from '../services/scanEngine';
import { loadReviewState, saveReviewState } from '../services/reviewPersist';
import { loadIndexMirror, saveIndexMirror } from '../services/indexMirror';
import { runSelfSentCheck } from '../services/selfSentCheck';
import {
  ApproveSuccess,
  reclaimFalseApprovals,
  runApproveFlow,
} from '../lib/approveFlow';
import { debounceIdle } from '../lib/asyncUtils';
import { autoSkipDecorationCandidates } from '../lib/autoSkipDecorations';
import { rekeyDemoVehicleSubjects } from '../lib/rekeyDemoSubjects';
import { getActiveStageLabel } from '../lib/scanPipeline';
import { DEFAULT_STORAGE_MODE, StorageMode } from '../types/settings';
import { settingsFromIndex, withVaultSettings } from '../lib/vaultSettings';
import { useAuth } from './AuthContext';
import { ScanProgressProvider } from './ScanProgressContext';
import { useMocks } from '../services/config';

export type ApproveResult = ApproveSuccess;

interface VaultContextValue {
  index: VaultIndex | null;
  loading: boolean;
  error: string | null;
  /** Index save/load failure shown as a red banner — never silent. */
  indexSaveError: string | null;
  clearIndexSaveError: () => void;
  refresh: () => Promise<void>;
  documents: VaultDocument[];
  getDocument: (id: string) => VaultDocument | undefined;
  updateDocument: (doc: VaultDocument) => Promise<void>;
  /** Legacy simple progress — prefer scanJob */
  scanProgress: { message: string; current: number; total: number } | null;
  scanJob: ScanJobState | null;
  lastScanCandidates: ScanCandidate[];
  seedScanCandidates?: (candidates: ScanCandidate[]) => void;
  startMailboxScan: (options: {
    mode: ScanMode;
    lookbackDays?: number;
    mockQuotaAfter?: number;
  }) => Promise<void>;
  resumeMailboxScan: () => Promise<void>;
  pauseMailboxScan: () => Promise<void>;
  cancelMailboxScan: () => Promise<void>;
  /** Stop engine and overwrite scan-state.json with null (never delete Drive files). */
  resetMailboxScan: () => Promise<void>;
  /** Live engine loop flag — false when UI stage looks active but the loop died. */
  scanEngineRunning: boolean;
  /** @deprecated use startMailboxScan */
  runScan: (lookbackDays?: number) => Promise<ScanCandidate[]>;
  approveCandidates: (
    ids: string[],
    subjectOverrides?: Record<string, string>,
  ) => Promise<{ saved: ApproveResult[]; failed: Array<{ candidateId: string; reason: string }> }>;
  rejectCandidate: (id: string) => Promise<void>;
  /** Restore a skipped item back to pending and remove from skipped-id set. */
  restoreSkippedCandidate: (id: string) => Promise<void>;
  /** Patch a review candidate (AI detail cache, category override) — sync UI first. */
  patchScanCandidate: (id: string, patch: Partial<ScanCandidate>) => void;
  resolveAmbiguousSubject: (candidateId: string, subjectKey: string) => void;
  syncDocument: (docId: string) => Promise<SyncSuggestion | null>;
  confirmSync: (suggestion: SyncSuggestion) => Promise<void>;
  addDocument: (input: {
    fileName: string;
    mimeType: string;
    contentBase64: string;
    classification: ClassificationResult;
  }) => Promise<VaultDocument>;
  search: (query: string) => VaultDocument[];
  /** Counts for the review header */
  reviewStats: { toReview: number; approved: number; skipped: number };
  /** ISO time of last successful review-state Drive write (or vault index update). */
  lastSyncedAt: string | null;
  /** Open this URL to browse the Kadalas folder in Google Drive. */
  vaultFolderUrl: string | null;
  skippedAttachmentIds: string[];
  /** Approve storage mode (gmail_index default). */
  storageMode: StorageMode;
  setStorageMode: (mode: StorageMode) => Promise<void>;
  /** Lightweight self-sent kadalas check (manual save path). */
  checkSelfSentDocuments: () => Promise<{
    found: number;
    autoApproved: number;
    queuedForReview: number;
    skippedDuplicate: number;
  }>;
}

const VaultContext = createContext<VaultContextValue | null>(null);

function applySubjectOverride(c: ScanCandidate, subjectKey: string): ScanCandidate {
  if (!c.classification) return c;
  const label = subjectKey
    .replace(/^vehicle:reg:/, '')
    .replace(/^vehicle:chassis:/, '')
    .replace(/^weak:/, '')
    .replace(/^account:/, '');
  return {
    ...c,
    status: 'pending',
    subjectAmbiguous: false,
    groupId: subjectKey.startsWith('vehicle:')
      ? `vehicle_insurance::${subjectKey}`
      : c.groupId,
    groupLabel: label,
    classification: {
      ...c.classification,
      metadata: {
        ...c.classification.metadata,
        subjectKey,
        subjectLabel: label,
        subjectConfidence: '1',
        registrationNumber:
          c.classification.metadata.registrationNumber ||
          (subjectKey.startsWith('vehicle:reg:')
            ? subjectKey.replace('vehicle:reg:', '')
            : c.classification.metadata.registrationNumber),
      },
    },
  };
}

export function VaultProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const [index, setIndex] = useState<VaultIndex | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [indexSaveError, setIndexSaveError] = useState<string | null>(null);
  const [scanJob, setScanJob] = useState<ScanJobState | null>(null);
  const [lastScanCandidates, setLastScanCandidates] = useState<ScanCandidate[]>([]);
  const [scanEngineRunning, setScanEngineRunning] = useState(false);
  const [reviewState, setReviewState] = useState<ReviewState>(emptyReviewState);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const reviewRef = useRef(reviewState);
  reviewRef.current = reviewState;
  const candidatesRef = useRef(lastScanCandidates);
  candidatesRef.current = lastScanCandidates;
  const pendingPersist = useRef<{ candidates: ScanCandidate[]; skippedIds?: string[] } | null>(
    null,
  );

  const flushPersistReview = useCallback(async () => {
    const partial = pendingPersist.current;
    if (!partial) return null;
    pendingPersist.current = null;
    const base = reviewRef.current;
    const fromRejected = partial.candidates
      .filter((c) => c.status === 'rejected')
      .map(attachmentSkipKey);
    const prior = partial.skippedIds ?? base.skippedIds;
    const keptPrior = prior.filter((id) => {
      const still = partial.candidates.find((c) => attachmentSkipKey(c) === id);
      return !still || still.status === 'rejected';
    });
    const uniqueSkipped = [...new Set([...fromRejected, ...keptPrior])];
    const next: ReviewState = {
      version: 1,
      updatedAt: new Date().toISOString(),
      candidates: partial.candidates,
      skippedIds: uniqueSkipped,
      lastSyncedAt: base.lastSyncedAt,
    };
    const saved = await saveReviewState(next);
    reviewRef.current = saved;
    setReviewState(saved);
    setLastSyncedAt(saved.lastSyncedAt);
    getScanEngine().setSkippedAttachmentIds(saved.skippedIds);
    return saved;
  }, []);

  const debouncedPersist = useMemo(
    () =>
      debounceIdle(() => {
        void flushPersistReview();
      }, 800),
    [flushPersistReview],
  );

  const persistReview = useCallback(
    async (partial: { candidates: ScanCandidate[]; skippedIds?: string[] }, opts?: { flush?: boolean }) => {
      pendingPersist.current = partial;
      // Keep local reviewRef candidates in sync immediately for subsequent merges
      reviewRef.current = {
        ...reviewRef.current,
        candidates: partial.candidates,
        skippedIds: partial.skippedIds ?? reviewRef.current.skippedIds,
        updatedAt: new Date().toISOString(),
      };
      if (opts?.flush) {
        debouncedPersist.cancel();
        return flushPersistReview();
      }
      debouncedPersist();
      return reviewRef.current;
    },
    [debouncedPersist, flushPersistReview],
  );

  useEffect(() => {
    const flush = () => {
      debouncedPersist.flush();
      void flushPersistReview();
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', flush);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', flush);
    }
    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', flush);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', flush);
      }
      flush();
    };
  }, [debouncedPersist, flushPersistReview]);

  function applyAutoSkip(candidates: ScanCandidate[], skippedIds: string[]) {
    const auto = autoSkipDecorationCandidates(candidates);
    if (!auto.changedIds.length) {
      return { candidates, skippedIds, changedIds: [] as string[] };
    }
    return {
      candidates: auto.candidates,
      skippedIds: [...new Set([...skippedIds, ...auto.skippedIds])],
      changedIds: auto.changedIds,
    };
  }

  const clearIndexSaveError = useCallback(() => setIndexSaveError(null), []);

  const refresh = useCallback(async () => {
    if (!session) {
      setIndex(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Paint instantly from local mirror, then reconcile with Drive
      const mirrored = await loadIndexMirror();
      if (mirrored?.documents?.length) {
        setIndex((prev) => (prev?.documents?.length ? prev : mirrored));
      }

      const drive = getDriveService();
      await drive.ensureVaultStructure();
      let next = await drive.loadIndex();
      const migrated = rekeyDemoVehicleSubjects(next, useMocks());
      if (migrated.changed) {
        await drive.saveIndex(migrated.index);
        next = migrated.index;
      }
      setIndex(next);
      await saveIndexMirror(next);
      setIndexSaveError(null);
      if (next.updatedAt) setLastSyncedAt((prev) => prev ?? next.updatedAt);

      const review = await loadReviewState();
      reviewRef.current = review;
      setReviewState(review);
      if (review.lastSyncedAt) setLastSyncedAt(review.lastSyncedAt);
      getScanEngine().setSkippedAttachmentIds(review.skippedIds);

      // Restore review queue; roll back false approvals; auto-skip email decorations
      if (review.candidates.length) {
        const reclaimed = reclaimFalseApprovals(review.candidates, next.documents);
        const auto = applyAutoSkip(reclaimed.candidates, review.skippedIds);
        setLastScanCandidates((prev) =>
          prev.length
            ? mergeReviewCandidates(prev, { ...review, candidates: auto.candidates })
            : auto.candidates,
        );
        if (reclaimed.reclaimedIds.length || auto.changedIds.length) {
          if (auto.changedIds.length) {
            getScanEngine().logEvent(
              `Auto-skipped ${auto.changedIds.length} email decoration(s)`,
            );
          }
          if (reclaimed.reclaimedIds.length) {
            getScanEngine().logEvent(
              `Reclaimed ${reclaimed.reclaimedIds.length} false approval(s) → pending (no Drive file)`,
            );
          }
          await persistReview(
            { candidates: auto.candidates, skippedIds: auto.skippedIds },
            { flush: true },
          );
        }
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      setError(reason);
      setIndexSaveError(`Couldn't save your vault list: ${reason}`);
      // Keep mirror so Home is not empty on flaky Drive reads
      const mirrored = await loadIndexMirror();
      if (mirrored) setIndex(mirrored);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const engine = getScanEngine();
    void (async () => {
      const review = await loadReviewState();
      reviewRef.current = review;
      setReviewState(review);
      if (review.lastSyncedAt) setLastSyncedAt(review.lastSyncedAt);
      engine.setSkippedAttachmentIds(review.skippedIds);

      const s = await engine.hydrate();
      const vaultDocs = (await getDriveService().loadIndex().catch(() => null))?.documents ?? [];
      if (s) {
        setScanJob(s);
        let merged = mergeReviewCandidates(s.candidates, review);
        const reclaimed = reclaimFalseApprovals(merged, vaultDocs);
        const auto = applyAutoSkip(reclaimed.candidates, review.skippedIds);
        merged = auto.candidates;
        setLastScanCandidates(merged);
        if (
          review.candidates.length ||
          review.skippedIds.length ||
          reclaimed.reclaimedIds.length ||
          auto.changedIds.length
        ) {
          void persistReview({ candidates: merged, skippedIds: auto.skippedIds });
        }
      } else if (review.candidates.length) {
        const reclaimed = reclaimFalseApprovals(review.candidates, vaultDocs);
        const auto = applyAutoSkip(reclaimed.candidates, review.skippedIds);
        setLastScanCandidates(auto.candidates);
        if (reclaimed.reclaimedIds.length || auto.changedIds.length) {
          void persistReview({
            candidates: auto.candidates,
            skippedIds: auto.skippedIds,
          });
        }
      }
      setScanEngineRunning(engine.isRunning());
    })();

    return engine.subscribe((state) => {
      setScanJob({ ...state });
      let merged = mergeReviewCandidates(state.candidates, reviewRef.current);
      const auto = applyAutoSkip(merged, reviewRef.current.skippedIds);
      merged = auto.candidates;
      setLastScanCandidates(merged);
      setScanEngineRunning(engine.isRunning());
      // Flush review queue to Drive when the scan finishes (approve/skip persist immediately).
      if (state.stage === 'completed' || state.stage === 'cancelled') {
        void persistReview(
          {
            candidates: merged,
            skippedIds: auto.skippedIds,
          },
          { flush: true },
        );
      } else if (auto.changedIds.length) {
        void persistReview({ candidates: merged, skippedIds: auto.skippedIds });
      }
    });
  }, [persistReview]);

  useEffect(() => {
    const t = setInterval(() => {
      setScanEngineRunning(getScanEngine().isRunning());
    }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!scanJob || scanJob.stage !== 'paused_quota' || !scanJob.quotaPause || !index) return;
    if (scanJob.quotaPause.httpStatus === 401) return;
    const resumeAt = new Date(scanJob.quotaPause.resumeAfter).getTime();
    const delay = Math.max(0, resumeAt - Date.now());
    const t = setTimeout(() => {
      void getScanEngine().resume(index, {
        skippedAttachmentIds: reviewRef.current.skippedIds,
      });
    }, delay + 50);
    return () => clearTimeout(t);
  }, [scanJob, index]);

  const updateDocument = useCallback(async (doc: VaultDocument) => {
    try {
      const drive = getDriveService();
      const next = await drive.upsertDocument(doc);
      setIndex(next);
      await saveIndexMirror(next);
      setLastSyncedAt(next.updatedAt);
      setIndexSaveError(null);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      setIndexSaveError(`Couldn't save your vault list: ${reason}`);
      throw e;
    }
  }, []);

  const startMailboxScan = useCallback(
    async (options: { mode: ScanMode; lookbackDays?: number; mockQuotaAfter?: number }) => {
      if (!index) {
        throw new Error('Vault not loaded from Google Drive — reconnect');
      }
      await clearScanJobState();
      await getScanEngine().start({
        mode: options.mode,
        lookbackDays: options.lookbackDays,
        sinceIso: options.mode === 'incremental' ? index.lastScanAt : null,
        vaultIndex: index,
        mockQuotaAfter: options.mockQuotaAfter ?? (useMocks() ? 1 : undefined),
        skippedAttachmentIds: reviewRef.current.skippedIds,
      });
    },
    [index],
  );

  const resumeMailboxScan = useCallback(async () => {
    if (!index) {
      throw new Error('Vault not loaded from Google Drive — reconnect');
    }
    await getScanEngine().resume(index, {
      skippedAttachmentIds: reviewRef.current.skippedIds,
    });
  }, [index]);

  const pauseMailboxScan = useCallback(async () => {
    await getScanEngine().pause();
  }, []);

  const cancelMailboxScan = useCallback(async () => {
    await getScanEngine().cancel();
  }, []);

  const resetMailboxScan = useCallback(async () => {
    await getScanEngine().reset();
    setScanJob(null);
    // Keep skipped ids; clear only the active scan job. Review queue stays for decisions.
    setScanEngineRunning(false);
  }, []);

  const runScan = useCallback(
    async (lookbackDays = 90) => {
      await startMailboxScan({
        mode: index?.lastScanAt ? 'incremental' : 'lookback',
        lookbackDays,
      });
      return getScanEngine().getState()?.candidates ?? [];
    },
    [index, startMailboxScan],
  );

  const storageMode: StorageMode = settingsFromIndex(index).storageMode || DEFAULT_STORAGE_MODE;

  const setStorageMode = useCallback(
    async (mode: StorageMode) => {
      try {
        const drive = getDriveService();
        const current = index ?? (await drive.loadIndex());
        const next = withVaultSettings(current, { storageMode: mode });
        // Never delete Drive files when switching modes — only change future Approve behavior.
        await drive.saveIndex(next);
        setIndex(next);
        await saveIndexMirror(next);
        setLastSyncedAt(next.updatedAt);
        setIndexSaveError(null);
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        setIndexSaveError(`Couldn't save your vault list: ${reason}`);
        throw e;
      }
    },
    [index],
  );

  const approveCandidates = useCallback(
    async (
      ids: string[],
      subjectOverrides?: Record<string, string>,
    ): Promise<{ saved: ApproveResult[]; failed: Array<{ candidateId: string; reason: string }> }> => {
      const mode = settingsFromIndex(index).storageMode;
      let latestIndex: VaultIndex | null = index;
      const flow = await runApproveFlow({
        ids,
        candidates: lastScanCandidates,
        subjectOverrides,
        applySubjectOverride,
        save: async (candidate) => {
          const overrideCat = candidate.categoryOverride;
          const result = await approveCandidateByMode(
            candidate,
            mode,
            overrideCat
              ? {
                  category: overrideCat,
                  metadata: candidate.classification?.metadata,
                }
              : undefined,
          );
          // upsertDocument already persisted; pull fresh merged index for Home
          const drive = getDriveService();
          latestIndex = await drive.loadIndex();
          setIndex(latestIndex);
          await saveIndexMirror(latestIndex);
          return {
            category: result.category,
            title: result.document.title,
            driveFileId: result.driveFileId,
            webViewLink: result.webViewLink,
            storageKind: result.storageKind,
          };
        },
      });

      // Synchronous UI update; await flush so navigation/reload cannot drop review state
      setLastScanCandidates(flow.candidates);
      candidatesRef.current = flow.candidates;
      await persistReview(
        {
          candidates: flow.candidates,
          skippedIds: reviewRef.current.skippedIds,
        },
        { flush: true },
      );

      for (const fail of flow.failed) {
        getScanEngine().logEvent(`Approve failed for ${fail.candidateId}: ${fail.reason}`);
      }
      for (const ok of flow.saved) {
        getScanEngine().logEvent(
          ok.storageKind === 'gmail_index'
            ? `Indexed ${ok.fileName} (Gmail index — no Drive upload)`
            : `Approved ${ok.fileName} → ${ok.folderPath} (${ok.driveFileId})`,
        );
      }

      if (flow.saved.length) {
        try {
          const drive = getDriveService();
          const fresh = latestIndex ?? (await drive.loadIndex());
          const next = {
            ...fresh,
            lastScanAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            settings: fresh.settings ?? index?.settings,
          };
          await drive.saveIndex(next);
          setIndex(next);
          await saveIndexMirror(next);
          setLastSyncedAt(next.updatedAt);
          setIndexSaveError(null);
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e);
          setIndexSaveError(`Couldn't save your vault list: ${reason}`);
          // Downgrade "saved" that didn't stick on the final index write
          return {
            saved: [],
            failed: [
              ...flow.failed,
              ...flow.saved.map((s) => ({
                candidateId: s.candidateId,
                reason: `Index save failed: ${reason}`,
              })),
            ],
          };
        }
      }

      return { saved: flow.saved, failed: flow.failed };
    },
    [lastScanCandidates, index, persistReview],
  );

  const patchScanCandidate = useCallback((id: string, patch: Partial<ScanCandidate>) => {
    const nextCandidates = candidatesRef.current.map((c) =>
      c.id === id ? { ...c, ...patch } : c,
    );
    candidatesRef.current = nextCandidates;
    setLastScanCandidates(nextCandidates);
    void persistReview({
      candidates: nextCandidates,
      skippedIds: reviewRef.current.skippedIds,
    });
  }, [persistReview]);

  const rejectCandidate = useCallback(
    async (id: string) => {
      const target = candidatesRef.current.find((c) => c.id === id);
      const nextCandidates = candidatesRef.current.map((c) =>
        c.id === id ? { ...c, status: 'rejected' as const, skipReason: c.skipReason } : c,
      );
      candidatesRef.current = nextCandidates;
      setLastScanCandidates(nextCandidates);
      const skippedIds = [...reviewRef.current.skippedIds];
      if (target) {
        const key = attachmentSkipKey(target);
        if (!skippedIds.includes(key)) skippedIds.push(key);
      }
      await persistReview({ candidates: nextCandidates, skippedIds });
    },
    [persistReview],
  );

  const restoreSkippedCandidate = useCallback(
    async (id: string) => {
      const target = candidatesRef.current.find((c) => c.id === id);
      const nextCandidates = candidatesRef.current.map((c) =>
        c.id === id ? { ...c, status: 'pending' as const } : c,
      );
      setLastScanCandidates(nextCandidates);
      const key = target ? attachmentSkipKey(target) : null;
      const skippedIds = reviewRef.current.skippedIds.filter((k) => k !== key);
      await persistReview({ candidates: nextCandidates, skippedIds });
    },
    [persistReview],
  );

  const resolveAmbiguousSubject = useCallback((candidateId: string, subjectKey: string) => {
    setLastScanCandidates((prev) =>
      prev.map((c) => {
        if (c.id !== candidateId || !c.classification) return c;
        return applySubjectOverride(c, subjectKey);
      }),
    );
  }, []);

  const seedScanCandidates = useCallback(
    (candidates: ScanCandidate[]) => {
      const merged = mergeReviewCandidates(candidates, reviewRef.current);
      setLastScanCandidates(merged);
      void persistReview({
        candidates: merged,
        skippedIds: reviewRef.current.skippedIds,
      });
    },
    [persistReview],
  );

  const syncDocument = useCallback(
    async (docId: string) => {
      const doc = index?.documents.find((d) => d.id === docId);
      if (!doc) return null;
      return syncDocumentFromGmail(doc);
    },
    [index],
  );

  const confirmSync = useCallback(
    async (suggestion: SyncSuggestion) => {
      await applySyncSuggestion(suggestion);
      await refresh();
    },
    [refresh],
  );

  const addDocument = useCallback(
    async (input: {
      fileName: string;
      mimeType: string;
      contentBase64: string;
      classification: ClassificationResult;
    }) => {
      const doc = await addLocalDocument(input);
      await refresh();
      return doc;
    },
    [refresh],
  );

  const checkSelfSentDocuments = useCallback(async () => {
    const result = await runSelfSentCheck({
      userEmail: session?.user.email,
      vaultDocuments: index?.documents ?? [],
      autoApprove: async (candidate) => {
        await approveCandidateByMode(candidate, settingsFromIndex(index).storageMode);
      },
      enqueueReview: async (incoming) => {
        const merged = [...incoming, ...candidatesRef.current];
        // Prefer higher reviewPriority first
        merged.sort((a, b) => (b.reviewPriority || 0) - (a.reviewPriority || 0));
        candidatesRef.current = merged;
        setLastScanCandidates(merged);
        await persistReview(
          { candidates: merged, skippedIds: reviewRef.current.skippedIds },
          { flush: true },
        );
      },
    });
    if (result.autoApproved) await refresh();
    return result;
  }, [session?.user.email, index, persistReview, refresh]);

  // Lightweight self-sent check when the app opens / vault loads
  useEffect(() => {
    if (!session || !index) return;
    void checkSelfSentDocuments().catch(() => undefined);
  }, [session?.user.email]); // eslint-disable-line react-hooks/exhaustive-deps

  const search = useCallback(
    (query: string) => {
      const q = query.trim().toLowerCase();
      if (!q || !index) return index?.documents ?? [];
      return index.documents.filter((doc) => {
        const hay = [
          doc.title,
          doc.category,
          doc.metadata.issuer,
          doc.metadata.documentType,
          doc.metadata.referenceNumber,
          doc.metadata.registrationNumber,
          doc.metadata.subjectLabel,
          doc.metadata.holderName,
          doc.metadata.coverageType,
          doc.metadata.notes,
          ...(doc.tags || []),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });
    },
    [index],
  );

  const scanProgress = useMemo(() => {
    if (!scanJob || ['idle', 'completed', 'cancelled'].includes(scanJob.stage)) return null;
    const total = scanJob.stats.emailsEstimatedTotal || Math.max(scanJob.stats.emailsChecked, 1);
    return {
      message: `${scanJob.stage} · ${scanJob.stats.documentsFound} docs`,
      current: scanJob.stats.emailsChecked,
      total,
    };
  }, [scanJob]);

  const vaultFolderUrl = useMemo(() => {
    if (!index?.vaultFolderId) return null;
    if (useMocks()) return null;
    return `https://drive.google.com/drive/folders/${index.vaultFolderId}`;
  }, [index?.vaultFolderId]);

  const reviewStats = useMemo(() => reviewCounts(lastScanCandidates), [lastScanCandidates]);

  const scanProgressSlice = useMemo(
    () => ({
      scanJob,
      scanEngineRunning,
      progressPercent: Math.min(100, Math.max(0, scanJob?.stats.progressHighWater ?? 0)),
      stageLabel: scanJob
        ? getActiveStageLabel(scanJob.stage, {
            authPause: scanJob.quotaPause?.httpStatus === 401,
          })
        : 'idle',
    }),
    [scanJob, scanEngineRunning],
  );

  const value = useMemo<VaultContextValue>(
    () => ({
      index,
      loading,
      error,
      indexSaveError,
      clearIndexSaveError,
      refresh,
      documents: index?.documents ?? [],
      getDocument: (id) => index?.documents.find((d) => d.id === id),
      updateDocument,
      scanProgress,
      scanJob,
      lastScanCandidates,
      seedScanCandidates,
      startMailboxScan,
      resumeMailboxScan,
      pauseMailboxScan,
      cancelMailboxScan,
      resetMailboxScan,
      scanEngineRunning,
      runScan,
      approveCandidates,
      rejectCandidate,
      restoreSkippedCandidate,
      patchScanCandidate,
      resolveAmbiguousSubject,
      syncDocument,
      confirmSync,
      addDocument,
      search,
      reviewStats,
      lastSyncedAt,
      vaultFolderUrl,
      skippedAttachmentIds: reviewState.skippedIds,
      storageMode,
      setStorageMode,
      checkSelfSentDocuments,
    }),
    [
      index,
      loading,
      error,
      indexSaveError,
      clearIndexSaveError,
      refresh,
      updateDocument,
      scanProgress,
      scanJob,
      lastScanCandidates,
      seedScanCandidates,
      startMailboxScan,
      resumeMailboxScan,
      pauseMailboxScan,
      cancelMailboxScan,
      resetMailboxScan,
      scanEngineRunning,
      runScan,
      approveCandidates,
      rejectCandidate,
      restoreSkippedCandidate,
      patchScanCandidate,
      resolveAmbiguousSubject,
      syncDocument,
      confirmSync,
      addDocument,
      search,
      reviewStats,
      lastSyncedAt,
      vaultFolderUrl,
      reviewState.skippedIds,
      storageMode,
      setStorageMode,
      checkSelfSentDocuments,
    ],
  );

  return (
    <VaultContext.Provider value={value}>
      <ScanProgressProvider value={scanProgressSlice}>{children}</ScanProgressProvider>
    </VaultContext.Provider>
  );
}

export function useVault() {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error('useVault must be used within VaultProvider');
  return ctx;
}
