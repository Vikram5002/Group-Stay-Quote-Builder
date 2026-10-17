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
