import Constants from 'expo-constants';

type Extra = {
  useMocks?: boolean;
  googleWebClientId?: string;
  googleIosClientId?: string;
  googleAndroidClientId?: string;
  googleExpoClientId?: string;
};

function getExtra(): Extra {
  return (Constants.expoConfig?.extra ?? {}) as Extra;
}

export function useMocks(): boolean {
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
 * Scopes justification:
 * - gmail.readonly: required to search mail and read PDF/image attachments for scan/sync.
 *   This is a Google "restricted" scope; public distribution requires verification.
 * - drive.file: preferred — the app only sees Drive files/folders it creates
 *   (Document Vault + uploads). Sufficient for vault storage + index JSON.
 *   We do NOT request full drive or drive.readonly.
 */
export const GOOGLE_SCOPES = [
  'openid',
  'profile',
  'email',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/drive.file',
] as const;
