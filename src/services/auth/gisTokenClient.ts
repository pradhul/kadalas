/**
 * Google Identity Services token client (web only).
 * Uses the implicit/token flow — no client_secret, suitable for a static SPA.
 */
import { GIS_SILENT_TIMEOUT_MS, withTimeout } from '../../lib/fetchWithTimeout';
import { GOOGLE_SCOPES } from '../config';
import { AuthExpiredError } from './errors';

export type GisTokenResponse = {
  access_token: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type TokenClient = {
  requestAccessToken: (overrideConfig?: { prompt?: string; hint?: string }) => void;
};

type GisOauth2 = {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    hint?: string;
    callback: (response: GisTokenResponse) => void;
    error_callback?: (error: { type?: string; message?: string }) => void;
  }) => TokenClient;
  hasGrantedAllScopes?: (tokenResponse: GisTokenResponse, ...scopes: string[]) => boolean;
  revoke?: (token: string, done?: () => void) => void;
};

/** Scopes the app needs for Drive vault + Gmail scan (exclude openid/profile/email for the check). */
export const GIS_REQUIRED_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/drive.file',
] as const;

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GisOauth2 } };
  }
}

const GSI_SCRIPT = 'https://accounts.google.com/gsi/client';
const SCOPE_STRING = GOOGLE_SCOPES.join(' ');

let scriptPromise: Promise<void> | null = null;
/** Dedupe concurrent GIS token requests into one in-flight promise. */
let inFlightTokenRequest: Promise<{ accessToken: string; expiresIn: number }> | null = null;

export function loadGisScript(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google sign-in is only available in the browser'));
  }
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SCRIPT}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load Google sign-in')));
      if (window.google?.accounts?.oauth2) resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = GSI_SCRIPT;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error('Failed to load Google sign-in'));
    };
    document.head.appendChild(script);
  });

  return scriptPromise;
}

function getOauth2(): GisOauth2 {
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) throw new Error('Google sign-in failed to initialize');
  return oauth2;
}

export type GisPromptMode = 'consent' | 'select_account' | '';

/**
 * Request an access token via GIS.
 * - interactive + consent: first sign-in (all scopes once)
 * - interactive + select_account: reconnect when silent fails
 * - interactive false / prompt '': silent renew (no UI)
 */
export async function requestGisAccessToken(options: {
  clientId: string;
  interactive: boolean;
  /** Email hint so renew/reconnect targets the same account */
  loginHint?: string | null;
  /** Override prompt; defaults from interactive */
  prompt?: GisPromptMode;
}): Promise<{ accessToken: string; expiresIn: number }> {
  // Dedupe concurrent renewals / reconnects into a single GIS popup/call.
  if (inFlightTokenRequest) return inFlightTokenRequest;

  const run = (async () => {
    await loadGisScript();
    const oauth2 = getOauth2();
    const prompt: GisPromptMode =
      options.prompt ?? (options.interactive ? 'consent' : '');

    const tokenPromise = new Promise<{ accessToken: string; expiresIn: number }>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      const client = oauth2.initTokenClient({
        client_id: options.clientId,
        scope: SCOPE_STRING,
        hint: options.loginHint || undefined,
        callback: (response) => {
          settle(() => {
            if (response.error || !response.access_token) {
              const detail = response.error_description || response.error || 'token error';
              if (!options.interactive || prompt === '') {
                reject(new AuthExpiredError('Session expired — tap to reconnect Google', true));
                return;
              }
              reject(new Error(detail));
              return;
            }

            const granted =
              typeof oauth2.hasGrantedAllScopes === 'function'
                ? oauth2.hasGrantedAllScopes(response, ...GIS_REQUIRED_SCOPES)
                : hasScopesInTokenResponse(response, GIS_REQUIRED_SCOPES);

            if (!granted) {
              reject(
                new Error(
                  'Google did not grant Gmail and Drive access. Allow both permissions and try again.',
                ),
              );
              return;
            }

            resolve({
              accessToken: response.access_token,
              expiresIn: response.expires_in ?? 3600,
            });
          });
        },
        error_callback: (error) => {
          settle(() => {
            const type = (error?.type || '').toLowerCase();
            const message = error?.message || type || 'Google sign-in failed';
            if (!options.interactive || prompt === '' || type.includes('popup_closed') || type.includes('popup_failed')) {
              if (!options.interactive || prompt === '') {
                reject(new AuthExpiredError('Session expired — tap to reconnect Google', true));
                return;
              }
            }
            reject(new Error(message));
          });
        },
      });

      try {
        client.requestAccessToken({
          prompt,
          hint: options.loginHint || undefined,
        });
      } catch (e) {
        settle(() => reject(e instanceof Error ? e : new Error(String(e))));
      }
    });

    if (!options.interactive || prompt === '') {
      try {
        return await withTimeout(
          tokenPromise,
          GIS_SILENT_TIMEOUT_MS,
          'Silent Google token renew timed out',
        );
      } catch (e) {
        if (e instanceof AuthExpiredError) throw e;
        throw new AuthExpiredError('Session expired — tap to reconnect Google', true);
      }
    }

    return tokenPromise;
  })();

  inFlightTokenRequest = run.finally(() => {
    inFlightTokenRequest = null;
  });
  return inFlightTokenRequest;
}

/** Fallback when hasGrantedAllScopes is unavailable — inspect the space-delimited scope string. */
export function hasScopesInTokenResponse(
  response: { scope?: string },
  required: readonly string[],
): boolean {
  const granted = new Set((response.scope || '').split(/\s+/).filter(Boolean));
  // Some GIS builds omit scope on the token response; treat as unknown → allow and rely on API 403s.
  if (granted.size === 0) return true;
  return required.every((s) => granted.has(s));
}

export async function revokeGisToken(accessToken: string): Promise<void> {
  try {
    await loadGisScript();
    const oauth2 = getOauth2();
    if (oauth2.revoke) {
      await new Promise<void>((resolve) => {
        oauth2.revoke!(accessToken, () => resolve());
        setTimeout(() => resolve(), 2000);
      });
    }
  } catch {
    // best-effort
  }
}
