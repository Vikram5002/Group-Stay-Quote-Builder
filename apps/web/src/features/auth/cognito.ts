import type { Actor, Role } from '@c32/core';
import type { Session } from './auth';

/**
 * Cognito hosted UI sign-in (T3-03, blueprint 7.2): OAuth 2.0 authorization code with PKCE, no
 * client secret, using only the browser's Web Crypto (no extra dependency). Enabled with
 * VITE_AUTH_MODE=cognito plus VITE_COGNITO_DOMAIN and VITE_COGNITO_CLIENT_ID. The access token
 * goes to the API as a bearer token; its cognito:groups claim gives the role.
 */

export interface CognitoConfig {
  /** For example https://c32-quote-dev-123.auth.ap-south-1.amazoncognito.com */
  domain: string;
  clientId: string;
  /** Must be one of the app client's callback URLs; the site root. */
  redirectUri: string;
}

const PKCE_KEY = 'c32.pkce';
const ROLE_ORDER: readonly Role[] = ['Owner', 'Sales', 'Viewer'];

export function cognitoConfig(): CognitoConfig | null {
  if (import.meta.env.VITE_AUTH_MODE !== 'cognito') return null;
  const domain = import.meta.env.VITE_COGNITO_DOMAIN;
  const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID;
  if (!domain || !clientId) return null;
  return { domain: domain.replace(/\/$/, ''), clientId, redirectUri: `${window.location.origin}/` };
}

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** RFC 7636 S256: base64url(sha256(verifier)). */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** The URL of the hosted sign-in page; remembers the verifier and state for the callback. */
export async function authorizeUrl(config: CognitoConfig, returnTo = '/'): Promise<string> {
  const verifier = randomString(48);
  const state = randomString(16);
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state, returnTo }));
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: 'openid email profile',
    code_challenge_method: 'S256',
    code_challenge: await pkceChallenge(verifier),
    state,
  });
  return `${config.domain}/oauth2/authorize?${params}`;
}

export function logoutUrl(config: CognitoConfig): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    logout_uri: config.redirectUri,
  });
  return `${config.domain}/logout?${params}`;
}

/** Read a JWT's claims (no verification: the API Gateway authorizer verifies every call). */
export function jwtClaims(token: string): Record<string, unknown> {
  const part = token.split('.')[1];
  if (!part) throw new Error('Not a JWT');
  const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(decodeURIComponent(escape(json))) as Record<string, unknown>;
}

/** Highest role among the user's Cognito groups, or null when they have none. */
export function roleFromGroups(groups: unknown): Role | null {
  const list = Array.isArray(groups) ? groups.map(String) : [];
  return ROLE_ORDER.find((r) => list.includes(r)) ?? null;
}

export class CognitoSignInError extends Error {}

/**
 * Finish sign-in on the callback URL (?code=...&state=...): exchange the code for tokens and
 * build a session. Returns null when the URL is not a callback.
 */
export async function completeSignIn(
  config: CognitoConfig,
  url: URL,
  fetchImpl: typeof fetch = fetch,
): Promise<{ session: Session; returnTo: string } | null> {
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error_description') ?? url.searchParams.get('error');
  if (error) throw new CognitoSignInError(error);
  if (!code) return null;

  const saved = sessionStorage.getItem(PKCE_KEY);
  sessionStorage.removeItem(PKCE_KEY);
  const pkce = saved
    ? (JSON.parse(saved) as { verifier: string; state: string; returnTo: string })
    : null;
  if (!pkce || pkce.state !== url.searchParams.get('state')) {
    throw new CognitoSignInError(
      'The sign-in response did not match this browser. Please sign in again.',
    );
  }

  const res = await fetchImpl(`${config.domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.clientId,
      code,
      redirect_uri: config.redirectUri,
      code_verifier: pkce.verifier,
    }),
  });
  if (!res.ok) throw new CognitoSignInError('Sign-in failed. Please try again.');
  const tokens = (await res.json()) as { access_token: string; id_token?: string };

  const access = jwtClaims(tokens.access_token);
  const role = roleFromGroups(access['cognito:groups']);
  if (!role) {
    throw new CognitoSignInError(
      'Your account has no role yet. Ask the owner to add you to Sales, Owner or Viewer.',
    );
  }
  const id = tokens.id_token ? jwtClaims(tokens.id_token) : {};
  const user: Actor = { user_id: String(access['sub']), role };
  const displayName = String(id['email'] ?? access['username'] ?? user.user_id);
  return { session: { user, displayName, token: tokens.access_token }, returnTo: pkce.returnTo };
}
