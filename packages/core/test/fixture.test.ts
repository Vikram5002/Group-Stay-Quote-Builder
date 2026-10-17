import { describe, expect, it } from 'vitest';
import {
  InventoryNight,
  Policy,
  QuoteRequest,
  RatePlanNight,
  mapC32Fixture,
  stayNights,
} from '../src/index.js';
import { readJson } from './helpers.js';

const raw = readJson('data/fixtures/fixture.json');

describe('C32 fixture mapping', () => {
  const fx = mapC32Fixture(raw);

  it('maps to domain inputs that pass the contract schemas', () => {
    expect(Policy.safeParse(fx.policy).success).toBe(true);
    expect(QuoteRequest.safeParse(fx.request).success).toBe(true);
    for (const n of fx.inventory) expect(InventoryNight.safeParse(n).success).toBe(true);
    for (const r of fx.ratePlan) expect(RatePlanNight.safeParse(r).success).toBe(true);
  });

  it('keeps the fixture values: 10 rooms, 2 nights, rate 2000, cost 800, floor 20000', () => {
    expect(fx.request).toMatchObject({
      rooms: 10,
      room_type: 'standard',
      stay: { check_in: '2026-11-01', nights: 2 },
    });
    expect(fx.request.rate_per_room_night_inr).toBeUndefined(); // priced from the rate plan
    expect(
      fx.ratePlan.map((r) => [
        r.date,
        r.rate_per_room_night_inr,
        r.variable_cost_per_room_night_inr,
      ]),
    ).toEqual([
      ['2026-11-01', 2000, 800],
      ['2026-11-02', 2000, 800],
    ]);
    expect(fx.policy).toMatchObject({ floor_mode: 'absolute', contribution_floor_inr: 20000 });
    expect(fx.inventory.map((n) => [n.date, n.total_units, n.available_units])).toEqual([
      ['2026-11-01', 10, 10],
      ['2026-11-02', 10, 10],
    ]);
  });

  it('covers every night of the stay with an inventory row', () => {
    const nights = stayNights(fx.request.stay.check_in, fx.request.stay.nights ?? 0);
    expect(nights).toEqual(fx.inventory.map((n) => n.date));
  });

  it('carries the expected results and the three public checks', () => {
    expect(fx.expected).toEqual({ room_revenue_inr: 40000, contribution_inr: 24000 });
    expect(fx.publicChecks).toHaveLength(3);
  });

  it('keeps a null rooms cell as unknown inventory, never zero', () => {
    const copy = structuredClone(raw) as { records: { inventory: { rooms: number | null }[] } };
    copy.records.inventory[1]!.rooms = null;
    const night = mapC32Fixture(copy).inventory[1]!;
    expect(night.total_units).toBeNull();
    expect(night.available_units).toBeNull();
  });

  it('sorts inventory rows by date and rejects bad fixtures', () => {
    const copy = structuredClone(raw) as { records: { inventory: unknown[] } };
    copy.records.inventory.reverse();
    expect(mapC32Fixture(copy).request.stay.check_in).toBe('2026-11-01');

    const mixed = structuredClone(raw) as { records: { inventory: { room_type: string }[] } };
    mixed.records.inventory[1]!.room_type = 'deluxe';
    expect(() => mapC32Fixture(mixed)).toThrow(/one room type/);

    expect(() => mapC32Fixture({ ...(raw as object), synthetic: false })).toThrow();
  });
});
