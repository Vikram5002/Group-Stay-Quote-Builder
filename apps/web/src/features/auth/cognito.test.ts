import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CognitoSignInError,
  authorizeUrl,
  completeSignIn,
  jwtClaims,
  logoutUrl,
  pkceChallenge,
  roleFromGroups,
  type CognitoConfig,
} from './cognito';

const config: CognitoConfig = {
  domain: 'https://c32.auth.ap-south-1.amazoncognito.com',
  clientId: 'client123',
  redirectUri: 'https://site.example/',
};

/** An unsigned JWT with the given claims (the API Gateway authorizer verifies real ones). */
const jwt = (claims: Record<string, unknown>) =>
  `h.${btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.s`;

describe('PKCE and URLs', () => {
  beforeEach(() => sessionStorage.clear());

  it('S256 challenge matches the RFC 7636 example', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('builds the hosted UI URL with code flow, S256 and a state it remembers', async () => {
    const url = new URL(await authorizeUrl(config, '/quotes'));
    expect(url.origin + url.pathname).toBe(`${config.domain}/oauth2/authorize`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: 'client123',
      redirect_uri: 'https://site.example/',
      code_challenge_method: 'S256',
      scope: 'openid email profile',
    });
    const saved = JSON.parse(sessionStorage.getItem('c32.pkce') ?? '{}');
    expect(saved.state).toBe(url.searchParams.get('state'));
    expect(saved.returnTo).toBe('/quotes');
    expect(await pkceChallenge(saved.verifier)).toBe(url.searchParams.get('code_challenge'));
  });

  it('logout returns to the site', () => {
    expect(logoutUrl(config)).toBe(
      `${config.domain}/logout?client_id=client123&logout_uri=https%3A%2F%2Fsite.example%2F`,
    );
  });
});

describe('roles and claims', () => {
  it('the highest group wins; no group means no role', () => {
    expect(roleFromGroups(['Reception', 'ServiceManager'])).toBe('ServiceManager');
    expect(roleFromGroups(['Viewer'])).toBe('Viewer');
    expect(roleFromGroups(['Admins'])).toBeNull();
    expect(roleFromGroups(undefined)).toBeNull();
  });

  it('reads JWT claims, including non-ASCII', () => {
    const claims = { sub: 'u-1', name: 'Zoë' };
    const token = `h.${btoa(unescape(encodeURIComponent(JSON.stringify(claims))))}.s`;
    expect(jwtClaims(token)).toEqual(claims);
    expect(() => jwtClaims('nope')).toThrow();
  });
});

describe('completing sign-in on the callback', () => {
  let fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>;
  beforeEach(async () => {
    sessionStorage.clear();
    await authorizeUrl(config, '/review');
    fetchImpl = vi.fn<typeof fetch>();
  });
  afterEach(() => vi.restoreAllMocks());

  const state = () => JSON.parse(sessionStorage.getItem('c32.pkce') ?? '{}').state as string;
  const tokenResponse = (groups: string[]) =>
    new Response(
      JSON.stringify({
        access_token: jwt({ sub: 'sub-123', 'cognito:groups': groups, username: 'u' }),
        id_token: jwt({ email: 'owner@hotel.example' }),
      }),
      { status: 200 },
    );

  it('exchanges the code with the verifier and builds the session', async () => {
    fetchImpl.mockResolvedValue(tokenResponse(['ServiceManager']));
    const url = new URL(`https://site.example/?code=abc&state=${state()}`);
    const result = await completeSignIn(config, url, fetchImpl);
    expect(result?.returnTo).toBe('/review');
    expect(result?.session.user).toEqual({ user_id: 'sub-123', role: 'ServiceManager' });
    expect(result?.session.displayName).toBe('owner@hotel.example');

    const [endpoint, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(endpoint).toBe(`${config.domain}/oauth2/token`);
    const body = new URLSearchParams(String(init.body));
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('abc');
    expect(body.get('code_verifier')).toBeTruthy();
    expect(sessionStorage.getItem('c32.pkce')).toBeNull(); // one use only
  });

  it('records when the access token expires, so no tab uses it after that', async () => {
    const exp = 1_800_000_000; // seconds
    fetchImpl.mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: jwt({ sub: 'sub-123', 'cognito:groups': ['Reception'], exp }),
        }),
        { status: 200 },
      ),
    );
    const url = new URL(`https://site.example/?code=abc&state=${state()}`);
    const result = await completeSignIn(config, url, fetchImpl);
    expect(result?.session.expiresAt).toBe(exp * 1000);
  });

  it('is not a callback without ?code', async () => {
    expect(await completeSignIn(config, new URL('https://site.example/'), fetchImpl)).toBeNull();
  });

  it('rejects a state mismatch (a forged or stale callback)', async () => {
    const url = new URL('https://site.example/?code=abc&state=forged');
    await expect(completeSignIn(config, url, fetchImpl)).rejects.toBeInstanceOf(CognitoSignInError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports a Cognito error and an account without a role', async () => {
    await expect(
      completeSignIn(config, new URL('https://site.example/?error=access_denied'), fetchImpl),
    ).rejects.toThrow('access_denied');
    fetchImpl.mockResolvedValue(tokenResponse([]));
    await expect(
      completeSignIn(config, new URL(`https://site.example/?code=x&state=${state()}`), fetchImpl),
    ).rejects.toThrow(/no role/);
  });

  it('a failed token exchange is a sign-in error', async () => {
    fetchImpl.mockResolvedValue(new Response('{}', { status: 400 }));
    await expect(
      completeSignIn(config, new URL(`https://site.example/?code=x&state=${state()}`), fetchImpl),
    ).rejects.toThrow(/Sign-in failed/);
  });
});
