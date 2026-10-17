import { checkLedger } from '@c32/core';
import { afterEach, describe, expect, it } from 'vitest';
import { getInventory } from '../../src/data/catalog.js';
import { getHoldLines } from '../../src/data/holds.js';
import { getEvents, getQuote } from '../../src/data/quotes.js';
import { createQuote } from '../../src/services/create-quote.js';
import { expireQuote } from '../../src/services/expire-quote.js';
import { hasDb, readLedger } from '../data/local-db.js';
import { request, sales, serviceHarness } from './harness.js';

describe.skipIf(!hasDb)('concurrency (DynamoDB Local)', () => {
  let drop: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await drop?.();
    drop = undefined;
  });

  it('T12: 20 parallel creates for 10 rooms with inventory 10: exactly one holds them', async () => {
    const h = await serviceHarness();
    drop = h.drop;

    const quotes = await Promise.all(
      Array.from({ length: 20 }, () => createQuote(h.deps, request({ rooms: 10 }), sales)),
    );

    const offered = quotes.filter((q) => q.evaluation.decision === 'OFFER');
    expect(offered).toHaveLength(1);
    expect(offered[0]?.evaluation.offered_rooms).toBe(10);
    // Everyone else re-evaluated against the new inventory: nothing left, so DECLINE.
    for (const q of quotes.filter((x) => x !== offered[0])) {
      expect(q.evaluation).toMatchObject({ decision: 'DECLINE', reasons: ['NO_CAPACITY'] });
      expect(await getHoldLines(h.ctx, q.quote_id)).toEqual([]);
    }

    const nights = await getInventory(h.ctx, 'standard', '2026-11-01', '2026-11-02');
    expect(nights.map((n) => [n.available_units, n.held_units, n.confirmed_units])).toEqual([
      [0, 10, 0],
      [0, 10, 0],
    ]);
    expect(checkLedger(await readLedger(h.ctx))).toEqual([]);
  }, 30_000);

  it('20 parallel creates for 3 rooms each: never more than 10 held, losers get partial or decline', async () => {
    const h = await serviceHarness();
    drop = h.drop;

    const quotes = await Promise.all(
      Array.from({ length: 20 }, () => createQuote(h.deps, request({ rooms: 3 }), sales)),
    );

    const held = quotes.reduce(
      (sum, q) => sum + (q.status === 'DECLINED' ? 0 : q.evaluation.offered_rooms),
      0,
    );
    expect(held).toBe(10); // 3 + 3 + 3 + 1: every room sold once, none twice
    for (const q of quotes) {
      expect(['OFFER', 'REVIEW', 'PARTIAL_OFFER', 'DECLINE']).toContain(q.evaluation.decision);
      expect(q.evaluation.offered_rooms).toBeLessThanOrEqual(3);
    }
    const nights = await getInventory(h.ctx, 'standard', '2026-11-01', '2026-11-02');
    expect(nights.map((n) => n.available_units)).toEqual([0, 0]);
    expect(checkLedger(await readLedger(h.ctx))).toEqual([]);
  }, 30_000);

  it('T13: A holds all 10; B asks for 5 and is declined; A expires; B then succeeds', async () => {
    const h = await serviceHarness();
    drop = h.drop;

    const a = await createQuote(h.deps, request({ rooms: 10 }), sales);
    expect(a.status).toBe('OFFERED');

    const b1 = await createQuote(h.deps, request({ rooms: 5 }), sales);
    expect(b1.evaluation).toMatchObject({ decision: 'DECLINE', reasons: ['NO_CAPACITY'] });

    // Not due yet: nothing happens.
    expect(await expireQuote(h.deps, a.quote_id)).toMatchObject({
      expired: false,
      reason: 'NOT_DUE',
    });

    h.clock.advance({ hours: 72 }); // valid_until reached
    const r = await expireQuote(h.deps, a.quote_id);
    expect(r).toMatchObject({ expired: true, quote: { status: 'EXPIRED', version: 2 } });
    expect(await getHoldLines(h.ctx, a.quote_id)).toEqual([]);
    expect((await getEvents(h.ctx, a.quote_id)).map((e) => e.type)).toEqual([
      'QUOTE_CREATED',
      'EXPIRED',
    ]);

    // Now 2026-10-20 10:00 IST, still well before the 2026-11-01 stay cutoff. B gets its 5 rooms
    // held, at the floor rate, so it is a clean OFFER.
    const b2 = await createQuote(h.deps, request({ rooms: 5 }), sales);
    expect(b2.evaluation).toMatchObject({ decision: 'OFFER', offered_rooms: 5 });
    expect(b2.status).toBe('OFFERED');
    expect(await getHoldLines(h.ctx, b2.quote_id)).toHaveLength(2);
    const nights = await getInventory(h.ctx, 'standard', '2026-11-01', '2026-11-02');
    expect(nights.map((n) => [n.available_units, n.held_units])).toEqual([
      [5, 5],
      [5, 5],
    ]);
    expect(checkLedger(await readLedger(h.ctx))).toEqual([]);
  });

  it('expiry racing itself (scheduler and sweeper): exactly one wins, rooms released once', async () => {
    const h = await serviceHarness();
    drop = h.drop;
    const a = await createQuote(h.deps, request({ rooms: 10 }), sales);
    h.clock.advance({ hours: 72 });

    const results = await Promise.all([1, 2, 3, 4].map(() => expireQuote(h.deps, a.quote_id)));
    expect(results.filter((r) => r.expired)).toHaveLength(1);
    expect(await getQuote(h.ctx, a.quote_id)).toMatchObject({ status: 'EXPIRED', version: 2 });
    expect((await getEvents(h.ctx, a.quote_id)).filter((e) => e.type === 'EXPIRED')).toHaveLength(
      1,
    );
    const nights = await getInventory(h.ctx, 'standard', '2026-11-01', '2026-11-02');
    expect(nights.map((n) => [n.available_units, n.held_units])).toEqual([
      [10, 0],
      [10, 0],
    ]);
    expect(checkLedger(await readLedger(h.ctx))).toEqual([]);
  });

  it('expireQuote leaves closed and unknown quotes alone', async () => {
    const h = await serviceHarness();
    drop = h.drop;
    expect(await expireQuote(h.deps, '01JZZZZZZZZZZZZZZZZZZZZZZZ')).toMatchObject({
      reason: 'NOT_FOUND',
    });
    h.clock.advance({ hours: 0 });
    const declined = await createQuote(h.deps, request({ room_type: 'deluxe' }), sales);
    h.clock.advance({ hours: 100 });
    expect(await expireQuote(h.deps, declined.quote_id)).toMatchObject({ reason: 'NOT_OPEN' });
  });
});
