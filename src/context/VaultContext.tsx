import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ClassificationResult, ScanCandidate, SyncSuggestion, VaultDocument, VaultIndex } from '../types/document';
import { ScanJobState, ScanMode } from '../types/scan';
import { getDriveService } from '../services/drive';
import {
  addLocalDocument,
  applySyncSuggestion,
  saveCandidateToVault,
  syncDocumentFromGmail,
} from '../services/vaultOps';
import { clearScanJobState, getScanEngine } from '../services/scanEngine';
import { rekeyDemoVehicleSubjects } from '../lib/rekeyDemoSubjects';
import { useAuth } from './AuthContext';
import { useMocks } from '../services/config';

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
  approveCandidates: (ids: string[], subjectOverrides?: Record<string, string>) => Promise<void>;
  rejectCandidate: (id: string) => void;
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
      // Real vaults: strip leaked demo plate subjects from index metadata only
      // (never delete Drive files). Mock/demo vaults keep sample vehicles.
      const migrated = rekeyDemoVehicleSubjects(next, useMocks());
      if (migrated.changed) {
        await drive.saveIndex(migrated.index);
        next = migrated.index;
      }
      setIndex(next);
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
    void engine.hydrate().then((s) => {
      if (s) {
        setScanJob(s);
        setLastScanCandidates(s.candidates);
      }
      setScanEngineRunning(engine.isRunning());
    });
    return engine.subscribe((state) => {
      setScanJob({ ...state });
      setLastScanCandidates([...state.candidates]);
      setScanEngineRunning(engine.isRunning());
    });
  }, []);

  // Poll isRunning so the UI notices a dead loop even if stage still looks active.
  useEffect(() => {
    const t = setInterval(() => {
      setScanEngineRunning(getScanEngine().isRunning());
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Auto-resume after quota pause when resumeAfter has passed and app is open.
  // Skip auth (401) pauses — those need an interactive Google reconnect first.
  useEffect(() => {
    if (!scanJob || scanJob.stage !== 'paused_quota' || !scanJob.quotaPause || !index) return;
    if (scanJob.quotaPause.httpStatus === 401) return;
    const resumeAt = new Date(scanJob.quotaPause.resumeAfter).getTime();
    const delay = Math.max(0, resumeAt - Date.now());
    const t = setTimeout(() => {
      void getScanEngine().resume(index);
    }, delay + 50);
    return () => clearTimeout(t);
  }, [scanJob, index]);

  const updateDocument = useCallback(async (doc: VaultDocument) => {
    const drive = getDriveService();
    const next = await drive.upsertDocument(doc);
    setIndex(next);
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
        // Fail quickly in mocks so progress → quota-pause is easy to demo
        mockQuotaAfter: options.mockQuotaAfter ?? (useMocks() ? 1 : undefined),
      });
    },
    [index],
  );

  const resumeMailboxScan = useCallback(async () => {
    if (!index) {
      throw new Error('Vault not loaded from Google Drive — reconnect');
    }
    await getScanEngine().resume(index);
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
    setLastScanCandidates([]);
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
    async (ids: string[], subjectOverrides?: Record<string, string>) => {
      const selected = lastScanCandidates.filter(
        (c) =>
          ids.includes(c.id) &&
          (c.status === 'pending' || c.status === 'needs_subject_confirm') &&
          c.isGroupLatest !== false,
      );
      // Also include currentDocs that are latest even if isGroupLatest undefined
      const toSave = selected.length
        ? selected
        : lastScanCandidates.filter((c) => ids.includes(c.id) && c.status === 'pending');

      for (const raw of toSave) {
        const overrideKey = subjectOverrides?.[raw.id];
        const candidate = overrideKey
          ? applySubjectOverride(raw, overrideKey)
          : raw;
        // Older versions in the same group become Drive version history via apply path
        const older = lastScanCandidates.filter(
          (c) => c.groupId && c.groupId === candidate.groupId && c.id !== candidate.id && c.status === 'duplicate',
        );
        await saveCandidateToVault(candidate);
        // Store older as additional versions on the same doc when possible
        for (const old of older) {
          // Best-effort: save as separate historical files under _versions only when approving group latest
          try {
            await saveCandidateToVault({ ...old, status: 'pending' });
          } catch {
            // ignore
          }
        }
      }
      setLastScanCandidates((prev) =>
        prev.map((c) =>
          ids.includes(c.id) || (c.duplicateOfId && ids.includes(c.duplicateOfId))
            ? { ...c, status: 'approved' as const }
            : c,
        ),
      );
      if (index) {
        const drive = getDriveService();
        const next = {
          ...index,
          lastScanAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await drive.saveIndex(next);
        setIndex(next);
      }
      await refresh();
    },
    [lastScanCandidates, index, refresh],
  );

  const rejectCandidate = useCallback((id: string) => {
    setLastScanCandidates((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: 'rejected' as const } : c)),
    );
  }, []);

  const resolveAmbiguousSubject = useCallback((candidateId: string, subjectKey: string) => {
    setLastScanCandidates((prev) =>
      prev.map((c) => {
        if (c.id !== candidateId || !c.classification) return c;
        const label = subjectKey.replace(/^vehicle:reg:/, '').replace(/^vehicle:chassis:/, '');
        return {
          ...c,
          status: 'pending' as const,
          subjectAmbiguous: false,
          groupId: `vehicle_insurance::${subjectKey}`,
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
      }),
    );
  }, []);

  const seedScanCandidates = useCallback((candidates: ScanCandidate[]) => {
    setLastScanCandidates(candidates);
  }, []);

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
      resolveAmbiguousSubject,
      syncDocument,
      confirmSync,
      addDocument,
      search,
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
      resolveAmbiguousSubject,
      syncDocument,
      confirmSync,
      addDocument,
      search,
    ],
  );

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export function useVault() {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error('useVault must be used within VaultProvider');
  return ctx;
}
