import { configure, getCurrentInvoke } from '@codegenie/serverless-express';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { jwtAuthenticate } from '../src/auth.js';
import { hasDb } from './data/local-db.js';
import { fixture, serviceHarness } from './services/harness.js';

process.env['LOG_SILENT'] = '1';

/** A realistic API Gateway HTTP API (payload 2.0) event, as the Cognito JWT authorizer sends it. */
function httpApiEvent(
  method: string,
  path: string,
  opts: {
    body?: unknown;
    claims?: Record<string, unknown>;
    headers?: Record<string, string>;
    query?: string;
  } = {},
) {
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: path,
    rawQueryString: opts.query ?? '',
    headers: {
      'content-type': 'application/json',
      host: 'abc123.execute-api.ap-south-1.amazonaws.com',
      ...opts.headers,
    },
    requestContext: {
      accountId: '123456789012',
      apiId: 'abc123',
      domainName: 'abc123.execute-api.ap-south-1.amazonaws.com',
      domainPrefix: 'abc123',
      http: { method, path, protocol: 'HTTP/1.1', sourceIp: '203.0.113.1', userAgent: 'test' },
      requestId: 'req-1',
      routeKey: '$default',
      stage: '$default',
      time: '17/Oct/2026:04:30:00 +0000',
      timeEpoch: 1792211400000,
      ...(opts.claims ? { authorizer: { jwt: { claims: opts.claims, scopes: null } } } : {}),
    },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body), isBase64Encoded: false }),
  };
}

const lambdaContext = {
  functionName: 'c32-api',
  awsRequestId: 'aws-req-1',
  getRemainingTimeInMillis: () => 30_000,
} as unknown as Parameters<ReturnType<typeof configure>>[1];

type LambdaResult = { statusCode: number; headers: Record<string, string>; body: string };

describe('Lambda adapter (serverless-express, HTTP API v2)', () => {
  it('serves /health without auth', async () => {
    const handler = configure({ app: createApp({ version: 'lambda-test' }) });
    const res = (await handler(
      httpApiEvent('GET', '/health'),
      lambdaContext,
      () => {},
    )) as LambdaResult;
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ status: 'ok', version: 'lambda-test' });
  });

  it.skipIf(!hasDb)('creates and confirms a quote with the actor from JWT claims', async () => {
    const h = await serviceHarness();
    try {
      const app = createApp({
        deps: h.deps,
        authenticate: jwtAuthenticate(() => getCurrentInvoke().event),
      });
      const handler = configure({ app });
      const claims = { sub: 'cognito-user-1', 'cognito:groups': '[Sales]' };

      const created = (await handler(
        httpApiEvent('POST', '/v1/quotes', { body: fixture.request, claims }),
        lambdaContext,
        () => {},
      )) as LambdaResult;
      expect(created.statusCode).toBe(201);
      const quote = JSON.parse(created.body);
      expect(quote.created_by).toEqual({ user_id: 'cognito-user-1', role: 'Sales' });
      expect(quote.evaluation.totals.contribution_inr).toBe(24000);

      const confirmed = (await handler(
        httpApiEvent('POST', `/v1/quotes/${quote.quote_id}/confirm`, { claims }),
        lambdaContext,
        () => {},
      )) as LambdaResult;
      expect(confirmed.statusCode).toBe(200);

      const list = (await handler(
        httpApiEvent('GET', '/v1/quotes', { query: 'status=CONFIRMED&limit=5', claims }),
        lambdaContext,
        () => {},
      )) as LambdaResult;
      expect(JSON.parse(list.body).items).toHaveLength(1);

      // No claims (authorizer missing) is 401; the dev header is ignored in this mode.
      const anon = (await handler(
        httpApiEvent('GET', '/v1/quotes', { headers: { 'x-dev-user': 'owner-1:Owner' } }),
        lambdaContext,
        () => {},
      )) as LambdaResult;
      expect(anon.statusCode).toBe(401);
      expect(anon.headers['content-type']).toMatch(/problem\+json/);
    } finally {
      await h.drop();
    }
  });
});
