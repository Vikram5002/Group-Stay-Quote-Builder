import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POLICY,
  flatNights,
  price,
  nightsFromRatePlan,
  type FloorPolicy,
  type NightPrice,
  type PricingInput,
  type RatePlanNight,
} from '../src/index.js';

const perRoomNight: FloorPolicy = { ...DEFAULT_POLICY, floor_mode: 'per_room_night' };

const pkg = (rooms: number, rate = 2000, floor: FloorPolicy = DEFAULT_POLICY): PricingInput => ({
  rooms,
  nights: flatNights('2026-11-01', 2, rate, 800),
  floor,
});

describe('floor modes (decision G1, blueprint 5.8)', () => {
  it('absolute: 7 rooms after a partial cancellation earn 16800 and breach 20000', () => {
    const r = price(pkg(7));
    expect(r.totals).toMatchObject({
      room_nights: 14,
      room_revenue_inr: 28000,
      variable_cost_inr: 11200,
      contribution_inr: 16800,
      contribution_floor_inr: 20000,
      shortfall_inr: 3200,
    });
    expect(r.floor_ok).toBe(false);
  });

  it('per room-night: the same 7 rooms pass against a 14000 floor', () => {
    const r = price(pkg(7, 2000, perRoomNight));
    expect(r.totals).toMatchObject({
      contribution_inr: 16800,
      contribution_floor_inr: 14000,
      floor_headroom_inr: 2800,
    });
    expect(r.floor_ok).toBe(true);
  });

  it('per room-night: the minimum safe rate is volume independent', () => {
    for (const rooms of [1, 7, 10, 50]) {
      expect(price(pkg(rooms, 2000, perRoomNight)).totals.min_rate_per_room_night_inr).toBe(1800);
    }
  });

  it('absolute: the minimum safe rate falls as volume grows', () => {
    expect(price(pkg(5)).totals.min_rate_per_room_night_inr).toBe(2800); // (20000 + 8000) / 10
    expect(price(pkg(10)).totals.min_rate_per_room_night_inr).toBe(1800);
    expect(price(pkg(20)).totals.min_rate_per_room_night_inr).toBe(1300); // (20000 + 32000) / 40
  });
});

describe('unknown values propagate (BR-07, null means unknown, never zero)', () => {
  const withNight2 = (rate: number | null, cost: number | null): PricingInput => ({
    rooms: 10,
    nights: [
      { date: '2026-11-01', rate_inr: 2000, variable_cost_inr: 800 },
      { date: '2026-11-02', rate_inr: rate, variable_cost_inr: cost },
    ],
    floor: DEFAULT_POLICY,
  });

  it('T06 unknown cost on one night: contribution, margin and floor are unknown, not 0', () => {
    const r = price(withNight2(2000, null));
    expect(r.totals).toMatchObject({
      room_revenue_inr: 40000,
      variable_cost_inr: null,
      contribution_inr: null,
      contribution_margin_pct: null,
      floor_headroom_inr: null,
      shortfall_inr: null,
      min_rate_per_room_night_inr: null,
    });
    expect(r.floor_ok).toBeNull();
  });

  it('unknown rate: revenue and contribution are unknown, but the minimum safe rate is still known', () => {
    const r = price(withNight2(null, 800));
    expect(r.totals).toMatchObject({
      room_revenue_inr: null,
      variable_cost_inr: 16000,
      contribution_inr: null,
      min_rate_per_room_night_inr: 1800,
    });
    expect(r.floor_ok).toBeNull();
  });

  it('unknown inclusion cost makes contribution unknown', () => {
    const r = price({ ...withNight2(2000, 800), extras: { revenue_inr: 0, cost_inr: null } });
    expect(r.totals.inclusions_cost_inr).toBeNull();
    expect(r.totals.contribution_inr).toBeNull();
    expect(r.totals.min_rate_per_room_night_inr).toBeNull();
  });

  it('unknown inclusion revenue makes contribution and minimum rate unknown', () => {
    const r = price({ ...withNight2(2000, 800), extras: { revenue_inr: null, cost_inr: 0 } });
    expect(r.totals.contribution_inr).toBeNull();
    expect(r.totals.min_rate_per_room_night_inr).toBeNull();
  });
});

describe('per-night rates and the rate plan (BR-01, BR-08)', () => {
  const plan: RatePlanNight[] = [
    {
      date: '2026-11-01',
      room_type: 'standard',
      rate_per_room_night_inr: 2000,
      variable_cost_per_room_night_inr: 800,
      rack_rate_inr: 2600,
    },
    {
      date: '2026-11-02',
      room_type: 'standard',
      rate_per_room_night_inr: 2400,
      variable_cost_per_room_night_inr: 900,
      rack_rate_inr: 2600,
    },
    {
      date: '2026-11-01',
      room_type: 'deluxe',
      rate_per_room_night_inr: 5000,
      variable_cost_per_room_night_inr: 1500,
      rack_rate_inr: null,
    },
  ];

  it('sums revenue and cost night by night', () => {
    const r = price({
      rooms: 10,
      nights: nightsFromRatePlan('2026-11-01', 2, 'standard', plan),
      floor: DEFAULT_POLICY,
    });
    expect(r.totals).toMatchObject({
      room_revenue_inr: 44000, // 10 x 2000 + 10 x 2400
      variable_cost_inr: 17000, // 10 x 800 + 10 x 900
      contribution_inr: 27000,
      min_rate_per_room_night_inr: 1850, // ceil((20000 + 17000) / 20)
    });
  });

  it('uses only the requested room type', () => {
    const nights = nightsFromRatePlan('2026-11-01', 1, 'deluxe', plan);
    expect(nights).toEqual([{ date: '2026-11-01', rate_inr: 5000, variable_cost_inr: 1500 }]);
  });

  it('leaves a night with no plan row unknown', () => {
    const nights = nightsFromRatePlan('2026-11-02', 2, 'standard', plan);
    expect(nights[1]).toEqual({ date: '2026-11-03', rate_inr: null, variable_cost_inr: null });
  });

  it('an override rate replaces the plan rate on every night, cost still from the plan', () => {
    const nights = nightsFromRatePlan('2026-11-01', 3, 'standard', plan, 1900);
    expect(nights.map((n) => [n.rate_inr, n.variable_cost_inr])).toEqual([
      [1900, 800],
      [1900, 900],
      [1900, null],
    ]);
  });

  it('a flat plan gives the same totals as the flat oracle', () => {
    const flat: NightPrice[] = flatNights('2026-11-01', 2, 2000, 800);
    const viaPlan = nightsFromRatePlan('2026-11-01', 2, 'standard', [
      { ...plan[0]!, rate_per_room_night_inr: 2000, variable_cost_per_room_night_inr: 800 },
      { ...plan[1]!, rate_per_room_night_inr: 2000, variable_cost_per_room_night_inr: 800 },
    ]);
    expect(viaPlan).toEqual(flat);
  });
});

describe('extras (inclusions arrive in T1.05; blueprint 5.6 numbers)', () => {
  it('bundled breakfast cost 6000 pushes contribution to 18000 and the minimum rate to 2100', () => {
    const r = price({ ...pkg(10), extras: { revenue_inr: 0, cost_inr: 6000 } });
    expect(r.totals).toMatchObject({
      contribution_inr: 18000,
      shortfall_inr: 2000,
      min_rate_per_room_night_inr: 2100, // (20000 + 16000 + 6000) / 20
    });
    expect(r.floor_ok).toBe(false);
  });

  it('breakfast charged separately at 8000 restores contribution to 26000', () => {
    const r = price({ ...pkg(10), extras: { revenue_inr: 8000, cost_inr: 6000 } });
    expect(r.totals).toMatchObject({
      room_revenue_inr: 40000,
      inclusions_revenue_inr: 8000,
      inclusions_cost_inr: 6000,
      contribution_inr: 26000,
      contribution_margin_pct: 54.2, // 26000 / 48000 total revenue
      min_rate_per_room_night_inr: 1700, // (20000 + 22000 - 8000) / 20
    });
    expect(r.floor_ok).toBe(true);
  });
});

describe('input guards and edge cases', () => {
  it('zero rooms: nothing to spread over, so margin and minimum rate are unknown', () => {
    const r = price(pkg(0));
    expect(r.totals).toMatchObject({
      room_nights: 0,
      room_revenue_inr: 0,
      contribution_inr: 0,
      contribution_margin_pct: null,
      min_rate_per_room_night_inr: null,
      shortfall_inr: 20000,
    });
    expect(r.floor_ok).toBe(false);
  });

  it.each([
    ['fractional rooms', { ...pkg(10), rooms: 2.5 }],
    ['negative rooms', { ...pkg(10), rooms: -1 }],
    ['too many rooms', { ...pkg(10), rooms: 501 }],
    ['fractional rate', pkg(10, 1999.5)],
    ['negative rate', pkg(10, -1)],
    ['fractional cost', { ...pkg(10), nights: flatNights('2026-11-01', 2, 2000, 0.5) }],
    ['too many nights', { ...pkg(10), nights: flatNights('2026-11-01', 29, 2000, 800) }],
    ['fractional extras', { ...pkg(10), extras: { revenue_inr: 0, cost_inr: 1.5 } }],
    ['negative extras revenue', { ...pkg(10), extras: { revenue_inr: -1, cost_inr: 0 } }],
  ])('rejects %s', (_label, input) => {
    expect(() => price(input as PricingInput)).toThrow(RangeError);
  });
});
