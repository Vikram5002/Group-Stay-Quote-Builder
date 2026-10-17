import { ProblemDetails, Quote, QuoteEventList } from '@c32/core';
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { devAuthenticate } from '../../src/auth.js';
import { hasDb } from '../data/local-db.js';
import { fixture, serviceHarness } from '../services/harness.js';

process.env['LOG_SILENT'] = '1';

describe.skipIf(!hasDb)('review queue over HTTP (DynamoDB Local)', () => {
  let app: Express;
  let drop: () => Promise<void>;
  beforeEach(async () => {
    const h = await serviceHarness();
    drop = h.drop;
    app = createApp({ deps: h.deps, authenticate: devAuthenticate });
  });
  afterEach(async () => drop());

  const as = (user: string) => ({
    post: (path: string, body: object = {}) =>
      request(app).post(path).set('x-dev-user', user).send(body),
    get: (path: string) => request(app).get(path).set('x-dev-user', user),
  });
  const sales = as('sales-1:Sales');
  const owner = as('owner-1:Owner');

  async function belowFloor(by = sales) {
    const res = await by
      .post('/v1/quotes', { ...fixture.request, rate_per_room_night_inr: 1500 })
      .expect(201);
    return Quote.parse(res.body);
  }

  it('T16: review queue -> approve with a reason -> confirm', async () => {
    const q = await belowFloor();
    const queue = await owner.get('/v1/quotes?status=PENDING_REVIEW').expect(200);
    expect(queue.body.items.map((x: Quote) => x.quote_id)).toEqual([q.quote_id]);

    const a = await owner
      .post(`/v1/quotes/${q.quote_id}/approve`, { reason: 'Strategic client' })
      .expect(200);
    expect(Quote.parse(a.body)).toMatchObject({
      status: 'OFFERED',
      approval: { reason: 'Strategic client' },
    });
    await sales.post(`/v1/quotes/${q.quote_id}/confirm`).expect(200);

    const audit = QuoteEventList.parse((await sales.get(`/v1/quotes/${q.quote_id}/audit`)).body);
    expect(audit.items.map((e) => e.type)).toEqual(['QUOTE_CREATED', 'APPROVED', 'CONFIRMED']);
  });

  it('T17: self-approval is 403; a Sales user cannot approve at all', async () => {
    const q = await belowFloor(owner);
    const self = await owner.post(`/v1/quotes/${q.quote_id}/approve`, { reason: 'My own deal' });
    expect(self.status).toBe(403);
    expect(ProblemDetails.parse(self.body).detail).toMatch(/Four-eyes/);
    await sales.post(`/v1/quotes/${q.quote_id}/approve`, { reason: 'Not allowed' }).expect(403);
  });

  it('a reason is required (at least 5 characters)', async () => {
    const q = await belowFloor();
    const res = await owner.post(`/v1/quotes/${q.quote_id}/approve`, { reason: 'ok' }).expect(422);
    expect(res.body.errors[0]).toMatchObject({ path: 'reason', code: 'INVALID_LENGTH' });
    await owner.post(`/v1/quotes/${q.quote_id}/approve`, {}).expect(422);
  });

  it('reject closes the quote and frees the rooms', async () => {
    const q = await belowFloor();
    await owner.post(`/v1/quotes/${q.quote_id}/reject`, { reason: 'Below our floor' }).expect(200);
    const avail = await sales.get(
      '/v1/availability?room_type=standard&from=2026-11-01&to=2026-11-02',
    );
    expect(avail.body.nights.map((n: { available_units: number }) => n.available_units)).toEqual([
      10, 10,
    ]);
    await sales.post(`/v1/quotes/${q.quote_id}/confirm`).expect(409);
  });
});
