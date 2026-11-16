import { Platform } from 'react-native';
import {
  INDEX_FILENAME,
  VAULT_CATEGORIES,
  VAULT_ROOT_FOLDER,
  VERSIONS_FOLDER,
  VaultCategory,
  VaultDocument,
  VaultIndex,
} from '../../types/document';
import { MOCK_VAULT_INDEX } from '../../mocks/data';
import { ReviewState } from '../../types/review';
import { ScanJobState } from '../../types/scan';
import { DriveFileRef, DriveService, UploadInput } from './types';

const STORAGE_KEY = 'dv_mock_drive_v1';

interface MockState {
  vaultFolderId: string;
  folderIdsByPath: Record<string, string>;
  files: Record<string, DriveFileRef & { content?: string; parentId: string }>;
  index: VaultIndex;
  scanState: ScanJobState | null;
  reviewState: ReviewState | null;
}

function emptyState(): MockState {
  const vaultFolderId = 'mock_vault_root';
  const folderIdsByPath: Record<string, string> = { '': vaultFolderId };
  for (const category of VAULT_CATEGORIES) {
    const parts = category.split('/');
    let parent = '';
    for (let i = 0; i < parts.length; i++) {
      const path = parts.slice(0, i + 1).join('/');
      if (!folderIdsByPath[path]) {
        folderIdsByPath[path] = `mock_folder_${path.replace(/\//g, '_')}`;
      }
      parent = path;
    }
    void parent;
  }
  folderIdsByPath[VERSIONS_FOLDER] = 'mock_folder__versions';

  const seed = structuredClone(MOCK_VAULT_INDEX);
  seed.vaultFolderId = vaultFolderId;

  return {
    vaultFolderId,
    folderIdsByPath,
    reviewState: null,
    files: {
      mock_index: {
        id: 'mock_index',
        name: INDEX_FILENAME,
        mimeType: 'application/json',
        parentId: vaultFolderId,
        content: JSON.stringify(seed),
      },
    },
    index: seed,
    scanState: null,
  };
}

function loadState(): MockState {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<MockState> & MockState;
        if (parsed.reviewState === undefined) parsed.reviewState = null;
        return parsed as MockState;
      } catch {
        // fall through
      }
    }
  }
  return emptyState();
}

function saveState(state: MockState) {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
  // native mock keeps in-memory only for this process via module singleton
}

let memory = loadState();

export function resetMockDrive() {
  memory = emptyState();
  saveState(memory);
}

export function createMockDriveService(): DriveService {
  return {
    async ensureVaultStructure() {
      if (!memory.vaultFolderId) memory = emptyState();
      saveState(memory);
      return {
        vaultFolderId: memory.vaultFolderId,
        folderIdsByPath: { ...memory.folderIdsByPath },
      };
    },

    async loadIndex() {
      await this.ensureVaultStructure();
      return structuredClone(memory.index);
    },

    async saveIndex(index: VaultIndex) {
      memory.index = structuredClone(index);
      memory.files.mock_index = {
        id: 'mock_index',
        name: INDEX_FILENAME,
        mimeType: 'application/json',
        parentId: memory.vaultFolderId,
        content: JSON.stringify(index),
      };
      saveState(memory);
    },

    async uploadFile(input: UploadInput) {
      const id = `mock_file_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const file: DriveFileRef & { content?: string; parentId: string } = {
        id,
        name: input.name,
        mimeType: input.mimeType,
        parentId: input.parentFolderId,
        content: input.contentText ?? input.contentBase64,
        size: (input.contentText ?? input.contentBase64 ?? '').length,
        webViewLink: `https://drive.google.com/file/d/${id}/view`,
      };
      memory.files[id] = file;
      saveState(memory);
      return file;
    },

    async moveFile(fileId, newParentId) {
      const file = memory.files[fileId];
      if (file) {
        file.parentId = newParentId;
        saveState(memory);
      }
    },

    async renameFile(fileId, newName) {
      const file = memory.files[fileId];
      if (file) {
        file.name = newName;
        saveState(memory);
      }
    },

    async getDownloadUrl(fileId) {
      return `mock://download/${fileId}`;
    },

    async getFolderIdForCategory(category: VaultCategory) {
      await this.ensureVaultStructure();
      return memory.folderIdsByPath[category] || memory.vaultFolderId;
    },

    async archiveToVersions(fileId, versionsFolderId) {
      await this.moveFile(fileId, versionsFolderId);
      const file = memory.files[fileId];
      return file ?? { id: fileId, name: 'archived', mimeType: 'application/octet-stream' };
    },

    async upsertDocument(doc: VaultDocument) {
      const index = await this.loadIndex();
      const idx = index.documents.findIndex((d) => d.id === doc.id);
      if (idx >= 0) index.documents[idx] = doc;
      else index.documents.push(doc);
      index.updatedAt = new Date().toISOString();
      await this.saveIndex(index);
      return index;
    },

    async saveScanState(state) {
      memory.scanState = state ? structuredClone(state) : null;
      saveState(memory);
    },

    async loadScanState() {
      return memory.scanState ? structuredClone(memory.scanState) : null;
    },

    async saveReviewState(state) {
      memory.reviewState = structuredClone(state);
      saveState(memory);
    },

    async loadReviewState() {
      return memory.reviewState ? structuredClone(memory.reviewState) : null;
    },
  };
}

export function getMockDriveDebugLabel() {
  return `${VAULT_ROOT_FOLDER} (mock) · ${memory.index.documents.length} docs`;
}
