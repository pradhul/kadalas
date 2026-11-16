import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

export type OfflineEntryMeta = {
  docId: string;
  versionId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  cachedAt: string;
};

type CacheIndex = Record<string, OfflineEntryMeta>;

const IDB_NAME = 'kadalas_offline_v1';
const IDB_STORE = 'blobs';
const META_KEY = 'kadalas_offline_meta_v1';

function cacheKey(docId: string, versionId: string): string {
  return `${docId}::${versionId}`;
}

function readMeta(): CacheIndex {
  try {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(META_KEY);
      if (raw) return JSON.parse(raw) as CacheIndex;
    }
  } catch {
    /* ignore */
  }
  return {};
}

function writeMeta(index: CacheIndex): void {
  try {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      localStorage.setItem(META_KEY, JSON.stringify(index));
    }
  } catch {
    /* ignore */
  }
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

async function idbPut(key: string, dataBase64: string): Promise<void> {
  const db = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(dataBase64, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB put failed'));
  });
  db.close();
}

async function idbGet(key: string): Promise<string | null> {
  const db = await openIdb();
  const value = await new Promise<string | null>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB get failed'));
  });
  db.close();
  return value;
}

async function idbDelete(key: string): Promise<void> {
  const db = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'));
  });
  db.close();
}

function nativeDir(): string {
  const base = FileSystem.documentDirectory || FileSystem.cacheDirectory || '';
  return `${base}kadalas-offline/`;
}

async function ensureNativeDir(): Promise<string> {
  const dir = nativeDir();
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
}

/** Persist document bytes on this device only. Never writes to Gmail/Drive. */
export async function putOfflineBlob(input: {
  docId: string;
  versionId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  dataBase64: string;
}): Promise<OfflineEntryMeta> {
  const key = cacheKey(input.docId, input.versionId);
  const meta: OfflineEntryMeta = {
    docId: input.docId,
    versionId: input.versionId,
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    cachedAt: new Date().toISOString(),
  };

  if (Platform.OS === 'web') {
    if (typeof indexedDB === 'undefined') {
      throw new Error('Offline cache unavailable in this browser');
    }
    await idbPut(key, input.dataBase64);
  } else {
    const dir = await ensureNativeDir();
    const path = `${dir}${encodeURIComponent(key)}.bin`;
    await FileSystem.writeAsStringAsync(path, input.dataBase64, {
      encoding: FileSystem.EncodingType.Base64,
    });
  }

  const index = readMeta();
  index[key] = meta;
  writeMeta(index);
  return meta;
}

export async function getOfflineBlob(
  docId: string,
  versionId: string,
): Promise<{ dataBase64: string; meta: OfflineEntryMeta } | null> {
  const key = cacheKey(docId, versionId);
  const index = readMeta();
  const meta = index[key];
  if (!meta) return null;

  if (Platform.OS === 'web') {
    if (typeof indexedDB === 'undefined') return null;
    const dataBase64 = await idbGet(key);
    if (!dataBase64) return null;
    return { dataBase64, meta };
  }

  const path = `${nativeDir()}${encodeURIComponent(key)}.bin`;
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) return null;
  const dataBase64 = await FileSystem.readAsStringAsync(path, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return { dataBase64, meta };
}

/** Remove local copy only — never deletes Gmail or Drive. */
export async function removeOfflineBlob(docId: string, versionId: string): Promise<void> {
  const key = cacheKey(docId, versionId);
  if (Platform.OS === 'web') {
    if (typeof indexedDB !== 'undefined') await idbDelete(key).catch(() => undefined);
  } else {
    const path = `${nativeDir()}${encodeURIComponent(key)}.bin`;
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists) await FileSystem.deleteAsync(path, { idempotent: true });
  }
  const index = readMeta();
  delete index[key];
  writeMeta(index);
}

export function listOfflineMeta(): OfflineEntryMeta[] {
  return Object.values(readMeta());
}

export function isAvailableOffline(docId: string, versionId: string): boolean {
  return Boolean(readMeta()[cacheKey(docId, versionId)]);
}

export function offlineStorageBytes(): number {
  return Object.values(readMeta()).reduce((sum, m) => sum + (m.sizeBytes || 0), 0);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
