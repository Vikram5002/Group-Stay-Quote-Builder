import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Actor, Role } from '@c32/core';
import { makeMockToken } from '../../mocks/auth';

/**
 * Sign-in is mock first (T2-02). The same shape is kept for the Cognito hosted UI (PKCE) so the
 * rest of the app does not change when it is wired in (T3-03): a signed-in user, a token getter
 * and sign-out.
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

  const signInMock = useCallback((role: Role, displayName: string) => {
    const next = mockSession(role, displayName);
    persist(next);
    setSession(next);
    setSignedOutBy(null);
  }, []);

  const signOut = useCallback((reason?: 'manual') => {
    persist(null);
    setSession(null);
    setSignedOutBy(reason ?? 'expired');
  }, []);

  const token = session?.token ?? null;
  const getToken = useCallback(() => token, [token]);

  const value = useMemo<AuthContextValue>(
    () => ({ session, signInMock, signOut, signedOutBy, getToken }),
    [session, signInMock, signOut, signedOutBy, getToken],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
