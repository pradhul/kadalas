import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AuthSession, getAuthService, resetAuthService } from '../services/auth';
import { createMockAuthService } from '../services/auth/mockAuth';
import { setForceDemoMode, useMocks } from '../services/config';
import { resetAiService } from '../services/ai';
import { resetDriveService } from '../services/drive';
import { resetGmailService } from '../services/gmail';

interface AuthContextValue {
  session: AuthSession | null;
  loading: boolean;
  isMock: boolean;
  signIn: () => Promise<void>;
  /** Explore the app with seeded demo data even when the build is in real (non-mock) mode. */
  signInWithDemo: () => Promise<void>;
  signOut: () => Promise<void>;
  error: string | null;
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const existing = await getAuthService().getSession();
        if (!cancelled) setSession(existing);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      setForceDemoMode(false);
      resetServiceSingletons();
      const next = await getAuthService().signIn();
      setSession(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const signInWithDemo = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      setForceDemoMode(true);
      resetServiceSingletons();
      const next = await createMockAuthService().signIn();
      setSession(next);
    } catch (e) {
      setForceDemoMode(false);
      resetServiceSingletons();
      setError(e instanceof Error ? e.message : String(e));
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
  }, []);

  const value = useMemo(
    () => ({
      session,
      loading,
      isMock: useMocks() || Boolean(session?.isMock),
      signIn,
      signInWithDemo,
      signOut,
      error,
    }),
    [session, loading, signIn, signInWithDemo, signOut, error],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
