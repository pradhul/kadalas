import { INDEX_FILENAME, VaultDocument, VaultIndex } from '../../types/document';
import {
  IndexFileMeta,
  mergeVaultIndexes,
  pickArbitraryIndexFileId,
  pickCanonicalIndexFileId,
} from '../../lib/vaultIndexMerge';

export type ListedIndexFile = {
  id: string;
  modifiedTime: string;
  /** When true, reading/writing this location is forbidden (e.g. appDataFolder without drive.appdata). */
  appDataFolder?: boolean;
};

export type VaultIndexDriveApi = {
  listIndexFiles(vaultFolderId: string): Promise<ListedIndexFile[]>;
  readIndexFile(fileId: string): Promise<VaultIndex>;
  createIndexFile(vaultFolderId: string, body: string): Promise<{ id: string; modifiedTime: string }>;
  updateIndexFile(fileId: string, body: string): Promise<{ modifiedTime: string }>;
};

export type VaultIndexIdStore = {
  getPreferredFileId(): Promise<string | null>;
  setPreferredFileId(id: string): Promise<void>;
};

export type VaultIndexMirror = {
  load(): Promise<VaultIndex | null>;
  save(index: VaultIndex): Promise<void>;
};

export type VaultIndexStoreMode = 'fixed' | 'buggy_arbitrary_first';

export type VaultIndexStore = {
  loadIndex(vaultFolderId: string): Promise<VaultIndex>;
  saveIndex(vaultFolderId: string, index: VaultIndex): Promise<VaultIndex>;
  upsertDocument(vaultFolderId: string, doc: VaultDocument): Promise<VaultIndex>;
  /** Clear in-memory preferred id (simulates full app reload). */
  clearSessionCache(): void;
  getSessionFileId(): string | undefined;
};

/**
 * Deterministic vault-index.json access for drive.file.
 * - Fixed mode: preferred fileId + merge all duplicates by newest; never delete duplicates.
 * - Buggy mode: mirrors pre-0.1.11 googleDrive (pageSize=1 / arbitrary first, no persisted id).
 */
export function createVaultIndexStore(opts: {
  api: VaultIndexDriveApi;
  ids: VaultIndexIdStore;
  mirror?: VaultIndexMirror;
  mode?: VaultIndexStoreMode;
}): VaultIndexStore {
  const mode: VaultIndexStoreMode = opts.mode ?? 'fixed';
  let sessionFileId: string | undefined;

  async function listUsable(vaultFolderId: string): Promise<ListedIndexFile[]> {
    const listed = await opts.api.listIndexFiles(vaultFolderId);
    // appDataFolder without drive.appdata → API should 403; if tagged, skip
    return listed.filter((f) => !f.appDataFolder);
  }

  async function resolveWriteTarget(vaultFolderId: string): Promise<string | null> {
    const files = await listUsable(vaultFolderId);
    if (mode === 'buggy_arbitrary_first') {
      return pickArbitraryIndexFileId(files);
    }
    const preferred = sessionFileId || (await opts.ids.getPreferredFileId());
    const canonical = pickCanonicalIndexFileId(files, preferred);
    if (canonical) {
      sessionFileId = canonical;
      await opts.ids.setPreferredFileId(canonical);
    }
    return canonical;
  }

  async function loadIndex(vaultFolderId: string): Promise<VaultIndex> {
    const files = await listUsable(vaultFolderId);

    if (mode === 'buggy_arbitrary_first') {
      const id = pickArbitraryIndexFileId(files);
      if (!id) {
        return emptyIndex(vaultFolderId);
      }
      sessionFileId = id;
      return await opts.api.readIndexFile(id);
    }

    if (!files.length) {
      const mirror = opts.mirror ? await opts.mirror.load() : null;
      if (mirror?.documents?.length) {
        return { ...mirror, vaultFolderId: mirror.vaultFolderId || vaultFolderId };
      }
      return emptyIndex(vaultFolderId);
    }

    const preferred = sessionFileId || (await opts.ids.getPreferredFileId());
    const metas: IndexFileMeta[] = [];
    for (const f of files) {
      try {
        const index = await opts.api.readIndexFile(f.id);
        metas.push({ id: f.id, modifiedTime: f.modifiedTime, index });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Skip unreadable duplicates; never delete them
        if (/403|404|appDataFolder/i.test(msg)) continue;
        throw e;
      }
    }

    if (!metas.length) {
      const mirror = opts.mirror ? await opts.mirror.load() : null;
      if (mirror) return mirror;
      return emptyIndex(vaultFolderId);
    }

    const merged = mergeVaultIndexes(
      metas.map((m) => ({ index: m.index!, modifiedTime: m.modifiedTime })),
      vaultFolderId,
    );
    const canonical = pickCanonicalIndexFileId(metas, preferred);
    if (canonical) {
      sessionFileId = canonical;
      await opts.ids.setPreferredFileId(canonical);
    }
    if (opts.mirror) await opts.mirror.save(merged);
    return merged;
  }

  async function saveIndex(vaultFolderId: string, index: VaultIndex): Promise<VaultIndex> {
    const body = JSON.stringify(index, null, 2);
    let fileId = sessionFileId || (await resolveWriteTarget(vaultFolderId));

    if (!fileId) {
      // Find returned nothing — create once (drive.file may later show duplicates; we keep preferred id)
      const created = await opts.api.createIndexFile(vaultFolderId, body);
      fileId = created.id;
      sessionFileId = fileId;
      await opts.ids.setPreferredFileId(fileId);
      if (opts.mirror) await opts.mirror.save(index);
      return index;
    }

    try {
      await opts.api.updateIndexFile(fileId, body);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // If preferred id vanished, create a new canonical file (never trash the old ones)
      if (/404|403|not found/i.test(msg)) {
        const created = await opts.api.createIndexFile(vaultFolderId, body);
        fileId = created.id;
        sessionFileId = fileId;
        await opts.ids.setPreferredFileId(fileId);
      } else {
        throw e;
      }
    }

    sessionFileId = fileId;
    await opts.ids.setPreferredFileId(fileId);
    if (opts.mirror) await opts.mirror.save(index);
    return index;
  }

  async function upsertDocument(vaultFolderId: string, doc: VaultDocument): Promise<VaultIndex> {
    const index = await loadIndex(vaultFolderId);
    const idx = index.documents.findIndex((d) => d.id === doc.id);
    if (idx >= 0) index.documents[idx] = doc;
    else index.documents.push(doc);
    index.updatedAt = new Date().toISOString();
    return saveIndex(vaultFolderId, index);
  }

  return {
    loadIndex,
    saveIndex,
    upsertDocument,
    clearSessionCache() {
      sessionFileId = undefined;
    },
    getSessionFileId() {
      return sessionFileId;
    },
  };
}

function emptyIndex(vaultFolderId: string): VaultIndex {
  return {
    version: 1,
    vaultFolderId,
    lastScanAt: null,
    documents: [],
    updatedAt: new Date().toISOString(),
    settings: { storageMode: 'gmail_index' },
  };
}

export { INDEX_FILENAME };
