import { checkLedger } from '@c32/core';
import { afterEach, describe, expect, it } from 'vitest';
import { getInventory } from '../../src/data/catalog.js';
import { getHoldLines } from '../../src/data/holds.js';
import { requestHash, withIdempotency } from '../../src/data/idempotency.js';
import { getEvents, getQuote } from '../../src/data/quotes.js';
import { confirmQuote } from '../../src/services/confirm-quote.js';
import { createQuote } from '../../src/services/create-quote.js';
import { ServiceError } from '../../src/services/errors.js';
import { hasDb, readLedger } from '../data/local-db.js';
import { request, sales, serviceHarness } from './harness.js';

describe.skipIf(!hasDb)('confirmQuote (DynamoDB Local)', () => {
  let drop: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await drop?.();
    drop = undefined;
  });
  async function setup() {
    const h = await serviceHarness();
    drop = h.drop;
    return h;
  }
  const codeOf = (p: Promise<unknown>) =>
    p.then(
      () => 'ok',
      (e: unknown) => (e instanceof ServiceError ? e.code : String(e)),
    );

  it('confirms a clean offer: held rooms become confirmed, one CONFIRMED event', async () => {
    const { deps, ctx } = await setup();
    const q = await createQuote(deps, request(), sales);
    const c = await confirmQuote(deps, q.quote_id, sales);
    expect(c).toMatchObject({ status: 'CONFIRMED', version: 2 });
    expect(await getQuote(ctx, q.quote_id)).toEqual(c);
    const nights = await getInventory(ctx, 'standard', '2026-11-01', '2026-11-02');
    expect(nights.map((n) => [n.available_units, n.held_units, n.confirmed_units])).toEqual([
      [0, 0, 10],
      [0, 0, 10],
    ]);
    expect((await getEvents(ctx, q.quote_id)).map((e) => e.type)).toEqual([
      'QUOTE_CREATED',
      'CONFIRMED',
    ]);
    expect(checkLedger(await readLedger(ctx))).toEqual([]);
  });

  it('a clean partial offer (10 of 12) is confirmable', async () => {
    const { deps } = await setup();
    const q = await createQuote(deps, request({ rooms: 12 }), sales);
    expect((await confirmQuote(deps, q.quote_id, sales)).status).toBe('CONFIRMED');
  });

  it('T05: below the floor, confirm returns APPROVAL_REQUIRED and nothing moves', async () => {
    const { deps, ctx } = await setup();
    const q = await createQuote(deps, request({ rate_per_room_night_inr: 1500 }), sales);
    expect(await codeOf(confirmQuote(deps, q.quote_id, sales))).toBe('APPROVAL_REQUIRED');
    expect((await getQuote(ctx, q.quote_id))?.status).toBe('PENDING_REVIEW');
    expect((await getHoldLines(ctx, q.quote_id)).map((l) => l.state)).toEqual(['held', 'held']);
  });

  it('T15: confirm after valid_until returns QUOTE_EXPIRED, releases the holds, restores inventory', async () => {
    const { deps, ctx, clock } = await setup();
    const q = await createQuote(deps, request(), sales);
    clock.advance({ hours: 72 });
    expect(await codeOf(confirmQuote(deps, q.quote_id, sales))).toBe('QUOTE_EXPIRED');
    expect((await getQuote(ctx, q.quote_id))?.status).toBe('EXPIRED');
    expect(await getHoldLines(ctx, q.quote_id)).toEqual([]);
    const nights = await getInventory(ctx, 'standard', '2026-11-01', '2026-11-02');
    expect(nights.map((n) => [n.available_units, n.held_units])).toEqual([
      [10, 0],
      [10, 0],
    ]);
  });

  it('one millisecond before valid_until still confirms', async () => {
    const { deps, clock } = await setup();
    const q = await createQuote(deps, request(), sales);
    clock.set(Date.parse(q.valid_until!) - 1);
    expect((await confirmQuote(deps, q.quote_id, sales)).status).toBe('CONFIRMED');
  });

  it('refuses unknown, declined and already confirmed quotes', async () => {
    const { deps } = await setup();
    expect(await codeOf(confirmQuote(deps, '01JZZZZZZZZZZZZZZZZZZZZZZZ', sales))).toBe('NOT_FOUND');
    const declined = await createQuote(deps, request({ room_type: 'deluxe' }), sales);
    expect(await codeOf(confirmQuote(deps, declined.quote_id, sales))).toBe('INVALID_STATE');
    const clean = await createQuote(deps, request({ rooms: 9 }), sales); // 9 x 2 x 1200 = 21600
    expect(clean.status).toBe('OFFERED');
    await confirmQuote(deps, clean.quote_id, sales);
    expect(await codeOf(confirmQuote(deps, clean.quote_id, sales))).toBe('INVALID_STATE');
  });

  it('two confirms racing without a key: exactly one transition', async () => {
    const { deps, ctx } = await setup();
    const q = await createQuote(deps, request(), sales);
    const codes = await Promise.all(
      [1, 2, 3].map(() => codeOf(confirmQuote(deps, q.quote_id, sales))),
    );
    expect(codes.filter((c) => c === 'ok')).toHaveLength(1);
    expect((await getEvents(ctx, q.quote_id)).filter((e) => e.type === 'CONFIRMED')).toHaveLength(
      1,
    );
    expect(checkLedger(await readLedger(ctx))).toEqual([]);
  });

  describe('T24 double-submit confirm with the same Idempotency-Key', () => {
    const confirmOnce = (h: Awaited<ReturnType<typeof setup>>, quoteId: string, key: string) =>
      withIdempotency(
        h.ctx,
        {
          scope: `${sales.user_id}:confirm:${quoteId}`,
          key,
          requestHash: requestHash({
            method: 'POST',
            path: `/v1/quotes/${quoteId}/confirm`,
            body: {},
          }),
          nowMs: h.clock.now(),
        },
        async () => ({ status: 200, body: await confirmQuote(h.deps, quoteId, sales) }),
      );

    it('sequential repeat: one transition and an identical response', async () => {
      const h = await setup();
      const q = await createQuote(h.deps, request(), sales);
      const first = await confirmOnce(h, q.quote_id, 'confirm-key-0001');
      const second = await confirmOnce(h, q.quote_id, 'confirm-key-0001');
      expect(first.replayed).toBe(false);
      expect(second.replayed).toBe(true);
      expect(second.status).toBe(first.status);
      expect(second.body).toEqual(first.body);
      expect(
        (await getEvents(h.ctx, q.quote_id)).filter((e) => e.type === 'CONFIRMED'),
      ).toHaveLength(1);
    });

    it('concurrent double click: one transition, the duplicate is told to retry, then replays', async () => {
      const h = await setup();
      const q = await createQuote(h.deps, request(), sales);
      const results = await Promise.allSettled([
        confirmOnce(h, q.quote_id, 'confirm-key-0002'),
        confirmOnce(h, q.quote_id, 'confirm-key-0002'),
      ]);
      const done = results.filter((r) => r.status === 'fulfilled');
      expect(done.length).toBeGreaterThanOrEqual(1);
      for (const r of results.filter((x) => x.status === 'rejected')) {
        expect((r as PromiseRejectedResult).reason).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
      }
      expect(
        (await getEvents(h.ctx, q.quote_id)).filter((e) => e.type === 'CONFIRMED'),
      ).toHaveLength(1);
      const later = await confirmOnce(h, q.quote_id, 'confirm-key-0002');
      expect(later).toMatchObject({ status: 200, replayed: true, body: { status: 'CONFIRMED' } });
    });
  });
});
