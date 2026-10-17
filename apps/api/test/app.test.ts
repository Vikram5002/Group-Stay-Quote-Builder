import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { CONTRACT_VERSION, HealthResponse, ProblemDetails } from '@c32/core';
import { createApp } from '../src/app.js';

beforeAll(() => {
  process.env['LOG_SILENT'] = '1';
});

const app = createApp({ version: 'test' });

describe('GET /health', () => {
  it('returns the contract-shaped health body', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(HealthResponse.parse(res.body)).toEqual({
      status: 'ok',
      service: 'c32-api',
      version: 'test',
      contract_version: CONTRACT_VERSION,
    });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('echoes a well-formed request id and replaces a malformed one', async () => {
    const good = await request(app).get('/health').set('x-request-id', 'abc-123');
    expect(good.headers['x-request-id']).toBe('abc-123');
    const bad = await request(app).get('/health').set('x-request-id', 'bad id <script>');
    expect(bad.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('problem+json errors', () => {
  it('returns 404 NOT_FOUND for an unknown route', async () => {
    const res = await request(app).get('/v1/nope').expect(404);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    const body = ProblemDetails.parse(res.body);
    expect(body).toMatchObject({ code: 'NOT_FOUND', status: 404, instance: '/v1/nope' });
    expect(body.request_id).toBe(res.headers['x-request-id']);
  });

  it('returns 422 VALIDATION_FAILED with INVALID_JSON for a malformed body', async () => {
    const res = await request(app)
      .post('/v1/quotes')
      .set('content-type', 'application/json')
      .send('{"rooms": 10,')
      .expect(422);
    expect(ProblemDetails.parse(res.body)).toMatchObject({
      code: 'VALIDATION_FAILED',
      errors: [{ path: '', code: 'INVALID_JSON' }],
    });
  });

  it('returns 413 PAYLOAD_TOO_LARGE above the body limit', async () => {
    const big = JSON.stringify({ blob: 'x'.repeat(110 * 1024) });
    const res = await request(app)
      .post('/v1/quotes')
      .set('content-type', 'application/json')
      .send(big)
      .expect(413);
    expect(res.body.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('returns 415 for an unsupported charset', async () => {
    const res = await request(app)
      .post('/v1/quotes')
      .set('content-type', 'application/json; charset=latin-9')
      .send('{}')
      .expect(415);
    expect(res.body.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('hides internals behind 500 INTERNAL', async () => {
    const boom = createApp({
      register: (a) =>
        a.get('/boom', () => {
          throw new Error('secret detail');
        }),
    });
    const res = await request(boom).get('/boom').expect(500);
    expect(res.body).toMatchObject({ code: 'INTERNAL', status: 500 });
    expect(JSON.stringify(res.body)).not.toContain('secret detail');
  });
});
