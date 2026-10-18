import { Quote, QuoteEventList } from '@c32/core';
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { devAuthenticate } from '../../src/auth.js';
import { hasDb } from '../data/local-db.js';
import { fixture, serviceHarness } from '../services/harness.js';

process.env['LOG_SILENT'] = '1';

describe.skipIf(!hasDb)('amend, extend and cancel over HTTP (DynamoDB Local)', () => {
  let app: Express;
  let drop: () => Promise<void>;
  beforeEach(async () => {
    const h = await serviceHarness();
    drop = h.drop;
    app = createApp({ deps: h.deps, authenticate: devAuthenticate });
  });
  afterEach(async () => drop());

  const post = (path: string, payload: object = {}) =>
    request(app).post(path).set('x-dev-user', 'sales-1:Reception').send(payload);

  async function confirmed() {
    const q = Quote.parse((await post('/v1/quotes', fixture.request).expect(201)).body);
    await post(`/v1/quotes/${q.quote_id}/confirm`).expect(200);
    return q.quote_id;
  }

  it('T20: amend 10 to 7 at the floor rate frees 3 rooms per night with no review', async () => {
    const id = await confirmed();
    const res = await post(`/v1/quotes/${id}/amendments`, {
      rooms: 7,
      reason: 'Smaller group',
    }).expect(200);
    expect(Quote.parse(res.body)).toMatchObject({
      review_required: false,
      evaluation: { offered_rooms: 7 },
    });
    const avail = await request(app)
      .get('/v1/availability?room_type=standard&from=2026-11-01&to=2026-11-02')
      .set('x-dev-user', 'v-1:Viewer');
    expect(avail.body.nights.map((n: { available_units: number }) => n.available_units)).toEqual([
      3, 3,
    ]);
  });

  it('amendments validate the body and must reduce rooms', async () => {
    const id = await confirmed();
    expect((await post(`/v1/quotes/${id}/amendments`, {}).expect(422)).body.errors[0].path).toBe(
      'rooms',
    );
    await post(`/v1/quotes/${id}/amendments`, { rooms: 0 }).expect(422);
    expect((await post(`/v1/quotes/${id}/amendments`, { rooms: 10 }).expect(409)).body.code).toBe(
      'INVALID_STATE',
    );
  });

  it('extend then cancel, with the audit trail', async () => {
    const q = Quote.parse((await post('/v1/quotes', fixture.request)).body);
    const e = await post(`/v1/quotes/${q.quote_id}/extend`, { hours: 24 }).expect(200);
    expect(e.body.valid_until).toBe('2026-10-21T04:30:00.000Z');
    await post(`/v1/quotes/${q.quote_id}/extend`, { hours: 0 }).expect(422);
    await post(`/v1/quotes/${q.quote_id}/cancel`, { reason: 'Organiser withdrew' }).expect(200);
    await post(`/v1/quotes/${q.quote_id}/cancel`).expect(409);

    const audit = QuoteEventList.parse(
      (await request(app).get(`/v1/quotes/${q.quote_id}/audit`).set('x-dev-user', 'v-1:Viewer'))
        .body,
    );
    expect(audit.items.map((x) => x.type)).toEqual(['QUOTE_CREATED', 'EXTENDED', 'CANCELLED']);
  });

  it('cancel without a body is fine', async () => {
    const id = await confirmed();
    expect((await post(`/v1/quotes/${id}/cancel`).expect(200)).body.status).toBe('CANCELLED');
  });
});
