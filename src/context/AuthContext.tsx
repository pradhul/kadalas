import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AuthSession, getAuthService } from '../services/auth';
import { useMocks } from '../services/config';

interface AuthContextValue {
  session: AuthSession | null;
  loading: boolean;
  isMock: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  error: string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

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
      const next = await getAuthService().signIn();
      setSession(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    await getAuthService().signOut();
    setSession(null);
  }, []);

  const value = useMemo(
    () => ({
      session,
      loading,
      isMock: useMocks() || Boolean(session?.isMock),
      signIn,
      signOut,
      error,
    }),
    [session, loading, signIn, signOut, error],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
