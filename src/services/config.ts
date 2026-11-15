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

const FORCE_DEMO_KEY = 'kadalas_force_demo';

function getExtra(): Extra {
  return (Constants.expoConfig?.extra ?? {}) as Extra;
}

/** Runtime override so a production web build can still offer "Try demo data". */
export function isForceDemoMode(): boolean {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    return localStorage.getItem(FORCE_DEMO_KEY) === '1';
  }
  return false;
}

export function setForceDemoMode(on: boolean): void {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    if (on) localStorage.setItem(FORCE_DEMO_KEY, '1');
    else localStorage.removeItem(FORCE_DEMO_KEY);
  }
}

/**
 * Mock Google/Drive/Gmail/AI when:
 * - EXPO_PUBLIC_USE_MOCKS is true (build-time), or
 * - user chose "Try demo data" on sign-in (runtime localStorage).
 *
 * EXPO_PUBLIC_USE_MOCKS and EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID are read at
 * Metro/Expo build time (embedded in the JS bundle).
 */
export function useMocks(): boolean {
  if (isForceDemoMode()) return true;
  const env = process.env.EXPO_PUBLIC_USE_MOCKS;
  if (env === '0' || env === 'false') return false;
  if (env === '1' || env === 'true') return true;
  const extra = getExtra();
  if (typeof extra.useMocks === 'boolean') return extra.useMocks;
  // Default: mocks on so the UI is fully exercisable without credentials.
  return true;
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
