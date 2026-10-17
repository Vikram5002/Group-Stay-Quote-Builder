import { checkLedger, flatNights, stayNights, type InventoryNight } from '@c32/core';
import { afterEach, describe, expect, it } from 'vitest';
import { getInventory, putRatePlan } from '../../src/data/catalog.js';
import { getHoldLines } from '../../src/data/holds.js';
import { amendQuote, cancelQuote } from '../../src/services/changes.js';
import { confirmQuote } from '../../src/services/confirm-quote.js';
import { createQuote } from '../../src/services/create-quote.js';
import { ServiceError } from '../../src/services/errors.js';
import { hasDb, readLedger } from '../data/local-db.js';
import { request, sales, serviceHarness } from './harness.js';

/** 10 standard rooms from 1 to 7 Nov at 2000, cost 800. */
const week: InventoryNight[] = stayNights('2026-11-01', 7).map((date) => ({
  date,
  room_type: 'standard',
  total_units: 10,
  available_units: 10,
  held_units: 0,
  confirmed_units: 0,
}));

/** The owner's example: 5 rooms for 3 nights plus 3 rooms for 4 nights, both from 1 Nov. */
const wedding = () =>
  request({
    rooms: 5,
    stay: { check_in: '2026-11-01', nights: 3 },
    additional_lines: [{ stay: { check_in: '2026-11-01', nights: 4 }, rooms: 3 }],
  });

describe.skipIf(!hasDb)('multi-line quotes (DynamoDB Local, D-058)', () => {
  let drop: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await drop?.();
    drop = undefined;
  });
  async function setup() {
    const h = await serviceHarness(week);
    drop = h.drop;
    await putRatePlan(
      h.ctx,
      flatNights('2026-11-01', 7, 2000, 800).map((n) => ({
        date: n.date,
        room_type: 'standard',
        rate_per_room_night_inr: n.rate_inr,
        variable_cost_per_room_night_inr: n.variable_cost_inr,
        rack_rate_inr: null,
      })),
    );
    return h;
  }
  const counters = async (h: Awaited<ReturnType<typeof setup>>) =>
    (await getInventory(h.ctx, 'standard', '2026-11-01', '2026-11-05')).map((n) => [
      n.available_units,
      n.held_units,
      n.confirmed_units,
    ]);

  it('holds the sum of the lines on each night, in one transaction', async () => {
    const h = await setup();
    const q = await createQuote(h.deps, wedding(), sales);
    expect(q).toMatchObject({ status: 'OFFERED', evaluation: { offered_rooms: 8 } });
    expect(q.request.additional_lines).toHaveLength(1);
    expect((await getHoldLines(h.ctx, q.quote_id)).map((l) => [l.date, l.units])).toEqual([
      ['2026-11-01', 8],
      ['2026-11-02', 8],
      ['2026-11-03', 8],
      ['2026-11-04', 3],
    ]);
    expect(await counters(h)).toEqual([
      [2, 8, 0],
      [2, 8, 0],
      [2, 8, 0],
      [7, 3, 0],
      [10, 0, 0],
    ]);
    expect(checkLedger(await readLedger(h.ctx))).toEqual([]);
  });

  it('confirms and cancels as one booking', async () => {
    const h = await setup();
    const q = await createQuote(h.deps, wedding(), sales);
    await confirmQuote(h.deps, q.quote_id, sales);
    expect((await counters(h)).slice(0, 4)).toEqual([
      [2, 0, 8],
      [2, 0, 8],
      [2, 0, 8],
      [7, 0, 3],
    ]);
    expect(checkLedger(await readLedger(h.ctx))).toEqual([]);

    // Amending which line loses rooms is not supported yet; cancel and quote again instead.
    await expect(amendQuote(h.deps, q.quote_id, sales, 6, null)).rejects.toBeInstanceOf(
      ServiceError,
    );
    await cancelQuote(h.deps, q.quote_id, sales, 'Organiser withdrew');
    expect(
      (await counters(h)).every(([a, held, conf]) => a === 10 && held === 0 && conf === 0),
    ).toBe(true);
    expect(checkLedger(await readLedger(h.ctx))).toEqual([]);
  });

  it('a second quote that would overfill a shared night is declined, nothing is held', async () => {
    const h = await setup();
    await createQuote(h.deps, wedding(), sales); // 8 held on 1 to 3 Nov
    const other = await createQuote(
      h.deps,
      request({
        rooms: 1,
        stay: { check_in: '2026-11-04', nights: 1 },
        additional_lines: [{ stay: { check_in: '2026-11-03', nights: 1 }, rooms: 3 }],
      }),
      sales,
    );
    expect(other.evaluation).toMatchObject({ decision: 'DECLINE', reasons: ['NO_CAPACITY'] });
    expect(await getHoldLines(h.ctx, other.quote_id)).toEqual([]);
    expect(checkLedger(await readLedger(h.ctx))).toEqual([]);
  });
});
