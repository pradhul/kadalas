import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ClassificationResult, ScanCandidate, SyncSuggestion, VaultDocument, VaultIndex } from '../types/document';
import { getDriveService } from '../services/drive';
import {
  addLocalDocument,
  applySyncSuggestion,
  saveCandidateToVault,
  scanGmailForDocuments,
  syncDocumentFromGmail,
} from '../services/vaultOps';
import { useAuth } from './AuthContext';

interface VaultContextValue {
  index: VaultIndex | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  documents: VaultDocument[];
  getDocument: (id: string) => VaultDocument | undefined;
  updateDocument: (doc: VaultDocument) => Promise<void>;
  scanProgress: { message: string; current: number; total: number } | null;
  lastScanCandidates: ScanCandidate[];
  seedScanCandidates?: (candidates: ScanCandidate[]) => void;
  runScan: (lookbackDays?: number) => Promise<ScanCandidate[]>;
  approveCandidates: (ids: string[]) => Promise<void>;
  rejectCandidate: (id: string) => void;
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

export function VaultProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const [index, setIndex] = useState<VaultIndex | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState<{ message: string; current: number; total: number } | null>(
    null,
  );
  const [lastScanCandidates, setLastScanCandidates] = useState<ScanCandidate[]>([]);

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
      const next = await drive.loadIndex();
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

  const updateDocument = useCallback(async (doc: VaultDocument) => {
    const drive = getDriveService();
    const next = await drive.upsertDocument(doc);
    setIndex(next);
  }, []);

  const runScan = useCallback(
    async (lookbackDays = 90) => {
      if (!index) return [];
      setScanProgress({ message: 'Starting scan…', current: 0, total: 1 });
      try {
        const { candidates } = await scanGmailForDocuments({
          lookbackDays,
          index,
          onProgress: (message, current, total) => setScanProgress({ message, current, total }),
        });
        setLastScanCandidates(candidates);
        const drive = getDriveService();
        const next = {
          ...index,
          lastScanAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await drive.saveIndex(next);
        setIndex(next);
        return candidates;
      } finally {
        setScanProgress(null);
      }
    },
    [index],
  );

  const approveCandidates = useCallback(
    async (ids: string[]) => {
      const selected = lastScanCandidates.filter((c) => ids.includes(c.id) && c.status === 'pending');
      for (const candidate of selected) {
        await saveCandidateToVault(candidate);
      }
      setLastScanCandidates((prev) =>
        prev.map((c) => (ids.includes(c.id) ? { ...c, status: 'approved' as const } : c)),
      );
      await refresh();
    },
    [lastScanCandidates, refresh],
  );

  const rejectCandidate = useCallback((id: string) => {
    setLastScanCandidates((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: 'rejected' as const } : c)),
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
          doc.metadata.holderName,
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
      lastScanCandidates,
      seedScanCandidates,
      runScan,
      approveCandidates,
      rejectCandidate,
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
      lastScanCandidates,
      seedScanCandidates,
      runScan,
      approveCandidates,
      rejectCandidate,
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
