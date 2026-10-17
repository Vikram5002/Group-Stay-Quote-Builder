import type { Request } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { actorFromClaims, devAuthenticate, groupsFromClaim, jwtAuthenticate } from '../src/auth.js';

const req = (header?: string) => ({ get: () => header }) as unknown as Request;

describe('Cognito claims', () => {
  it('reads groups from an array or the HTTP API "[A B]" string form', () => {
    expect(groupsFromClaim(['Sales', 'Owner'])).toEqual(['Sales', 'Owner']);
    expect(groupsFromClaim('[Owner Sales]')).toEqual(['Owner', 'Sales']);
    expect(groupsFromClaim('Viewer')).toEqual(['Viewer']);
    expect(groupsFromClaim(undefined)).toEqual([]);
  });

  it('maps sub and the highest group to an actor', () => {
    expect(actorFromClaims({ sub: 'u-1', 'cognito:groups': '[Sales Owner]' })).toEqual({
      user_id: 'u-1',
      role: 'Owner',
    });
    expect(actorFromClaims({ sub: 'u-2', 'cognito:groups': ['Viewer'] })).toEqual({
      user_id: 'u-2',
      role: 'Viewer',
    });
  });

  it('no sub, a bad sub, or no known group means not authenticated', () => {
    expect(actorFromClaims(undefined)).toBeNull();
    expect(actorFromClaims({ 'cognito:groups': ['Owner'] })).toBeNull();
    expect(actorFromClaims({ sub: 'bad id with spaces', 'cognito:groups': ['Owner'] })).toBeNull();
    expect(actorFromClaims({ sub: 'u-3', 'cognito:groups': ['Admins'] })).toBeNull();
  });

  it('reads claims from the API Gateway v2 event', () => {
    const event = {
      requestContext: {
        authorizer: { jwt: { claims: { sub: 'u-9', 'cognito:groups': '[Sales]' } } },
      },
    };
    expect(jwtAuthenticate(() => event)(req())).toEqual({ user_id: 'u-9', role: 'Sales' });
    expect(jwtAuthenticate(() => undefined)(req())).toBeNull();
  });
});

describe('dev authentication', () => {
  afterEach(() => {
    delete process.env['AWS_LAMBDA_FUNCTION_NAME'];
  });

  it('parses x-dev-user', () => {
    expect(devAuthenticate(req('sales-1:Sales'))).toEqual({ user_id: 'sales-1', role: 'Sales' });
    expect(devAuthenticate(req('system:expiry:Owner'))).toEqual({
      user_id: 'system:expiry',
      role: 'Owner',
    });
  });

  it('rejects missing or malformed values', () => {
    for (const bad of [undefined, '', 'nobody', ':Owner', 'u:Admin', 'u u:Sales']) {
      expect(devAuthenticate(req(bad))).toBeNull();
    }
  });

  it('refuses to run inside Lambda', () => {
    process.env['AWS_LAMBDA_FUNCTION_NAME'] = 'c32-api';
    expect(() => devAuthenticate(req('sales-1:Sales'))).toThrow(/never run inside Lambda/);
  });
});
