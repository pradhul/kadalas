import { Platform } from 'react-native';
import { DEFAULT_DEVICE_SETTINGS, DeviceSettings } from '../types/settings';

export { settingsFromIndex, withVaultSettings } from '../lib/vaultSettings';

const DEVICE_KEY = 'kadalas_device_settings_v1';

export async function loadDeviceSettings(): Promise<DeviceSettings> {
  try {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(DEVICE_KEY);
      if (!raw) return { ...DEFAULT_DEVICE_SETTINGS };
      const parsed = JSON.parse(raw) as Partial<DeviceSettings>;
      return {
        keepDocumentsOnDevice: Boolean(parsed.keepDocumentsOnDevice),
        treatSelfSentAttachmentsAsDocuments: Boolean(
          parsed.treatSelfSentAttachmentsAsDocuments,
        ),
        lastSelfSentCheckAt: parsed.lastSelfSentCheckAt ?? null,
      };
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_DEVICE_SETTINGS };
}

export async function saveDeviceSettings(settings: DeviceSettings): Promise<void> {
  try {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      localStorage.setItem(DEVICE_KEY, JSON.stringify(settings));
    }
  } catch {
    /* ignore */
  }
}
