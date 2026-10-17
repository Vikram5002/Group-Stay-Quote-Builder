import { Quote, checkLedger } from '@c32/core';
import { afterEach, describe, expect, it } from 'vitest';
import { getInventory } from '../../src/data/catalog.js';
import { getHoldLines } from '../../src/data/holds.js';
import { getEvents, getQuote } from '../../src/data/quotes.js';
import { createQuote } from '../../src/services/create-quote.js';
import { hasDb, night, readLedger } from '../data/local-db.js';
import { fixture, request, sales, serviceHarness } from './harness.js';

describe.skipIf(!hasDb)('createQuote (DynamoDB Local)', () => {
  let drop: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await drop?.();
    drop = undefined;
  });

  async function setup(inventory = fixture.inventory) {
    const h = await serviceHarness(inventory);
    drop = h.drop;
    return h;
  }

  const counters = async (ctx: Awaited<ReturnType<typeof setup>>['ctx']) =>
    (await getInventory(ctx, 'standard', '2026-11-01', '2026-11-02')).map((n) => [
      n.available_units,
      n.held_units,
    ]);

  it('T01: offers 10 rooms, holds them, saves the quote and a QUOTE_CREATED event', async () => {
    const { deps, ctx } = await setup();
    const q = await createQuote(deps, request(), sales);

    expect(Quote.safeParse(q).success).toBe(true);
    expect(q).toMatchObject({
      status: 'OFFERED',
      version: 1,
      valid_until: '2026-10-20T04:30:00.000Z',
      created_by: sales,
      approval: null,
    });
    expect(q.terms_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(q.evaluation).toMatchObject({ decision: 'OFFER', offered_rooms: 10 });
    expect(q.request.stay).toEqual({ check_in: '2026-11-01', nights: 2 });

    expect(await getQuote(ctx, q.quote_id)).toEqual(q);
    expect(await counters(ctx)).toEqual([
      [0, 10],
      [0, 10],
    ]);
    const lines = await getHoldLines(ctx, q.quote_id);
    expect(lines.map((l) => [l.date, l.units, l.expires_at])).toEqual([
      ['2026-11-01', 10, '2026-10-20T04:30:00.000Z'],
      ['2026-11-02', 10, '2026-10-20T04:30:00.000Z'],
    ]);
    const events = await getEvents(ctx, q.quote_id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'QUOTE_CREATED',
      actor: sales,
      after: { status: 'OFFERED' },
    });
  });

  it('T02: 12 requested, holds only the 10 offered', async () => {
    const { deps, ctx } = await setup();
    const q = await createQuote(deps, request({ rooms: 12 }), sales);
    expect(q.evaluation).toMatchObject({
      decision: 'PARTIAL_OFFER',
      offered_rooms: 10,
      shortfall_rooms: 2,
    });
    expect(q.status).toBe('OFFERED');
    expect(await counters(ctx)).toEqual([
      [0, 10],
      [0, 10],
    ]);
  });

  it('REVIEW (below floor) holds rooms so an approved quote can still be confirmed', async () => {
    const { deps, ctx } = await setup();
    const q = await createQuote(deps, request({ rate_per_room_night_inr: 1500 }), sales);
    expect(q.status).toBe('PENDING_REVIEW');
    expect(q.evaluation.reasons).toEqual(['FLOOR_BREACH']);
    expect(await counters(ctx)).toEqual([
      [0, 10],
      [0, 10],
    ]);
  });

  it('DECLINE is saved with no hold and no valid_until', async () => {
    const { deps, ctx } = await setup([night('2026-11-01', 10), night('2026-11-02', 0)]);
    const q = await createQuote(deps, request(), sales);
    expect(q).toMatchObject({ status: 'DECLINED', valid_until: null });
    expect(await getHoldLines(ctx, q.quote_id)).toEqual([]);
    expect((await getEvents(ctx, q.quote_id))[0]?.type).toBe('QUOTE_DECLINED');
    expect(await getQuote(ctx, q.quote_id)).toEqual(q);
  });

  it('unknown availability goes to review with no hold', async () => {
    const { deps, ctx } = await setup([night('2026-11-01', 10), night('2026-11-02', null)]);
    const q = await createQuote(deps, request(), sales);
    expect(q.status).toBe('PENDING_REVIEW');
    expect(q.evaluation.reasons).toEqual(['UNKNOWN_AVAILABILITY']);
    expect(await getHoldLines(ctx, q.quote_id)).toEqual([]);
  });

  it('falls back to the default policy when none is saved', async () => {
    const { deps } = await setup();
    const q = await createQuote(deps, request({ rooms: 3 }), sales);
    expect(q.evaluation.totals.floor_rate_per_room_night_inr).toBe(2000); // 20000 / 10 rooms
  });

  it('keeps the ledger consistent', async () => {
    const { deps, ctx } = await setup();
    await createQuote(deps, request({ rooms: 4 }), sales);
    await createQuote(deps, request({ rooms: 4 }), sales);
    await createQuote(deps, request({ rooms: 4 }), sales); // only 2 left: partial
    expect(checkLedger(await readLedger(ctx))).toEqual([]);
  });
});
