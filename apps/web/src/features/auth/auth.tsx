import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Actor, Role } from '@c32/core';
import { makeMockToken } from '../../mocks/auth';
import { authorizeUrl, cognitoConfig, completeSignIn, logoutUrl } from './cognito';

/**
 * Sign-in is mock first (T2-02); with VITE_AUTH_MODE=cognito it uses the Cognito hosted UI with
 * PKCE (T3-03, see cognito.ts). The rest of the app sees the same shape either way: a signed-in
 * user, a token getter and sign-out.
 */
export interface Session {
  user: Actor;
  displayName: string;
  token: string;
}

export interface AuthContextValue {
  session: Session | null;
  signInMock: (role: Role, displayName: string) => void;
  /** A manual sign-out starts clean; anything else (an expired session) returns to the same page. */
  signOut: (reason?: 'manual') => void;
  /** How the last sign-out happened, or null while signed in. */
  signedOutBy: 'manual' | 'expired' | null;
  getToken: () => string | null;
  /** 'cognito' on a deployed site (VITE_AUTH_MODE=cognito), otherwise the practice sign-in. */
  mode: 'mock' | 'cognito';
  /** Sends the browser to the Cognito hosted sign-in page. */
  signInCognito: (returnTo?: string) => void;
  /** True while a Cognito sign-in callback is being completed. */
  pending: boolean;
  /** Why the last Cognito sign-in failed, if it did. */
  authError: string | null;
}

const STORAGE_KEY = 'c32.session';

function load(): Session | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function persist(session: Session | null) {
  try {
    if (session) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be blocked; the session then lasts until reload.
  }
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function slugUser(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'user'
  );
}

export function mockSession(role: Role, displayName: string): Session {
  const user: Actor = { user_id: slugUser(displayName), role };
  return { user, displayName: displayName.trim(), token: makeMockToken(user) };
}

export function AuthProvider({
  children,
  initialSession,
}: {
  children: ReactNode;
  /** Tests pass a session so they do not need to sign in first. */
  initialSession?: Session | null;
}) {
  const [session, setSession] = useState<Session | null>(() =>
    initialSession === undefined ? load() : initialSession,
  );

  const [signedOutBy, setSignedOutBy] = useState<'manual' | 'expired' | null>(null);
  const cognito = useMemo(() => cognitoConfig(), []);
  const [pending, setPending] = useState(() => {
    if (!cognito) return false;
    const params = new URL(window.location.href).searchParams;
    return params.has('code') || params.has('error');
  });
  const [authError, setAuthError] = useState<string | null>(null);

  // Finish a Cognito sign-in when the hosted UI redirects back with ?code=...
  useEffect(() => {
    if (!cognito || !pending) return;
    let cancelled = false;
    completeSignIn(cognito, new URL(window.location.href))
      .then((result) => {
        if (cancelled || !result) return;
        persist(result.session);
        setSession(result.session);
        setSignedOutBy(null);
        window.history.replaceState(null, '', result.returnTo);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setAuthError(err instanceof Error ? err.message : 'Sign-in failed');
        window.history.replaceState(null, '', '/sign-in');
      })
      .finally(() => {
        if (!cancelled) setPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cognito, pending]);

  const signInCognito = useCallback(
    (returnTo = '/') => {
      if (!cognito) return;
      void authorizeUrl(cognito, returnTo).then((url) => window.location.assign(url));
    },
    [cognito],
  );

  const signInMock = useCallback((role: Role, displayName: string) => {
    const next = mockSession(role, displayName);
    persist(next);
    setSession(next);
    setSignedOutBy(null);
  }, []);

  const signOut = useCallback(
    (reason?: 'manual') => {
      persist(null);
      setSession(null);
      setSignedOutBy(reason ?? 'expired');
      // A deliberate sign-out also ends the Cognito session, so the next person must sign in.
      if (cognito && reason === 'manual') window.location.assign(logoutUrl(cognito));
    },
    [cognito],
  );

  const token = session?.token ?? null;
  const getToken = useCallback(() => token, [token]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      signInMock,
      signOut,
      signedOutBy,
      getToken,
      mode: cognito ? 'cognito' : 'mock',
      signInCognito,
      pending,
      authError,
    }),
    [
      session,
      signInMock,
      signOut,
      signedOutBy,
      getToken,
      cognito,
      signInCognito,
      pending,
      authError,
    ],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
