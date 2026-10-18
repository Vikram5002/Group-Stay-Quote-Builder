/**
 * Golden pricing tests from the blueprint catalogue (section 14.2), under D-056 and D-057: full
 * price (floor rate) = package floor 20000 / 10 rooms = 2000 per room-night, cost included; Reception
 * may give up to 10% off, so the lowest rate is 1800. Fixture: rate 2000, cost 800.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POLICY,
  flatNights,
  mapC32Fixture,
  nightsFromRatePlan,
  price,
  type PricingInput,
} from '../src/index.js';
import { readJson } from './helpers.js';

const fixture = mapC32Fixture(readJson('data/fixtures/fixture.json'));

/** Fixture package at a given flat rate. */
const atRate = (rate: number, rooms = 10, nights = 2): PricingInput => ({
  rooms,
  nights: flatNights('2026-11-01', nights, rate, 800),
  floor: DEFAULT_POLICY,
});

describe('T01 fixture: 10 rooms x 2 nights x 2000', () => {
  const { request, ratePlan, policy } = fixture;
  const result = price({
    rooms: request.rooms,
    nights: nightsFromRatePlan(
      request.stay.check_in,
      request.stay.nights ?? 0,
      request.room_type,
      ratePlan,
    ),
    floor: policy,
  });

  it('matches the fixture expected revenue and contribution', () => {
    expect(result.totals.room_revenue_inr).toBe(fixture.expected.room_revenue_inr); // 40000
    expect(result.totals.contribution_inr).toBe(fixture.expected.contribution_inr); // 24000
  });

  it('computes every total exactly: full price, no discount', () => {
    expect(result.totals).toEqual({
      room_nights: 20,
      room_revenue_inr: 40000,
      inclusions_revenue_inr: 0,
      variable_cost_inr: 16000,
      inclusions_cost_inr: 0,
      contribution_inr: 24000,
      contribution_margin_pct: 60,
      contribution_floor_inr: 20000, // 20 x 1800 - 16000
      floor_rate_per_room_night_inr: 2000,
      list_revenue_inr: 40000,
      discount_pct: 0,
      max_discount_pct: 10,
      min_room_revenue_inr: 36000,
      floor_headroom_inr: 4000,
      shortfall_inr: 0,
      min_rate_per_room_night_inr: 1800,
    });
    expect(result.floor_ok).toBe(true);
  });

  it('agrees with the flat-rate oracle', () => {
    expect(price(atRate(2000)).totals).toEqual(result.totals);
  });
});

describe('T03 to T05 rate sweep around the lowest Reception rate 1800 (BR-06)', () => {
  it('T03 rate 1800 (10% off): exactly the lowest allowed rate passes', () => {
    const r = price(atRate(1800));
    expect(r.totals).toMatchObject({
      room_revenue_inr: 36000,
      contribution_inr: 20000,
      discount_pct: 10,
      floor_headroom_inr: 0,
      shortfall_inr: 0,
    });
    expect(r.floor_ok).toBe(true);
  });

  it('T04 rate 1799: one rupee under on 20 room-nights, shortfall 20', () => {
    const r = price(atRate(1799));
    expect(r.totals).toMatchObject({
      room_revenue_inr: 35980,
      contribution_inr: 19980,
      contribution_floor_inr: 20000,
      floor_headroom_inr: -20,
      shortfall_inr: 20,
      min_rate_per_room_night_inr: 1800,
    });
    expect(r.floor_ok).toBe(false);
  });

  it('T05 rate 1500 (25% off): over the Reception limit, shortfall 6000', () => {
    const r = price(atRate(1500));
    expect(r.totals).toMatchObject({
      room_revenue_inr: 30000,
      contribution_inr: 14000,
      contribution_margin_pct: 46.7,
      discount_pct: 25,
      shortfall_inr: 6000,
      min_rate_per_room_night_inr: 1800,
    });
    expect(r.floor_ok).toBe(false);
  });

  it('the minimum safe rate is the lowest Reception rate whatever the quoted rate', () => {
    for (const rate of [1, 1500, 1799, 2000, 50000]) {
      expect(price(atRate(rate)).totals.min_rate_per_room_night_inr).toBe(1800);
    }
  });

  it('the owner can widen or narrow the Reception limit', () => {
    const at = (pct: number) => ({ ...DEFAULT_POLICY, max_sales_discount_pct: pct });
    expect(price({ ...atRate(1700), floor: at(15) }).floor_ok).toBe(true); // 2000 - 15%
    expect(price({ ...atRate(1900), floor: at(0) }).floor_ok).toBe(false); // no discount allowed
  });

  it('the same rule holds for one room for one night (the small booking case)', () => {
    const ok = price(atRate(1800, 1, 1));
    expect(ok.totals).toMatchObject({ contribution_inr: 1000, contribution_floor_inr: 1000 });
    expect(ok.floor_ok).toBe(true);
    expect(price(atRate(1799, 1, 1)).floor_ok).toBe(false);
  });
});

describe('T18 minimum safe rate rounds up (BR-20)', () => {
  const threeRooms = { ...DEFAULT_POLICY, total_rooms_units: 3 };

  it('20000 / 3 rooms = 6667 full price; less 10% = 6000.3, rounded up to 6001', () => {
    const r = price({ ...atRate(1000, 3, 2), floor: threeRooms });
    expect(r.totals.floor_rate_per_room_night_inr).toBe(6667);
    expect(r.totals.min_rate_per_room_night_inr).toBe(6001);
  });

  it('fails one rupee below the minimum and passes at it', () => {
    expect(price({ ...atRate(6000, 3, 2), floor: threeRooms }).floor_ok).toBe(false);
    expect(price({ ...atRate(6001, 3, 2), floor: threeRooms }).floor_ok).toBe(true);
  });

  it('is never negative when extras more than pay for themselves', () => {
    const free = price({
      rooms: 10,
      nights: flatNights('2026-11-01', 2, 500, 0),
      floor: { ...DEFAULT_POLICY, contribution_floor_inr: 0 },
      extras: { revenue_inr: 5000, cost_inr: 0 },
    });
    expect(free.totals.min_rate_per_room_night_inr).toBe(0);
  });
});
