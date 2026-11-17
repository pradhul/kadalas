import Constants from 'expo-constants';
import * as ExpoAuthSession from 'expo-auth-session';
import { Platform } from 'react-native';
import { resolveOAuthRedirectUri } from '../lib/oauthRedirect';

type Extra = {
  useMocks?: boolean;
  googleWebClientId?: string;
  googleIosClientId?: string;
  googleAndroidClientId?: string;
  googleExpoClientId?: string;
};

export const FORCE_DEMO_KEY = 'kadalas_force_demo';
const MOCK_DRIVE_KEY = 'dv_mock_drive_v1';
const AUTH_TOKEN_KEY = 'dv_auth_tokens';
const INDEX_MIRROR_KEY = 'kadalas_vault_index_mirror_v1';
const INDEX_FILE_ID_KEY = 'kadalas_vault_index_file_id_v1';
const VAULT_FOLDER_ID_KEY = 'kadalas_vault_folder_id_v1';
const REVIEW_KEY = 'kadalas_review_state_v1';
const SCAN_KEY = 'dv_scan_job_state_v1';

function getExtra(): Extra {
  return (Constants.expoConfig?.extra ?? {}) as Extra;
}

function webStorage(): Storage | null {
  // localStorage exists on web (and in Jest polyfills). Never present on native.
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* ignore */
  }
  return null;
}

/** Build-time mock flag only (env / app.json). Never reads force-demo. */
export function isBuildMocksEnabled(): boolean {
  const env = process.env.EXPO_PUBLIC_USE_MOCKS;
  if (env === '0' || env === 'false') return false;
  if (env === '1' || env === 'true') return true;
  const extra = getExtra();
  if (typeof extra.useMocks === 'boolean') return extra.useMocks;
  // Production-safe default: real mode unless explicitly enabled.
  return false;
}

/**
 * Demo / mock entry (incl. "Try demo data") is only for builds that opt into mocks
 * or local `__DEV__` when mocks are not explicitly disabled.
 * Production (EXPO_PUBLIC_USE_MOCKS=false) never offers it — even in Metro __DEV__.
 */
export function isDemoEntryAllowed(): boolean {
  const env = process.env.EXPO_PUBLIC_USE_MOCKS;
  if (env === '0' || env === 'false') return false;
  if (isBuildMocksEnabled()) return true;
  if (typeof __DEV__ !== 'undefined' && __DEV__) return true;
  return false;
}

/** Runtime override so a mock/dev build can still offer "Try demo data". */
export function isForceDemoMode(): boolean {
  if (!isDemoEntryAllowed()) return false;
  const ls = webStorage();
  return ls?.getItem(FORCE_DEMO_KEY) === '1';
}

export function setForceDemoMode(on: boolean): void {
  const ls = webStorage();
  if (!ls) return;
  if (on && isDemoEntryAllowed()) ls.setItem(FORCE_DEMO_KEY, '1');
  else ls.removeItem(FORCE_DEMO_KEY);
}

/**
 * Mock Google/Drive/Gmail/AI when:
 * - EXPO_PUBLIC_USE_MOCKS / app.json extra.useMocks is true, or
 * - user chose "Try demo data" AND demo entry is allowed for this build.
 *
 * Production builds never honor a leftover force-demo flag.
 */
export function useMocks(): boolean {
  if (isForceDemoMode()) return true;
  return isBuildMocksEnabled();
}

/**
 * Clear local-only demo residue. Never touches Drive/Gmail.
 * Call on boot in production / when demo entry is not allowed.
 */
export function purgeStaleDemoLocalState(): { cleared: string[] } {
  const cleared: string[] = [];
  const ls = webStorage();
  if (!ls) return { cleared };

  const remove = (key: string) => {
    if (ls.getItem(key) != null) {
      ls.removeItem(key);
      cleared.push(key);
    }
  };

  // Always drop the force-demo flag when demos are not allowed
  if (!isDemoEntryAllowed()) {
    remove(FORCE_DEMO_KEY);
  }

  // Mock drive blob
  remove(MOCK_DRIVE_KEY);

  // Mock auth tokens (accessToken starts with mock_)
  try {
    const raw = ls.getItem(AUTH_TOKEN_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { accessToken?: string };
      if (typeof parsed.accessToken === 'string' && parsed.accessToken.startsWith('mock_')) {
        remove(AUTH_TOKEN_KEY);
      }
    }
  } catch {
    remove(AUTH_TOKEN_KEY);
  }

  // Demo vault mirror (Chase / Allstate seed) — local only
  remove(INDEX_MIRROR_KEY);
  remove(INDEX_FILE_ID_KEY);
  remove(VAULT_FOLDER_ID_KEY);

  // Demo review / scan leftovers when not in mock builds
  if (!isDemoEntryAllowed()) {
    remove(REVIEW_KEY);
    remove(SCAN_KEY);
  }

  return { cleared };
}

export function getGoogleOAuthConfig() {
  const extra = getExtra();
  return {
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || extra.googleWebClientId || '',
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || extra.googleIosClientId || '',
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || extra.googleAndroidClientId || '',
    expoClientId: process.env.EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID || extra.googleExpoClientId || '',
  };
}

/**
 * OAuth redirect URI for the current platform.
 * On web, always use `window.location.origin` so any deployed host works
 * (add that origin + redirect URI in Google Cloud Console).
 */
export function getOAuthRedirectUri(scheme = 'kadalas'): string {
  const webOrigin =
    Platform.OS === 'web' && typeof window !== 'undefined' ? window.location?.origin : null;
  return resolveOAuthRedirectUri({
    platform: Platform.OS,
    webOrigin,
    nativeRedirectUri: ExpoAuthSession.makeRedirectUri({ scheme }),
  });
}

/**
 * Scopes justification:
 * - gmail.readonly: required to search mail and read PDF/image attachments for scan/sync.
 *   This is a Google "restricted" scope; public distribution requires verification.
 * - drive.file: preferred — the app only sees Drive files/folders it creates
 *   (Kadalas Drive folder + uploads). Sufficient for vault storage + index JSON.
 *   We do NOT request full drive or drive.readonly.
 */
export const GOOGLE_SCOPES = [
  'openid',
  'profile',
  'email',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/drive.file',
] as const;
