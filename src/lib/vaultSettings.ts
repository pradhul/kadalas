import { VaultIndex } from '../types/document';
import {
  DEFAULT_VAULT_SETTINGS,
  normalizeStorageMode,
  VaultSettings,
} from '../types/settings';

export function settingsFromIndex(index: VaultIndex | null | undefined): VaultSettings {
  const mode = normalizeStorageMode(index?.settings?.storageMode);
  return { storageMode: mode ?? DEFAULT_VAULT_SETTINGS.storageMode };
}

export function withVaultSettings(index: VaultIndex, settings: VaultSettings): VaultIndex {
  return {
    ...index,
    settings: {
      ...(index.settings || {}),
      storageMode: settings.storageMode,
    },
    updatedAt: new Date().toISOString(),
  };
}
