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

const pkg = (rooms: number, rate = 2000, floor: FloorPolicy = DEFAULT_POLICY): PricingInput => ({
  rooms,
  nights: flatNights('2026-11-01', 2, rate, 800),
  floor,
});

describe('floor rate rule (D-056: package floor / total rooms, cost included)', () => {
  it('7 rooms at the floor rate pass: the floor scales with the rooms', () => {
    const r = price(pkg(7));
    expect(r.totals).toMatchObject({
      room_nights: 14,
      contribution_inr: 16800,
      contribution_floor_inr: 16800, // 14 x 2000 - 11200
      floor_headroom_inr: 0,
    });
    expect(r.floor_ok).toBe(true);
  });

  it('the minimum safe rate is the floor rate whatever the volume', () => {
    for (const rooms of [1, 7, 10, 50]) {
      expect(price(pkg(rooms)).totals.min_rate_per_room_night_inr).toBe(2000);
    }
  });

  it('more rooms in the hotel lower the floor rate', () => {
    const twenty: FloorPolicy = { ...DEFAULT_POLICY, total_rooms_units: 20 };
    const r = price(pkg(10, 1500, twenty));
    expect(r.totals.floor_rate_per_room_night_inr).toBe(1000);
    expect(r.floor_ok).toBe(true);
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
      contribution_floor_inr: null,
      floor_headroom_inr: null,
      shortfall_inr: null,
      // the floor rate already includes the cost, so the minimum rate is still known
      min_rate_per_room_night_inr: 2000,
    });
    expect(r.floor_ok).toBeNull();
  });

  it('unknown rate: revenue and contribution are unknown, but the minimum safe rate is still known', () => {
    const r = price(withNight2(null, 800));
    expect(r.totals).toMatchObject({
      room_revenue_inr: null,
      variable_cost_inr: 16000,
      contribution_inr: null,
      min_rate_per_room_night_inr: 2000,
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
      contribution_floor_inr: 23000, // 20 x 2000 - 17000
      min_rate_per_room_night_inr: 2000,
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
  it('bundled breakfast cost 6000 must also be covered: minimum rate 2300', () => {
    const r = price({ ...pkg(10), extras: { revenue_inr: 0, cost_inr: 6000 } });
    expect(r.totals).toMatchObject({
      contribution_inr: 18000,
      contribution_floor_inr: 24000,
      shortfall_inr: 6000,
      min_rate_per_room_night_inr: 2300, // (20 x 2000 + 6000) / 20
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
      min_rate_per_room_night_inr: 1900, // (20 x 2000 + 6000 - 8000) / 20
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
      contribution_floor_inr: 0,
      contribution_margin_pct: null,
      min_rate_per_room_night_inr: null,
    });
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

describe('arithmetic trail (explainable decisions)', () => {
  it('explains the fixture quote line by line', () => {
    expect(price(pkg(10)).trail).toEqual([
      '10 rooms x 2 nights = 20 room-nights',
      '20 x 2000 = 40000 room revenue',
      '20 x 800 = 16000 variable cost',
      'floor rate 20000 / 10 rooms = 2000 per room-night, variable cost included',
      'floor 20 x 2000 - 16000 = 24000 contribution',
      '40000 - 16000 = 24000 contribution >= 24000 floor, headroom 0',
      'minimum safe rate = floor rate 2000',
    ]);
  });

  it('states the shortfall on a breach', () => {
    expect(price(pkg(10, 1500)).trail[5]).toBe(
      '30000 - 16000 = 14000 contribution < 24000 floor, shortfall 10000',
    );
  });

  it('lists nightly values when the rate varies', () => {
    const r = price({
      rooms: 10,
      nights: [
        { date: '2026-11-01', rate_inr: 2000, variable_cost_inr: 800 },
        { date: '2026-11-02', rate_inr: 2400, variable_cost_inr: 800 },
      ],
      floor: DEFAULT_POLICY,
    });
    expect(r.trail[1]).toBe('10 x (2000 + 2400) = 44000 room revenue');
    expect(r.trail[2]).toBe('20 x 800 = 16000 variable cost');
  });

  it('names the nights whose values are unknown', () => {
    const r = price({
      rooms: 10,
      nights: [
        { date: '2026-11-01', rate_inr: 2000, variable_cost_inr: 800 },
        { date: '2026-11-02', rate_inr: 2000, variable_cost_inr: null },
      ],
      floor: DEFAULT_POLICY,
    });
    expect(r.trail).toContain('variable cost unknown on 2026-11-02');
    expect(r.trail).toContain('contribution unknown, so the floor cannot be checked');
  });

  it('shows extras and the floor when they apply', () => {
    const r = price({ ...pkg(7), extras: { revenue_inr: 5600, cost_inr: 4200 } });
    expect(r.trail).toContain('inclusions revenue 5600, inclusions cost 4200');
    expect(r.trail).toContain('floor 14 x 2000 - 11200 = 16800 contribution');
    expect(r.trail).toContain(
      '28000 + 5600 - 11200 - 4200 = 18200 contribution >= 16800 floor, headroom 1400',
    );
    expect(r.trail).toContain('minimum safe rate ceil((2000 x 14 + 4200 - 5600) / 14) = 1900');
  });

  it('marks unknown extras explicitly', () => {
    const r = price({ ...pkg(10), extras: { revenue_inr: null, cost_inr: null } });
    expect(r.trail).toContain('inclusions revenue unknown, inclusions cost unknown');
  });
});

describe('extras detail lines', () => {
  it('prints each detail line before the extras totals', () => {
    const r = price({
      ...pkg(10),
      extras: { revenue_inr: 0, cost_inr: 6000, detail: ['Breakfast: ... = 6000 cost'] },
    });
    const at = r.trail.indexOf('Breakfast: ... = 6000 cost');
    expect(at).toBeGreaterThan(0);
    expect(r.trail[at + 1]).toBe('inclusions revenue 0, inclusions cost 6000');
  });
});
