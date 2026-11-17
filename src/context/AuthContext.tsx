import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import {
  AuthSession,
  friendlyAuthError,
  getAuthService,
  resetAuthService,
  subscribeAuthEvents,
} from '../services/auth';
import { createMockAuthService } from '../services/auth/mockAuth';
import {
  isDemoEntryAllowed,
  purgeStaleDemoLocalState,
  setForceDemoMode,
  useMocks,
} from '../services/config';
import { resetAiService } from '../services/ai';
import { resetDriveService } from '../services/drive';
import { resetGmailService } from '../services/gmail';
import { clearAuthTokens, getAuthTokens } from '../services/secureStorage';
import { clearIndexMirror } from '../services/indexMirror';

interface AuthContextValue {
  session: AuthSession | null;
  loading: boolean;
  isMock: boolean;
  /** True when the web GIS token expired and interactive reconnect is required. */
  needsReconnect: boolean;
  signIn: () => Promise<void>;
  /** Explore the app with seeded demo data even when the build is in real (non-mock) mode. */
  signInWithDemo: () => Promise<void>;
  /** Interactive Google reconnect after access-token expiry (web GIS). */
  reconnectGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  error: string | null;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function resetServiceSingletons() {
  resetAuthService();
  resetDriveService();
  resetGmailService();
  resetAiService();
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsReconnect, setNeedsReconnect] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Production: wipe leftover "Try demo data" flag + local mock vault/tokens
        // so Chase/Allstate never appear on a real build.
        if (!isDemoEntryAllowed()) {
          purgeStaleDemoLocalState();
          resetServiceSingletons();
          await clearIndexMirror();
        }

        const existing = await getAuthService().getSession();
        if (cancelled) return;

        // Reject mock sessions in production builds
        if (existing?.isMock && !isDemoEntryAllowed()) {
          await clearAuthTokens();
          setForceDemoMode(false);
          resetServiceSingletons();
          setSession(null);
        } else if (
          existing?.accessToken?.startsWith('mock_') &&
          !isDemoEntryAllowed()
        ) {
          await clearAuthTokens();
          setForceDemoMode(false);
          resetServiceSingletons();
          setSession(null);
        } else {
          setSession(existing);
        }
      } catch (e) {
        if (!cancelled) setError(friendlyAuthError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return subscribeAuthEvents((event) => {
      if (event === 'expired') setNeedsReconnect(true);
      if (event === 'restored') {
        setNeedsReconnect(false);
        void getAuthService()
          .getSession()
          .then((s) => {
            if (s) setSession(s);
          })
          .catch(() => undefined);
      }
    });
  }, []);

  // Proactive silent renew ~5 min before expiry + on focus/visibility.
  useEffect(() => {
    if (!session || session.isMock || Platform.OS !== 'web') return;

    const tryRenew = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void getAuthService()
        .getValidAccessToken()
        .then(async () => {
          const tokens = await getAuthTokens();
          if (tokens?.accessToken) {
            setSession((prev) =>
              prev
                ? {
                    ...prev,
                    accessToken: tokens.accessToken,
                    expiresAt: tokens.expiresAt,
                  }
                : prev,
            );
            setNeedsReconnect(false);
          }
        })
        .catch(() => {
          // getValidAccessToken emits 'expired' on hard failure
        });
    };

    const interval = setInterval(tryRenew, 60_000);
    const onFocus = () => tryRenew();
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', onFocus);
      document.addEventListener('visibilitychange', onFocus);
    }
    // Kick once shortly after mount if close to expiry
    const boot = setTimeout(tryRenew, 2_000);
    return () => {
      clearInterval(interval);
      clearTimeout(boot);
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', onFocus);
        document.removeEventListener('visibilitychange', onFocus);
      }
    };
  }, [session?.user?.email, session?.isMock, session?.expiresAt]);

  const clearError = useCallback(() => setError(null), []);

  const signIn = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      setForceDemoMode(false);
      resetServiceSingletons();
      const next = await getAuthService().signIn();
      setSession(next);
      setNeedsReconnect(false);
    } catch (e) {
      setError(friendlyAuthError(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const signInWithDemo = useCallback(async () => {
    if (!isDemoEntryAllowed()) {
      throw new Error('Demo mode is not available in this build');
    }
    setError(null);
    setLoading(true);
    try {
      setForceDemoMode(true);
      resetServiceSingletons();
      const next = await createMockAuthService().signIn();
      setSession(next);
      setNeedsReconnect(false);
    } catch (e) {
      setForceDemoMode(false);
      resetServiceSingletons();
      setError(friendlyAuthError(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const reconnectGoogle = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      setForceDemoMode(false);
      // Keep Drive/Gmail singletons — only refresh the Google token (shared for all screens).
      const auth = getAuthService();
      const next = auth.reconnect ? await auth.reconnect() : await auth.signIn();
      setSession(next);
      setNeedsReconnect(false);
    } catch (e) {
      setError(friendlyAuthError(e));
      setNeedsReconnect(true);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await getAuthService().signOut();
    } catch {
      // ignore — still clear local session / demo flag
    }
    setForceDemoMode(false);
    resetServiceSingletons();
    setSession(null);
    setNeedsReconnect(false);
  }, []);

  const value = useMemo(
    () => ({
      session,
      loading,
      isMock: useMocks() || Boolean(session?.isMock),
      needsReconnect,
      signIn,
      signInWithDemo,
      reconnectGoogle,
      signOut,
      error,
      clearError,
    }),
    [session, loading, needsReconnect, signIn, signInWithDemo, reconnectGoogle, signOut, error, clearError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
