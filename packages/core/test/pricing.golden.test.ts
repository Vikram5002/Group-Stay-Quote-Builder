/**
 * Golden pricing tests from the blueprint catalogue (section 14.2), under the floor rule of
 * D-056: floor rate = package floor 20000 / 10 rooms = 2000 per room-night, variable cost (800)
 * included. Fixture: rate 2000, cost 800.
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

  it('computes every total exactly: the rate is exactly the floor rate', () => {
    expect(result.totals).toEqual({
      room_nights: 20,
      room_revenue_inr: 40000,
      inclusions_revenue_inr: 0,
      variable_cost_inr: 16000,
      inclusions_cost_inr: 0,
      contribution_inr: 24000,
      contribution_margin_pct: 60,
      contribution_floor_inr: 24000, // 20 x 2000 - 16000
      floor_rate_per_room_night_inr: 2000,
      floor_headroom_inr: 0,
      shortfall_inr: 0,
      min_rate_per_room_night_inr: 2000,
    });
    expect(result.floor_ok).toBe(true);
  });

  it('agrees with the flat-rate oracle', () => {
    expect(price(atRate(2000)).totals).toEqual(result.totals);
  });
});

describe('T03 to T05 rate sweep around the floor rate 2000 (BR-06)', () => {
  it('T03 rate 2000: exactly the floor rate passes (equal passes)', () => {
    const r = price(atRate(2000));
    expect(r.totals).toMatchObject({ floor_headroom_inr: 0, shortfall_inr: 0 });
    expect(r.floor_ok).toBe(true);
  });

  it('T04 rate 1999: one rupee under on 20 room-nights, shortfall 20', () => {
    const r = price(atRate(1999));
    expect(r.totals).toMatchObject({
      room_revenue_inr: 39980,
      contribution_inr: 23980,
      contribution_floor_inr: 24000,
      floor_headroom_inr: -20,
      shortfall_inr: 20,
      min_rate_per_room_night_inr: 2000,
    });
    expect(r.floor_ok).toBe(false);
  });

  it('T05 rate 1500: shortfall 10000 (500 under on each of 20 room-nights)', () => {
    const r = price(atRate(1500));
    expect(r.totals).toMatchObject({
      room_revenue_inr: 30000,
      contribution_inr: 14000,
      contribution_margin_pct: 46.7,
      contribution_floor_inr: 24000,
      shortfall_inr: 10000,
      min_rate_per_room_night_inr: 2000,
    });
    expect(r.floor_ok).toBe(false);
  });

  it('1800, which passed under the old contribution floor, now needs review', () => {
    expect(price(atRate(1800)).floor_ok).toBe(false);
  });

  it('the minimum safe rate is the floor rate whatever the quoted rate', () => {
    for (const rate of [1, 1500, 1999, 2000, 50000]) {
      expect(price(atRate(rate)).totals.min_rate_per_room_night_inr).toBe(2000);
    }
  });

  it('the same rule holds for one room for one night (the small booking case)', () => {
    const ok = price(atRate(2000, 1, 1));
    expect(ok.totals).toMatchObject({ contribution_inr: 1200, contribution_floor_inr: 1200 });
    expect(ok.floor_ok).toBe(true);
    expect(price(atRate(1999, 1, 1)).floor_ok).toBe(false);
  });
});

describe('T18 minimum safe rate rounds up (BR-20)', () => {
  const threeRooms = { ...DEFAULT_POLICY, total_rooms_units: 3 };

  it('20000 / 3 rooms = 6666.67 rounds up to 6667', () => {
    const r = price({ ...atRate(1000, 3, 2), floor: threeRooms });
    expect(r.totals.floor_rate_per_room_night_inr).toBe(6667);
    expect(r.totals.min_rate_per_room_night_inr).toBe(6667);
  });

  it('fails one rupee below the minimum and passes at it', () => {
    expect(price({ ...atRate(6666, 3, 2), floor: threeRooms }).floor_ok).toBe(false);
    expect(price({ ...atRate(6667, 3, 2), floor: threeRooms }).floor_ok).toBe(true);
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
