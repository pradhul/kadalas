/**
 * Google Identity Services token client (web only).
 * Uses the implicit/token flow — no client_secret, suitable for a static SPA.
 */
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
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
};

type GisOauth2 = {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    callback: (response: GisTokenResponse) => void;
    error_callback?: (error: { type?: string; message?: string }) => void;
  }) => TokenClient;
  revoke?: (token: string, done?: () => void) => void;
};

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GisOauth2 } };
  }
}

const GSI_SCRIPT = 'https://accounts.google.com/gsi/client';
const SCOPE_STRING = GOOGLE_SCOPES.join(' ');

let scriptPromise: Promise<void> | null = null;

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

/**
 * Request an access token via GIS.
 * - interactive: true → may show account/consent popup
 * - interactive: false → prompt: '' (silent); throws AuthExpiredError if UI is required
 */
export async function requestGisAccessToken(options: {
  clientId: string;
  interactive: boolean;
}): Promise<{ accessToken: string; expiresIn: number }> {
  await loadGisScript();
  const oauth2 = getOauth2();

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const client = oauth2.initTokenClient({
      client_id: options.clientId,
      scope: SCOPE_STRING,
      callback: (response) => {
        settle(() => {
          if (response.error || !response.access_token) {
            const detail = response.error_description || response.error || 'token error';
            if (!options.interactive) {
              reject(new AuthExpiredError('Session expired — tap to reconnect Google', true));
              return;
            }
            reject(new Error(detail));
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
          if (!options.interactive || type.includes('popup_closed') || type.includes('popup_failed')) {
            if (!options.interactive) {
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
        prompt: options.interactive ? 'consent' : '',
      });
    } catch (e) {
      settle(() => reject(e instanceof Error ? e : new Error(String(e))));
    }
  });
}

export async function revokeGisToken(accessToken: string): Promise<void> {
  try {
    await loadGisScript();
    const oauth2 = getOauth2();
    if (oauth2.revoke) {
      await new Promise<void>((resolve) => {
        oauth2.revoke!(accessToken, () => resolve());
        // Don't hang if revoke never calls back
        setTimeout(() => resolve(), 2000);
      });
    }
  } catch {
    // best-effort
  }
}
