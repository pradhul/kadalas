import * as ExpoAuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { getGoogleOAuthConfig, getOAuthRedirectUri, GOOGLE_SCOPES } from '../config';
import { clearAuthTokens, getAuthTokens, saveAuthTokens, StoredTokens } from '../secureStorage';
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
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
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

async function refreshAccessToken(refreshToken: string): Promise<StoredTokens> {
  const clientId = pickClientId();
  if (!clientId) throw new Error('Missing Google OAuth client ID');

  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const res = await fetch(discovery.tokenEndpoint, {
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

export function createGoogleAuthService(): AuthService {
  return {
    async getSession() {
      const tokens = await getAuthTokens();
      if (!tokens?.accessToken || tokens.accessToken.startsWith('mock_')) return null;
      return toSession(tokens);
    },

    async signIn() {
      const clientId = pickClientId();
      if (!clientId) {
        throw new Error(
          'Google OAuth client ID is not configured. Set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID (and iOS/Android IDs) or enable mocks.',
        );
      }

      // Web: window.location.origin (any deploy host). Native: kadalas:// scheme.
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
        throw new Error(result.type === 'dismiss' ? 'Sign-in cancelled' : 'Google sign-in failed');
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
      if (!accessToken) throw new Error('No access token returned');

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
      return toSession(stored);
    },

    async signOut() {
      const tokens = await getAuthTokens();
      if (tokens?.accessToken) {
        try {
          await fetch(`${discovery.revocationEndpoint}?token=${encodeURIComponent(tokens.accessToken)}`, {
            method: 'POST',
          });
        } catch {
          // best-effort revoke
        }
      }
      await clearAuthTokens();
    },

    async getValidAccessToken() {
      const tokens = await getAuthTokens();
      if (!tokens?.accessToken) throw new Error('Not signed in');

      const needsRefresh = !tokens.expiresAt || tokens.expiresAt < Date.now() + 60_000;
      if (needsRefresh) {
        if (!tokens.refreshToken) throw new Error('Session expired — please sign in again');
        const refreshed = await refreshAccessToken(tokens.refreshToken);
        return refreshed.accessToken;
      }
      return tokens.accessToken;
    },
  };
}
