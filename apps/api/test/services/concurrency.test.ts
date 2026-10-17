import { checkLedger } from '@c32/core';
import { afterEach, describe, expect, it } from 'vitest';
import { getInventory } from '../../src/data/catalog.js';
import { getHoldLines } from '../../src/data/holds.js';
import { createQuote } from '../../src/services/create-quote.js';
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
});
