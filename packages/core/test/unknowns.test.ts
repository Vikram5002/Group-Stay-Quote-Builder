import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POLICY,
  mapC32Fixture,
  flatNights,
  isKnown,
  nightsFromRatePlan,
  orderReasons,
  price,
  unknownPricingReasons,
  type RatePlanNight,
} from '../src/index.js';
import { readJson } from './helpers.js';

describe('T06 variable cost is null', () => {
  const nights = flatNights('2026-11-01', 2, 2000, null);
  const result = price({ rooms: 10, nights, floor: DEFAULT_POLICY });

  it('contribution is null, not 0, and nothing derived from it is invented', () => {
    expect(result.totals.room_revenue_inr).toBe(40000);
    expect(result.totals.variable_cost_inr).toBeNull();
    expect(result.totals.contribution_inr).toBeNull();
    expect(result.totals.contribution_margin_pct).toBeNull();
    expect(result.totals.floor_headroom_inr).toBeNull();
    expect(result.floor_ok).toBeNull();
  });

  it('raises UNKNOWN_COST (the decision engine turns it into REVIEW in T1.04)', () => {
    expect(unknownPricingReasons(nights)).toEqual(['UNKNOWN_COST']);
  });

  it('the fixture with its cost removed behaves the same way', () => {
    const fx = mapC32Fixture(readJson('data/fixtures/fixture.json'));
    const plan = fx.ratePlan.map((r) => ({ ...r, variable_cost_per_room_night_inr: null }));
    const fromPlan = nightsFromRatePlan('2026-11-01', 2, 'standard', plan);
    expect(unknownPricingReasons(fromPlan)).toEqual(['UNKNOWN_COST']);
    expect(
      price({ rooms: 10, nights: fromPlan, floor: fx.policy }).totals.contribution_inr,
    ).toBeNull();
  });
});

describe('unknown pricing reasons (BR-07, BR-08)', () => {
  const plan: RatePlanNight[] = [
    {
      date: '2026-11-01',
      room_type: 'standard',
      rate_per_room_night_inr: null,
      variable_cost_per_room_night_inr: 800,
      rack_rate_inr: null,
    },
  ];

  it('no reasons when everything is known', () => {
    expect(unknownPricingReasons(flatNights('2026-11-01', 2, 2000, 800))).toEqual([]);
    expect(
      unknownPricingReasons(flatNights('2026-11-01', 2, 2000, 800), {
        revenue_inr: 0,
        cost_inr: 0,
      }),
    ).toEqual([]);
  });

  it('UNKNOWN_RATE when the plan has no rate and there is no override', () => {
    expect(unknownPricingReasons(nightsFromRatePlan('2026-11-01', 1, 'standard', plan))).toEqual([
      'UNKNOWN_RATE',
    ]);
  });

  it('an explicit override rate clears UNKNOWN_RATE', () => {
    expect(
      unknownPricingReasons(nightsFromRatePlan('2026-11-01', 1, 'standard', plan, 2000)),
    ).toEqual([]);
  });

  it('a night with no plan row raises both', () => {
    expect(unknownPricingReasons(nightsFromRatePlan('2026-11-02', 1, 'standard', plan))).toEqual([
      'UNKNOWN_COST',
      'UNKNOWN_RATE',
    ]);
  });

  it('unknown inclusion cost or revenue raises UNKNOWN_COST', () => {
    const nights = flatNights('2026-11-01', 2, 2000, 800);
    expect(unknownPricingReasons(nights, { revenue_inr: 0, cost_inr: null })).toEqual([
      'UNKNOWN_COST',
    ]);
    expect(unknownPricingReasons(nights, { revenue_inr: null, cost_inr: 0 })).toEqual([
      'UNKNOWN_COST',
    ]);
  });
});

describe('helpers', () => {
  it('isKnown treats 0 as known and null or undefined as unknown', () => {
    expect([0, 1, null, undefined].map(isKnown)).toEqual([true, true, false, false]);
  });

  it('orderReasons de-duplicates into catalogue order', () => {
    expect(orderReasons(['UNKNOWN_RATE', 'FLOOR_BREACH', 'UNKNOWN_COST', 'FLOOR_BREACH'])).toEqual([
      'FLOOR_BREACH',
      'UNKNOWN_COST',
      'UNKNOWN_RATE',
    ]);
  });
});
