import * as ExpoAuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { fetchWithTimeout } from '../../lib/fetchWithTimeout';
import { getGoogleOAuthConfig, getOAuthRedirectUri, GOOGLE_SCOPES } from '../config';
import { clearAuthTokens, getAuthTokens, saveAuthTokens, StoredTokens } from '../secureStorage';
import { emitAuthEvent } from './authEvents';
import { AuthExpiredError, friendlyAuthError } from './errors';
import { requestGisAccessToken, revokeGisToken } from './gisTokenClient';
import { AuthService, AuthSession } from './types';

WebBrowser.maybeCompleteAuthSession();

const discovery = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};

function pickClientId(): string {
  const cfg = getGoogleOAuthConfig();
  if (Platform.OS === 'ios' && cfg.iosClientId) return cfg.iosClientId;
  if (Platform.OS === 'android' && cfg.androidClientId) return cfg.androidClientId;
  return cfg.webClientId || cfg.expoClientId;
}

function toSession(tokens: StoredTokens): AuthSession {
  return {
    user: {
      email: tokens.email || 'unknown',
      name: tokens.name || 'Google User',
      picture: tokens.picture,
    },
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    isMock: false,
  };
}

async function fetchUserInfo(accessToken: string): Promise<{ email: string; name: string; picture?: string }> {
  const res = await fetchWithTimeout('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Failed to load Google profile (${res.status})`);
  const data = (await res.json()) as { email?: string; name?: string; picture?: string };
  return {
    email: data.email || 'unknown',
    name: data.name || data.email || 'Google User',
    picture: data.picture,
  };
}

async function refreshAccessTokenNative(refreshToken: string): Promise<StoredTokens> {
  const clientId = pickClientId();
  if (!clientId) throw new Error('Missing Google OAuth client ID');

  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const res = await fetchWithTimeout(discovery.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed: ${text}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    expires_in?: number;
    id_token?: string;
    refresh_token?: string;
  };

  const existing = await getAuthTokens();
  const next: StoredTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    idToken: data.id_token,
    email: existing?.email,
    name: existing?.name,
    picture: existing?.picture,
  };
  await saveAuthTokens(next);
  return next;
}

async function persistAccessToken(
  accessToken: string,
  expiresIn: number,
  extras?: Partial<StoredTokens>,
): Promise<StoredTokens> {
  const existing = await getAuthTokens();
  let email = extras?.email ?? existing?.email;
  let name = extras?.name ?? existing?.name;
  let picture = extras?.picture ?? existing?.picture;

  if (!email || !name) {
    const profile = await fetchUserInfo(accessToken);
    email = profile.email;
    name = profile.name;
    picture = profile.picture;
  }

  const stored: StoredTokens = {
    accessToken,
    // Web GIS token flow has no refresh_token
    refreshToken: Platform.OS === 'web' ? undefined : extras?.refreshToken ?? existing?.refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    idToken: extras?.idToken ?? existing?.idToken,
    email,
    name,
    picture,
  };
  await saveAuthTokens(stored);
  emitAuthEvent('restored');
  return stored;
}

/** Web: Google Identity Services token client (no client_secret). */
async function signInWeb(options?: { prompt?: 'consent' | 'select_account' | '' }): Promise<AuthSession> {
  const clientId = pickClientId();
  if (!clientId) {
    throw new Error('Google OAuth client ID is not configured. Set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID.');
  }

  try {
    const existing = await getAuthTokens();
    const { accessToken, expiresIn } = await requestGisAccessToken({
      clientId,
      interactive: true,
      loginHint: existing?.email,
      // First sign-in: consent once for all scopes. Reconnect: select_account (no re-consent).
      prompt: options?.prompt ?? (existing?.email ? 'select_account' : 'consent'),
    });
    const profile = await fetchUserInfo(accessToken);
    const stored = await persistAccessToken(accessToken, expiresIn, profile);
    return toSession(stored);
  } catch (e) {
    throw new Error(friendlyAuthError(e));
  }
}

/** Native: authorization code + PKCE (for future Android/iOS clients). */
async function signInNative(): Promise<AuthSession> {
  const clientId = pickClientId();
  if (!clientId) {
    throw new Error(
      'Google OAuth client ID is not configured. Set EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID / ANDROID_CLIENT_ID or enable mocks.',
    );
  }

  const redirectUri = getOAuthRedirectUri('kadalas');

  const request = new ExpoAuthSession.AuthRequest({
    clientId,
    redirectUri,
    scopes: [...GOOGLE_SCOPES],
    responseType: ExpoAuthSession.ResponseType.Code,
    usePKCE: true,
    extraParams: {
      access_type: 'offline',
      prompt: 'consent',
    },
  });

  await request.makeAuthUrlAsync(discovery);
  const result = await request.promptAsync(discovery);

  if (result.type !== 'success' || !result.params.code) {
    throw new Error(result.type === 'dismiss' ? 'Sign-in was cancelled.' : 'Google sign-in failed. Please try again.');
  }

  const tokenResult = await ExpoAuthSession.exchangeCodeAsync(
    {
      clientId,
      code: result.params.code,
      redirectUri,
      extraParams: {
        code_verifier: request.codeVerifier || '',
      },
    },
    discovery,
  );

  const accessToken = tokenResult.accessToken;
  if (!accessToken) throw new Error('Google sign-in failed. Please try again.');

  const profile = await fetchUserInfo(accessToken);
  const stored: StoredTokens = {
    accessToken,
    refreshToken: tokenResult.refreshToken,
    expiresAt: tokenResult.expiresIn ? Date.now() + tokenResult.expiresIn * 1000 : undefined,
    idToken: tokenResult.idToken,
    email: profile.email,
    name: profile.name,
    picture: profile.picture,
  };
  await saveAuthTokens(stored);
  emitAuthEvent('restored');
  return toSession(stored);
}

/** Renew when fewer than 5 minutes remain (proactive) or already expired. */
const RENEW_SKEW_MS = 5 * 60_000;

async function getValidAccessTokenWeb(): Promise<string> {
  const tokens = await getAuthTokens();
  if (!tokens?.accessToken) {
    emitAuthEvent('expired');
    throw new AuthExpiredError();
  }

  const stillValid = tokens.expiresAt && tokens.expiresAt > Date.now() + RENEW_SKEW_MS;
  if (stillValid) return tokens.accessToken;

  const clientId = pickClientId();
  if (!clientId) {
    emitAuthEvent('expired');
    throw new AuthExpiredError();
  }

  try {
    const { accessToken, expiresIn } = await requestGisAccessToken({
      clientId,
      interactive: false,
      loginHint: tokens.email,
      prompt: '',
    });
    await persistAccessToken(accessToken, expiresIn);
    return accessToken;
  } catch (e) {
    emitAuthEvent('expired');
    if (e instanceof AuthExpiredError) throw e;
    throw new AuthExpiredError(friendlyAuthError(e));
  }
}

async function getValidAccessTokenNative(): Promise<string> {
  const tokens = await getAuthTokens();
  if (!tokens?.accessToken) throw new AuthExpiredError('Not signed in');

  const needsRefresh = !tokens.expiresAt || tokens.expiresAt < Date.now() + 60_000;
  if (needsRefresh) {
    if (!tokens.refreshToken) {
      emitAuthEvent('expired');
      throw new AuthExpiredError();
    }
    try {
      const refreshed = await refreshAccessTokenNative(tokens.refreshToken);
      emitAuthEvent('restored');
      return refreshed.accessToken;
    } catch {
      emitAuthEvent('expired');
      throw new AuthExpiredError();
    }
  }
  return tokens.accessToken;
}

export function createGoogleAuthService(): AuthService {
  return {
    async getSession() {
      const tokens = await getAuthTokens();
      if (!tokens?.accessToken || tokens.accessToken.startsWith('mock_')) return null;
      return toSession(tokens);
    },

    async signIn() {
      if (Platform.OS === 'web') return signInWeb();
      return signInNative();
    },

    /** Web reconnect: silent renew first, then select_account (same scopes, no second consent if possible). */
    async reconnect() {
      if (Platform.OS !== 'web') return this.signIn();
      try {
        await getValidAccessTokenWeb();
        const tokens = await getAuthTokens();
        if (tokens?.accessToken) {
          emitAuthEvent('restored');
          return toSession(tokens);
        }
      } catch {
        // fall through to interactive
      }
      return signInWeb({ prompt: 'select_account' });
    },

    async signOut() {
      const tokens = await getAuthTokens();
      if (tokens?.accessToken) {
        try {
          if (Platform.OS === 'web') {
            await revokeGisToken(tokens.accessToken);
          } else {
            await fetch(`${discovery.revocationEndpoint}?token=${encodeURIComponent(tokens.accessToken)}`, {
              method: 'POST',
            });
          }
        } catch {
          // best-effort revoke
        }
      }
      await clearAuthTokens();
    },

    async getValidAccessToken() {
      if (Platform.OS === 'web') return getValidAccessTokenWeb();
      return getValidAccessTokenNative();
    },
  };
}
