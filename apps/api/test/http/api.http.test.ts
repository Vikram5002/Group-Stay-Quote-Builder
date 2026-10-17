import {
  AvailabilityResponse,
  Policy,
  ProblemDetails,
  Quote,
  QuoteEventList,
  QuoteList,
  QuotePreviewResponse,
  ROUTES,
} from '@c32/core';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp, HANDLERS } from '../../src/app.js';
import { devAuthenticate } from '../../src/auth.js';
import { hasDb } from '../data/local-db.js';
import { fixture, serviceHarness } from '../services/harness.js';

process.env['LOG_SILENT'] = '1';

const SALES = 'sales-1:Sales';
const SALES_2 = 'sales-2:Sales';
const OWNER = 'owner-1:Owner';
const VIEWER = 'viewer-1:Viewer';
const body = (over: object = {}) => ({ ...fixture.request, ...over });

describe('every handler is a contract operation', () => {
  it('handler names match ROUTES operationIds', () => {
    const ids = new Set(ROUTES.map((r) => r.operationId));
    for (const name of Object.keys(HANDLERS)) expect(ids.has(name)).toBe(true);
  });
});

describe.skipIf(!hasDb)('HTTP API (DynamoDB Local)', () => {
  let app: Express;
  let h: Awaited<ReturnType<typeof serviceHarness>>;

  beforeEach(async () => {
    h = await serviceHarness();
    app = createApp({ deps: h.deps, authenticate: devAuthenticate, corsOrigins: [] });
  });
  const drops: (() => Promise<void>)[] = [];
  beforeEach(() => {
    drops.push(h.drop);
  });
  afterAll(async () => {
    for (const d of drops) await d();
  });

  const post = (path: string, user: string, payload: object = {}) =>
    request(app).post(path).set('x-dev-user', user).send(payload);
  const get = (path: string, user: string) => request(app).get(path).set('x-dev-user', user);

  describe('public checks over HTTP', () => {
    it('1: 10 rooms x 2 nights x 2000 = 40000 revenue, contribution 24000, confirmable', async () => {
      const res = await post('/v1/quotes', SALES, body()).expect(201);
      const q = Quote.parse(res.body);
      expect(q.status).toBe('OFFERED');
      expect(q.evaluation.totals).toMatchObject({
        room_revenue_inr: 40000,
        contribution_inr: 24000,
      });
      expect(q.evaluation.auto_confirm_allowed).toBe(true);
      const c = await post(`/v1/quotes/${q.quote_id}/confirm`, SALES).expect(200);
      expect(Quote.parse(c.body).status).toBe('CONFIRMED');
    });

    it('2: 12 requested, 10 available: partial offer for 10', async () => {
      const res = await post('/v1/quotes', SALES, body({ rooms: 12 })).expect(201);
      expect(Quote.parse(res.body).evaluation).toMatchObject({
        decision: 'PARTIAL_OFFER',
        offered_rooms: 10,
        shortfall_rooms: 2,
      });
    });

    it('3: below the floor needs review; confirm is 409 APPROVAL_REQUIRED', async () => {
      const res = await post('/v1/quotes', SALES, body({ rate_per_room_night_inr: 1500 })).expect(
        201,
      );
      const q = Quote.parse(res.body);
      expect(q.status).toBe('PENDING_REVIEW');
      const c = await post(`/v1/quotes/${q.quote_id}/confirm`, SALES).expect(409);
      expect(c.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(ProblemDetails.parse(c.body)).toMatchObject({
        code: 'APPROVAL_REQUIRED',
        status: 409,
      });
    });
  });

  describe('quotes', () => {
    it('preview evaluates without holding or saving', async () => {
      const res = await post(
        '/v1/quotes/preview',
        SALES,
        body({ rate_per_room_night_inr: 1500 }),
      ).expect(200);
      const p = QuotePreviewResponse.parse(res.body);
      expect(p.evaluation.counter_offers[0]).toMatchObject({
        type: 'RAISE_RATE',
        rate_per_room_night_inr: 1800,
      });
      expect(p.terms_hash).toMatch(/^[0-9a-f]{64}$/);
      const list = QuoteList.parse((await get('/v1/quotes', VIEWER).expect(200)).body);
      expect(list.items).toEqual([]);
      const avail = AvailabilityResponse.parse(
        (await get('/v1/availability?room_type=standard&from=2026-11-01&to=2026-11-02', VIEWER))
          .body,
      );
      expect(avail.nights.map((n) => n.available_units)).toEqual([10, 10]);
    });

    it('a declined quote is saved and returned with 200', async () => {
      const res = await post('/v1/quotes', SALES, body({ room_type: 'deluxe' })).expect(200);
      expect(Quote.parse(res.body)).toMatchObject({ status: 'DECLINED', valid_until: null });
    });

    it('get, list (filters and paging) and audit', async () => {
      // a: 1 room below the floor rate (REVIEW); b: the other 9 at the floor rate (OFFER)
      const a = Quote.parse(
        (await post('/v1/quotes', SALES, body({ rooms: 1, rate_per_room_night_inr: 1500 }))).body,
      );
      const b = Quote.parse((await post('/v1/quotes', SALES, body({ rooms: 9 }))).body);
      expect(Quote.parse((await get(`/v1/quotes/${a.quote_id}`, VIEWER).expect(200)).body)).toEqual(
        a,
      );

      const all = QuoteList.parse((await get('/v1/quotes', VIEWER)).body);
      expect(all.items.map((q) => q.quote_id)).toEqual([b.quote_id, a.quote_id]); // newest first

      const offered = QuoteList.parse((await get('/v1/quotes?status=OFFERED', VIEWER)).body);
      expect(offered.items.map((q) => q.quote_id)).toEqual([b.quote_id]);

      const page1 = QuoteList.parse((await get('/v1/quotes?limit=1', VIEWER)).body);
      expect(page1.items).toHaveLength(1);
      expect(page1.next_cursor).not.toBeNull();
      const page2 = QuoteList.parse(
        (await get(`/v1/quotes?limit=1&cursor=${page1.next_cursor}`, VIEWER)).body,
      );
      expect(page2.items[0]?.quote_id).toBe(a.quote_id);

      const none = QuoteList.parse((await get('/v1/quotes?from=2026-12-01', VIEWER)).body);
      expect(none.items).toEqual([]);

      const audit = QuoteEventList.parse(
        (await get(`/v1/quotes/${a.quote_id}/audit`, VIEWER)).body,
      );
      expect(audit.items.map((e) => e.type)).toEqual(['QUOTE_CREATED']);
    });

    it('T15 over HTTP: confirm after expiry is 410 and the rooms come back', async () => {
      const q = Quote.parse((await post('/v1/quotes', SALES, body())).body);
      h.clock.advance({ hours: 72 });
      const res = await post(`/v1/quotes/${q.quote_id}/confirm`, SALES).expect(410);
      expect(res.body.code).toBe('QUOTE_EXPIRED');
      const avail = AvailabilityResponse.parse(
        (await get('/v1/availability?room_type=standard&from=2026-11-01&to=2026-11-02', VIEWER))
          .body,
      );
      expect(avail.nights.map((n) => [n.available_units, n.held_units])).toEqual([
        [10, 0],
        [10, 0],
      ]);
    });

    it('404 for unknown and malformed ids', async () => {
      expect(
        (await get('/v1/quotes/01JZZZZZZZZZZZZZZZZZZZZZZZ', VIEWER).expect(404)).body.code,
      ).toBe('NOT_FOUND');
      await get('/v1/quotes/not-a-ulid', VIEWER).expect(404);
      await get('/v1/quotes/01JZZZZZZZZZZZZZZZZZZZZZZZ/audit', VIEWER).expect(404);
      await post('/v1/quotes/01JZZZZZZZZZZZZZZZZZZZZZZZ/confirm', SALES).expect(404);
    });
  });

  describe('validation (422 with field paths)', () => {
    it.each([
      ['rooms 0', { rooms: 0 }, 'rooms:OUT_OF_RANGE'],
      ['rooms 2.5', { rooms: 2.5 }, 'rooms:NOT_INTEGER'],
      ['29 nights', { stay: { check_in: '2026-11-01', nights: 29 } }, 'stay.nights:OUT_OF_RANGE'],
      ['unknown field', { discount: 5 }, 'discount:UNKNOWN_FIELD'],
    ])('%s', async (_label, over, expected) => {
      const res = await post('/v1/quotes', SALES, body(over)).expect(422);
      const p = ProblemDetails.parse(res.body);
      expect(p.errors?.map((e) => `${e.path}:${e.code}`)).toContain(expected);
    });

    it('bad list and availability queries', async () => {
      expect((await get('/v1/quotes?status=NOPE', VIEWER).expect(422)).body.errors[0].path).toBe(
        'status',
      );
      expect((await get('/v1/quotes?cursor=%25%25', VIEWER).expect(422)).body.errors[0].path).toBe(
        'cursor',
      );
      expect((await get('/v1/quotes?limit=500', VIEWER).expect(422)).body.errors[0].path).toBe(
        'limit',
      );
      const r = await get(
        '/v1/availability?room_type=standard&from=2026-11-05&to=2026-11-01',
        VIEWER,
      ).expect(422);
      expect(r.body.errors[0]).toMatchObject({ path: 'to', code: 'DATE_ORDER' });
      await get('/v1/availability?room_type=standard&from=2026-01-01&to=2026-12-31', VIEWER).expect(
        422,
      );
    });
  });

  describe('T24 Idempotency-Key over HTTP', () => {
    it('a repeated create replays the same quote and creates only one', async () => {
      const send = () =>
        post('/v1/quotes', SALES, body()).set('idempotency-key', 'create-key-0001');
      const first = await send().expect(201);
      const second = await send().expect(201);
      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(second.body).toEqual(first.body);
      expect(QuoteList.parse((await get('/v1/quotes', VIEWER)).body).items).toHaveLength(1);
    });

    it('a repeated confirm is one transition with an identical response', async () => {
      const q = Quote.parse((await post('/v1/quotes', SALES, body())).body);
      const send = () =>
        post(`/v1/quotes/${q.quote_id}/confirm`, SALES).set('idempotency-key', 'confirm-0001');
      const a = await send().expect(200);
      const b = await send().expect(200);
      expect(b.body).toEqual(a.body);
      const audit = QuoteEventList.parse(
        (await get(`/v1/quotes/${q.quote_id}/audit`, VIEWER)).body,
      );
      expect(audit.items.filter((e) => e.type === 'CONFIRMED')).toHaveLength(1);
    });

    it('a stored refusal is replayed too (409 stays 409)', async () => {
      const q = Quote.parse(
        (await post('/v1/quotes', SALES, body({ rate_per_room_night_inr: 1500 }))).body,
      );
      const send = () =>
        post(`/v1/quotes/${q.quote_id}/confirm`, SALES).set('idempotency-key', 'confirm-0002');
      expect((await send().expect(409)).body.code).toBe('APPROVAL_REQUIRED');
      const again = await send().expect(409);
      expect(again.headers['idempotent-replayed']).toBe('true');
    });

    it('same key with a different body is 409; a malformed key is 422; keys are per user', async () => {
      await post('/v1/quotes', SALES, body()).set('idempotency-key', 'create-key-0002').expect(201);
      const clash = await post('/v1/quotes', SALES, body({ rooms: 1 })).set(
        'idempotency-key',
        'create-key-0002',
      );
      expect(clash.status).toBe(409);
      expect(clash.body.code).toBe('IDEMPOTENCY_CONFLICT');
      const bad = await post('/v1/quotes', SALES, body()).set('idempotency-key', 'no spaces!');
      expect(bad.status).toBe(422);
      expect(bad.body.errors[0].path).toBe('headers.idempotency-key');
      // Another user with the same key is a different request: it runs (here it is declined,
      // because the first quote holds all 10 rooms), it is not refused as a key clash.
      const other = await post('/v1/quotes', SALES_2, body({ rooms: 1 })).set(
        'idempotency-key',
        'create-key-0002',
      );
      expect(other.status).toBe(200);
      expect(other.body.status).toBe('DECLINED');
    });
  });

  describe('policy', () => {
    it('defaults until saved, then optimistic updates with VERSION_CONFLICT', async () => {
      const p0 = Policy.parse((await get('/v1/policy', OWNER).expect(200)).body);
      expect(p0).toMatchObject({
        version: 0,
        contribution_floor_inr: 20000,
        total_rooms_units: 10,
      });
      const { property_id: _p, ...update } = p0;
      const p1 = Policy.parse(
        (
          await request(app)
            .put('/v1/policy')
            .set('x-dev-user', OWNER)
            .send({ ...update, validity_hours: 48 })
            .expect(200)
        ).body,
      );
      expect(p1).toMatchObject({ version: 1, validity_hours: 48 });
      const stale = await request(app)
        .put('/v1/policy')
        .set('x-dev-user', OWNER)
        .send({ ...update, validity_hours: 24 });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('VERSION_CONFLICT');
      const invalid = await request(app)
        .put('/v1/policy')
        .set('x-dev-user', OWNER)
        .send({ ...update, min_validity_hours: 500 });
      expect(invalid.status).toBe(422);
    });

    it('a saved policy changes decisions: 20 rooms halve the floor rate, so 1500 is an OFFER', async () => {
      const { property_id: _p, ...p0 } = Policy.parse((await get('/v1/policy', OWNER)).body);
      const quote = () =>
        post('/v1/quotes/preview', SALES, body({ rate_per_room_night_inr: 1500 }));
      expect((await quote()).body.evaluation.decision).toBe('REVIEW'); // floor rate 2000
      await request(app)
        .put('/v1/policy')
        .set('x-dev-user', OWNER)
        .send({ ...p0, total_rooms_units: 20 })
        .expect(200);
      expect((await quote()).body.evaluation.decision).toBe('OFFER'); // floor rate 1000
    });

    it('saving total rooms sets every future night, never below what is held', async () => {
      const { property_id: _p, ...p0 } = Policy.parse((await get('/v1/policy', OWNER)).body);
      await post('/v1/quotes', SALES, body({ rooms: 6 })).expect(201); // holds 6 per night
      const save = (rooms: number, version: number) =>
        request(app)
          .put('/v1/policy')
          .set('x-dev-user', OWNER)
          .send({ ...p0, total_rooms_units: rooms, version })
          .expect(200);
      const nights = async () =>
        AvailabilityResponse.parse(
          (await get('/v1/availability?room_type=standard&from=2026-11-01&to=2026-11-02', VIEWER))
            .body,
        ).nights.map((n) => [n.total_units, n.available_units, n.held_units]);

      await save(15, 0);
      expect(await nights()).toEqual([
        [15, 9, 6],
        [15, 9, 6],
      ]);
      await save(4, 1); // below the 6 held: those nights are left alone
      expect(await nights()).toEqual([
        [15, 9, 6],
        [15, 9, 6],
      ]);
    });
  });

  describe('roles (FR-09): 401 without auth, 403 for the wrong role', () => {
    const ID = '01JZZZZZZZZZZZZZZZZZZZZZZZ';
    const calls: [string, 'get' | 'post' | 'put', string][] = ROUTES.filter(
      (r) => r.roles !== 'public' && HANDLERS[r.operationId],
    ).map((r) => [r.operationId, r.method, r.path.replace('{id}', ID)]);

    it.each(calls)('%s needs a signed-in user', async (_op, method, path) => {
      const res = await request(app)[method](path).send({});
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
    });

    it.each(
      ROUTES.filter((r) => r.roles !== 'public' && HANDLERS[r.operationId]).flatMap((r) =>
        (['Sales', 'Owner', 'Viewer'] as const)
          .filter((role) => !(r.roles as readonly string[]).includes(role))
          .map((role) => [r.operationId, role, r.method, r.path.replace('{id}', ID)] as const),
      ),
    )('%s is forbidden for %s', async (_op, role, method, path) => {
      const res = await request(app)[method](path).set('x-dev-user', `u-1:${role}`).send({});
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });
  });
});
