import { VaultIndex } from '../types/document';

const INDEX_MIRROR_KEY = 'kadalas_vault_index_mirror_v1';
const INDEX_FILE_ID_KEY = 'kadalas_vault_index_file_id_v1';
const VAULT_FOLDER_ID_KEY = 'kadalas_vault_folder_id_v1';

/** In-memory fallback when localStorage is absent (native / tests). */
const memory = new Map<string, string>();

function webStorage(): Storage | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // private mode / denied
  }
  return null;
}

function getItem(key: string): string | null {
  const ls = webStorage();
  if (ls) {
    try {
      return ls.getItem(key);
    } catch {
      return memory.get(key) ?? null;
    }
  }
  return memory.get(key) ?? null;
}

function setItem(key: string, value: string): void {
  memory.set(key, value);
  const ls = webStorage();
  if (ls) {
    try {
      ls.setItem(key, value);
    } catch {
      // quota — memory still holds for this session
    }
  }
}

function removeItem(key: string): void {
  memory.delete(key);
  const ls = webStorage();
  if (ls) {
    try {
      ls.removeItem(key);
    } catch {
      // ignore
    }
  }
}

export async function loadIndexMirror(): Promise<VaultIndex | null> {
  const raw = getItem(INDEX_MIRROR_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as VaultIndex;
  } catch {
    return null;
  }
}

export async function saveIndexMirror(index: VaultIndex): Promise<void> {
  setItem(INDEX_MIRROR_KEY, JSON.stringify(index));
}

export async function clearIndexMirror(): Promise<void> {
  removeItem(INDEX_MIRROR_KEY);
}

export async function loadPreferredIndexFileId(): Promise<string | null> {
  return getItem(INDEX_FILE_ID_KEY);
}

export async function savePreferredIndexFileId(fileId: string): Promise<void> {
  setItem(INDEX_FILE_ID_KEY, fileId);
}

export async function loadPreferredVaultFolderId(): Promise<string | null> {
  return getItem(VAULT_FOLDER_ID_KEY);
}

export async function savePreferredVaultFolderId(folderId: string): Promise<void> {
  setItem(VAULT_FOLDER_ID_KEY, folderId);
}

/** Test helper — wipe mirror keys. */
export function resetIndexMirrorForTests(): void {
  removeItem(INDEX_MIRROR_KEY);
  removeItem(INDEX_FILE_ID_KEY);
  removeItem(VAULT_FOLDER_ID_KEY);
}
