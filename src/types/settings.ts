/** How approved documents are stored. */
export type StorageMode = 'gmail_index' | 'drive_copies';

export const DEFAULT_STORAGE_MODE: StorageMode = 'gmail_index';

export type StorageKind = 'gmail_index' | 'drive_copy';

export interface VaultSettings {
  /** Approve behavior — default gmail_index for new vaults. */
  storageMode: StorageMode;
}

export interface DeviceSettings {
  /** Best-effort local copies for offline viewing (device-only; never touches Gmail/Drive). */
  keepDocumentsOnDevice: boolean;
  /**
   * When on, any self-sent email with an attachment (from:me to:me) is surfaced in review
   * at top priority — even without the kadalas subject tag.
   */
  treatSelfSentAttachmentsAsDocuments: boolean;
  /** ISO time of last self-sent kadalas check (Drive index / local). */
  lastSelfSentCheckAt?: string | null;
}

export const DEFAULT_VAULT_SETTINGS: VaultSettings = {
  storageMode: DEFAULT_STORAGE_MODE,
};

export const DEFAULT_DEVICE_SETTINGS: DeviceSettings = {
  keepDocumentsOnDevice: false,
  treatSelfSentAttachmentsAsDocuments: false,
  lastSelfSentCheckAt: null,
};

export function normalizeStorageMode(value: unknown): StorageMode {
  return value === 'drive_copies' ? 'drive_copies' : 'gmail_index';
}
