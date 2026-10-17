/**
 * Golden pricing tests from the blueprint catalogue (section 14.2). Expected values use the
 * fixture: rate 2000, variable cost 800, absolute floor 20000.
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

  it('computes every total exactly', () => {
    expect(result.totals).toEqual({
      room_nights: 20,
      room_revenue_inr: 40000,
      inclusions_revenue_inr: 0,
      variable_cost_inr: 16000,
      inclusions_cost_inr: 0,
      contribution_inr: 24000,
      contribution_margin_pct: 60,
      contribution_floor_inr: 20000,
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

describe('T03 to T05 rate sweep around the floor (BR-06)', () => {
  it('T03 rate 1800: contribution 20000 equals the floor and passes', () => {
    const r = price(atRate(1800));
    expect(r.totals).toMatchObject({
      room_revenue_inr: 36000,
      contribution_inr: 20000,
      contribution_margin_pct: 55.6,
      floor_headroom_inr: 0,
      shortfall_inr: 0,
    });
    expect(r.floor_ok).toBe(true);
  });

  it('T04 rate 1799: contribution 19980 breaches the floor, shortfall 20', () => {
    const r = price(atRate(1799));
    expect(r.totals).toMatchObject({
      room_revenue_inr: 35980,
      contribution_inr: 19980,
      contribution_margin_pct: 55.5,
      floor_headroom_inr: -20,
      shortfall_inr: 20,
      min_rate_per_room_night_inr: 1800,
    });
    expect(r.floor_ok).toBe(false);
  });

  it('T05 rate 1500: contribution 14000 breaches the floor, shortfall 6000', () => {
    const r = price(atRate(1500));
    expect(r.totals).toMatchObject({
      room_revenue_inr: 30000,
      contribution_inr: 14000,
      contribution_margin_pct: 46.7,
      floor_headroom_inr: -6000,
      shortfall_inr: 6000,
      min_rate_per_room_night_inr: 1800,
    });
    expect(r.floor_ok).toBe(false);
  });

  it('the minimum safe rate does not depend on the quoted rate', () => {
    for (const rate of [1, 1500, 1799, 1800, 2000, 50000]) {
      expect(price(atRate(rate)).totals.min_rate_per_room_night_inr).toBe(1800);
    }
  });
});

describe('T18 minimum safe rate: 7 rooms x 3 nights, cost 800, floor 20000', () => {
  it('rounds (20000 + 16800) / 21 = 1752.38 up to 1753 (BR-20)', () => {
    const r = price(atRate(1000, 7, 3));
    expect(r.totals.room_nights).toBe(21);
    expect(r.totals.variable_cost_inr).toBe(16800);
    expect(r.totals.min_rate_per_room_night_inr).toBe(1753);
  });

  it('fails one rupee below the minimum and passes at it', () => {
    const below = price(atRate(1752, 7, 3));
    expect(below.totals.contribution_inr).toBe(19992);
    expect(below.floor_ok).toBe(false);

    const at = price(atRate(1753, 7, 3));
    expect(at.totals.contribution_inr).toBe(20013);
    expect(at.floor_ok).toBe(true);
  });

  it('is never negative when costs alone already clear the floor', () => {
    const r = price({ ...atRate(500), floor: { ...DEFAULT_POLICY, contribution_floor_inr: 0 } });
    expect(r.totals.min_rate_per_room_night_inr).toBe(800);
    const free = price({
      rooms: 10,
      nights: flatNights('2026-11-01', 2, 500, 0),
      floor: { ...DEFAULT_POLICY, contribution_floor_inr: 0 },
      extras: { revenue_inr: 5000, cost_inr: 0 },
    });
    expect(free.totals.min_rate_per_room_night_inr).toBe(0);
  });
});
