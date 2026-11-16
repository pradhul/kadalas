import { INDEX_FILENAME, VaultIndex } from '../../types/document';
import { ListedIndexFile, VaultIndexDriveApi } from './vaultIndexStore';

/**
 * In-memory Drive backend mimicking drive.file:
 * - Same-name files allowed (each create makes a new id)
 * - list order is controllable (default: insertion order — arbitrary w.r.t. modifiedTime)
 * - appDataFolder reads/writes throw 403 without drive.appdata
 */
export type FakeDriveFile = {
  id: string;
  name: string;
  parentId: string;
  modifiedTime: string;
  content: string;
  appDataFolder?: boolean;
};

export function createFakeDriveFileBackend(opts?: {
  /** When true, list returns files in reverse insertion order (older first) to stress buggy pick. */
  listOlderFirst?: boolean;
  grantAppData?: boolean;
}) {
  const files = new Map<string, FakeDriveFile>();
  let seq = 0;
  const vaultFolderId = 'vault_root_1';

  function nextId(prefix: string) {
    seq += 1;
    return `${prefix}_${seq}`;
  }

  const api: VaultIndexDriveApi = {
    async listIndexFiles(parentId: string): Promise<ListedIndexFile[]> {
      let listed = [...files.values()].filter(
        (f) => f.parentId === parentId && f.name === INDEX_FILENAME,
      );
      if (opts?.listOlderFirst) {
        listed = listed.sort(
          (a, b) => (Date.parse(a.modifiedTime) || 0) - (Date.parse(b.modifiedTime) || 0),
        );
      }
      // Default: insertion / map order (not sorted by modifiedTime) — like Drive pageSize=1 arbitrary
      return listed.map((f) => ({
        id: f.id,
        modifiedTime: f.modifiedTime,
        appDataFolder: f.appDataFolder,
      }));
    },

    async readIndexFile(fileId: string): Promise<VaultIndex> {
      const f = files.get(fileId);
      if (!f) {
        const err = new Error('Drive API 404: not found') as Error & { status: number };
        err.status = 404;
        throw err;
      }
      if (f.appDataFolder && !opts?.grantAppData) {
        const err = new Error(
          'Drive API 403: The user has not granted the app drive.appdata scope.',
        ) as Error & { status: number };
        err.status = 403;
        throw err;
      }
      return JSON.parse(f.content) as VaultIndex;
    },

    async createIndexFile(parentId: string, body: string) {
      const id = nextId('idx');
      const modifiedTime = new Date().toISOString();
      files.set(id, {
        id,
        name: INDEX_FILENAME,
        parentId,
        modifiedTime,
        content: body,
      });
      // Allow clock skew between creates in tests
      await Promise.resolve();
      return { id, modifiedTime };
    },

    async updateIndexFile(fileId: string, body: string) {
      const f = files.get(fileId);
      if (!f) {
        const err = new Error('Drive API 404: not found') as Error & { status: number };
        err.status = 404;
        throw err;
      }
      if (f.appDataFolder && !opts?.grantAppData) {
        const err = new Error(
          'Drive API 403: The user has not granted the app drive.appdata scope.',
        ) as Error & { status: number };
        err.status = 403;
        throw err;
      }
      const modifiedTime = new Date(Date.now() + 1).toISOString();
      f.content = body;
      f.modifiedTime = modifiedTime;
      return { modifiedTime };
    },
  };

  return {
    vaultFolderId,
    api,
    files,
    /** Seed an empty older duplicate that sorts first when listOlderFirst is on. */
    seedEmptyIndex(atIso = '2020-01-01T00:00:00.000Z') {
      const id = nextId('idx_old');
      const empty: VaultIndex = {
        version: 1,
        vaultFolderId,
        lastScanAt: null,
        documents: [],
        updatedAt: atIso,
        settings: { storageMode: 'gmail_index' },
      };
      files.set(id, {
        id,
        name: INDEX_FILENAME,
        parentId: vaultFolderId,
        modifiedTime: atIso,
        content: JSON.stringify(empty),
      });
      return id;
    },
    /** After approvals, inject an empty duplicate that list returns first (buggy pick loses data). */
    injectEmptyDuplicateFirst() {
      const id = nextId('idx_empty');
      const empty: VaultIndex = {
        version: 1,
        vaultFolderId,
        lastScanAt: null,
        documents: [],
        updatedAt: '2019-01-01T00:00:00.000Z',
        settings: { storageMode: 'gmail_index' },
      };
      // Re-insert so Map iteration yields empty first: rebuild map
      const existing = [...files.entries()];
      files.clear();
      files.set(id, {
        id,
        name: INDEX_FILENAME,
        parentId: vaultFolderId,
        modifiedTime: '2019-01-01T00:00:00.000Z',
        content: JSON.stringify(empty),
      });
      for (const [k, v] of existing) files.set(k, v);
      return id;
    },
    seedAppDataIndex() {
      const id = nextId('appdata');
      files.set(id, {
        id,
        name: INDEX_FILENAME,
        parentId: 'appDataFolder',
        modifiedTime: new Date().toISOString(),
        content: JSON.stringify({
          version: 1,
          vaultFolderId: 'appDataFolder',
          lastScanAt: null,
          documents: [],
          updatedAt: new Date().toISOString(),
        }),
        appDataFolder: true,
      });
      return id;
    },
  };
}
