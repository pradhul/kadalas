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
  saveCandidateToVault,
  syncDocumentFromGmail,
} from '../services/vaultOps';
import { clearScanJobState, getScanEngine } from '../services/scanEngine';
import { loadReviewState, saveReviewState } from '../services/reviewPersist';
import { rekeyDemoVehicleSubjects } from '../lib/rekeyDemoSubjects';
import { useAuth } from './AuthContext';
import { useMocks } from '../services/config';

export type ApproveResult = {
  folderPath: string;
  fileName: string;
};

interface VaultContextValue {
  index: VaultIndex | null;
  loading: boolean;
  error: string | null;
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
  ) => Promise<ApproveResult[]>;
  rejectCandidate: (id: string) => Promise<void>;
  /** Restore a skipped item back to pending and remove from skipped-id set. */
  restoreSkippedCandidate: (id: string) => Promise<void>;
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
  const [scanJob, setScanJob] = useState<ScanJobState | null>(null);
  const [lastScanCandidates, setLastScanCandidates] = useState<ScanCandidate[]>([]);
  const [scanEngineRunning, setScanEngineRunning] = useState(false);
  const [reviewState, setReviewState] = useState<ReviewState>(emptyReviewState);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const reviewRef = useRef(reviewState);
  reviewRef.current = reviewState;
  const candidatesRef = useRef(lastScanCandidates);
  candidatesRef.current = lastScanCandidates;

  const persistReview = useCallback(
    async (partial: { candidates: ScanCandidate[]; skippedIds?: string[] }) => {
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
    },
    [],
  );

  const refresh = useCallback(async () => {
    if (!session) {
      setIndex(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const drive = getDriveService();
      await drive.ensureVaultStructure();
      let next = await drive.loadIndex();
      const migrated = rekeyDemoVehicleSubjects(next, useMocks());
      if (migrated.changed) {
        await drive.saveIndex(migrated.index);
        next = migrated.index;
      }
      setIndex(next);
      if (next.updatedAt) setLastSyncedAt((prev) => prev ?? next.updatedAt);

      const review = await loadReviewState();
      reviewRef.current = review;
      setReviewState(review);
      if (review.lastSyncedAt) setLastSyncedAt(review.lastSyncedAt);
      getScanEngine().setSkippedAttachmentIds(review.skippedIds);

      // Restore review queue when scan-state is empty / older
      if (review.candidates.length) {
        setLastScanCandidates((prev) =>
          prev.length ? mergeReviewCandidates(prev, review) : review.candidates,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
      if (s) {
        setScanJob(s);
        const merged = mergeReviewCandidates(s.candidates, review);
        setLastScanCandidates(merged);
        // Prefer richer merged queue if review had decisions
        if (review.candidates.length || review.skippedIds.length) {
          void persistReview({ candidates: merged, skippedIds: review.skippedIds });
        }
      } else if (review.candidates.length) {
        setLastScanCandidates(review.candidates);
      }
      setScanEngineRunning(engine.isRunning());
    })();

    return engine.subscribe((state) => {
      setScanJob({ ...state });
      const merged = mergeReviewCandidates(state.candidates, reviewRef.current);
      setLastScanCandidates(merged);
      setScanEngineRunning(engine.isRunning());
      // Flush review queue to Drive when the scan finishes (approve/skip persist immediately).
      if (state.stage === 'completed' || state.stage === 'cancelled') {
        void persistReview({
          candidates: merged,
          skippedIds: reviewRef.current.skippedIds,
        });
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
    const drive = getDriveService();
    const next = await drive.upsertDocument(doc);
    setIndex(next);
    setLastSyncedAt(next.updatedAt);
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

  const approveCandidates = useCallback(
    async (ids: string[], subjectOverrides?: Record<string, string>): Promise<ApproveResult[]> => {
      const selected = lastScanCandidates.filter(
        (c) =>
          ids.includes(c.id) &&
          (c.status === 'pending' || c.status === 'needs_subject_confirm') &&
          c.isGroupLatest !== false,
      );
      const toSave = selected.length
        ? selected
        : lastScanCandidates.filter((c) => ids.includes(c.id) && c.status === 'pending');

      const results: ApproveResult[] = [];
      for (const raw of toSave) {
        const overrideKey = subjectOverrides?.[raw.id];
        const candidate = overrideKey ? applySubjectOverride(raw, overrideKey) : raw;
        const older = lastScanCandidates.filter(
          (c) =>
            c.groupId &&
            c.groupId === candidate.groupId &&
            c.id !== candidate.id &&
            c.status === 'duplicate',
        );
        const saved = await saveCandidateToVault(candidate);
        results.push({
          folderPath: `Kadalas/${saved.category}`,
          fileName: saved.title || candidate.fileName,
        });
        for (const old of older) {
          try {
            await saveCandidateToVault({ ...old, status: 'pending' });
          } catch {
            // ignore
          }
        }
      }

      const nextCandidates = lastScanCandidates.map((c) =>
        ids.includes(c.id) || (c.duplicateOfId && ids.includes(c.duplicateOfId))
          ? { ...c, status: 'approved' as const }
          : c,
      );
      setLastScanCandidates(nextCandidates);
      await persistReview({
        candidates: nextCandidates,
        skippedIds: reviewRef.current.skippedIds,
      });

      if (index) {
        const drive = getDriveService();
        const next = {
          ...index,
          lastScanAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await drive.saveIndex(next);
        setIndex(next);
        setLastSyncedAt(next.updatedAt);
      }
      await refresh();
      return results;
    },
    [lastScanCandidates, index, refresh, persistReview],
  );

  const rejectCandidate = useCallback(
    async (id: string) => {
      const target = candidatesRef.current.find((c) => c.id === id);
      const nextCandidates = candidatesRef.current.map((c) =>
        c.id === id ? { ...c, status: 'rejected' as const } : c,
      );
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

  const value = useMemo<VaultContextValue>(
    () => ({
      index,
      loading,
      error,
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
      resolveAmbiguousSubject,
      syncDocument,
      confirmSync,
      addDocument,
      search,
      reviewStats,
      lastSyncedAt,
      vaultFolderUrl,
      skippedAttachmentIds: reviewState.skippedIds,
    }),
    [
      index,
      loading,
      error,
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
      resolveAmbiguousSubject,
      syncDocument,
      confirmSync,
      addDocument,
      search,
      reviewStats,
      lastSyncedAt,
      vaultFolderUrl,
      reviewState.skippedIds,
    ],
  );

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export function useVault() {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error('useVault must be used within VaultProvider');
  return ctx;
}
