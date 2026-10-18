import type { Request } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { actorFromClaims, devAuthenticate, groupsFromClaim, jwtAuthenticate } from '../src/auth.js';

const req = (header?: string) => ({ get: () => header }) as unknown as Request;

describe('Cognito claims', () => {
  it('reads groups from an array or the HTTP API "[A B]" string form', () => {
    expect(groupsFromClaim(['Reception', 'ServiceManager'])).toEqual([
      'Reception',
      'ServiceManager',
    ]);
    expect(groupsFromClaim('[ServiceManager Reception]')).toEqual(['ServiceManager', 'Reception']);
    expect(groupsFromClaim('Viewer')).toEqual(['Viewer']);
    expect(groupsFromClaim(undefined)).toEqual([]);
  });

  it('maps sub and the highest group to an actor', () => {
    expect(actorFromClaims({ sub: 'u-1', 'cognito:groups': '[Reception ServiceManager]' })).toEqual(
      {
        user_id: 'u-1',
        role: 'ServiceManager',
      },
    );
    expect(actorFromClaims({ sub: 'u-2', 'cognito:groups': ['Viewer'] })).toEqual({
      user_id: 'u-2',
      role: 'Viewer',
    });
  });

  it('no sub, a bad sub, or no known group means not authenticated', () => {
    expect(actorFromClaims(undefined)).toBeNull();
    expect(actorFromClaims({ 'cognito:groups': ['ServiceManager'] })).toBeNull();
    expect(
      actorFromClaims({ sub: 'bad id with spaces', 'cognito:groups': ['ServiceManager'] }),
    ).toBeNull();
    expect(actorFromClaims({ sub: 'u-3', 'cognito:groups': ['Admins'] })).toBeNull();
  });

  it('reads claims from the API Gateway v2 event', () => {
    const event = {
      requestContext: {
        authorizer: { jwt: { claims: { sub: 'u-9', 'cognito:groups': '[Reception]' } } },
      },
    };
    expect(jwtAuthenticate(() => event)(req())).toEqual({ user_id: 'u-9', role: 'Reception' });
    expect(jwtAuthenticate(() => undefined)(req())).toBeNull();
  });
});

describe('dev authentication', () => {
  afterEach(() => {
    delete process.env['AWS_LAMBDA_FUNCTION_NAME'];
  });

  it('parses x-dev-user', () => {
    expect(devAuthenticate(req('sales-1:Reception'))).toEqual({
      user_id: 'sales-1',
      role: 'Reception',
    });
    expect(devAuthenticate(req('system:expiry:ServiceManager'))).toEqual({
      user_id: 'system:expiry',
      role: 'ServiceManager',
    });
  });

  it('rejects missing or malformed values', () => {
    for (const bad of [undefined, '', 'nobody', ':ServiceManager', 'u:Admin', 'u u:Reception']) {
      expect(devAuthenticate(req(bad))).toBeNull();
    }
  });

  it('refuses to run inside Lambda', () => {
    process.env['AWS_LAMBDA_FUNCTION_NAME'] = 'c32-api';
    expect(() => devAuthenticate(req('sales-1:Reception'))).toThrow(/never run inside Lambda/);
  });
});
