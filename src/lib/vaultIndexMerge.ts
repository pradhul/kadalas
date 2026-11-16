import { VaultDocument, VaultIndex } from '../types/document';

export type IndexFileMeta = {
  id: string;
  modifiedTime: string;
  /** Optional parsed body when already fetched */
  index?: VaultIndex;
};

/** Newest modifiedTime first. Equal times keep stable order by id. */
export function sortIndexFilesNewestFirst(files: IndexFileMeta[]): IndexFileMeta[] {
  return [...files].sort((a, b) => {
    const ta = Date.parse(a.modifiedTime) || 0;
    const tb = Date.parse(b.modifiedTime) || 0;
    if (tb !== ta) return tb - ta;
    return a.id.localeCompare(b.id);
  });
}

/** Canonical write target: preferred id if still present, else newest by modifiedTime. */
export function pickCanonicalIndexFileId(
  files: IndexFileMeta[],
  preferredFileId?: string | null,
): string | null {
  if (!files.length) return null;
  if (preferredFileId && files.some((f) => f.id === preferredFileId)) {
    return preferredFileId;
  }
  return sortIndexFilesNewestFirst(files)[0]?.id ?? null;
}

/**
 * Merge documents from several vault-index.json copies (drive.file can create duplicates).
 * Per document id, keep the copy with the newest document.updatedAt (fallback: file modifiedTime).
 * Never drops a document that only exists in an older file.
 */
export function mergeVaultIndexes(
  parts: Array<{ index: VaultIndex; modifiedTime: string }>,
  vaultFolderId: string,
): VaultIndex {
  if (!parts.length) {
    return {
      version: 1,
      vaultFolderId,
      lastScanAt: null,
      documents: [],
      updatedAt: new Date().toISOString(),
      settings: { storageMode: 'gmail_index' },
    };
  }

  const byId = new Map<string, { doc: VaultDocument; score: number }>();
  let lastScanAt: string | null = null;
  let settings: VaultIndex['settings'] | undefined;
  let newestUpdated = 0;

  for (const part of parts) {
    const fileScore = Date.parse(part.modifiedTime) || 0;
    const idxUpdated = Date.parse(part.index.updatedAt) || 0;
    if (idxUpdated >= newestUpdated) {
      newestUpdated = idxUpdated;
      if (part.index.settings) settings = part.index.settings;
    }
    if (part.index.lastScanAt) {
      const t = Date.parse(part.index.lastScanAt) || 0;
      const prev = lastScanAt ? Date.parse(lastScanAt) || 0 : 0;
      if (t >= prev) lastScanAt = part.index.lastScanAt;
    }
    for (const doc of part.index.documents || []) {
      const docScore = Date.parse(doc.updatedAt) || fileScore;
      const existing = byId.get(doc.id);
      if (!existing || docScore >= existing.score) {
        byId.set(doc.id, { doc, score: docScore });
      }
    }
  }

  const documents = [...byId.values()]
    .map((v) => v.doc)
    .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));

  return {
    version: 1,
    vaultFolderId: parts[0]?.index.vaultFolderId || vaultFolderId,
    lastScanAt,
    documents,
    updatedAt: new Date(Math.max(newestUpdated, Date.now())).toISOString(),
    settings: settings ?? { storageMode: 'gmail_index' },
  };
}

/** Buggy drive.file behavior: take files[0] with no ordering (arbitrary). */
export function pickArbitraryIndexFileId(files: IndexFileMeta[]): string | null {
  return files[0]?.id ?? null;
}
