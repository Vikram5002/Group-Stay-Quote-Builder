import { describe, expect, it } from 'vitest';
import {
  Evaluation,
  evaluate,
  mapC32Fixture,
  validateQuoteRequest,
  type EvaluationContext,
  type EvaluationResult,
  type InventoryNight,
} from '../src/index.js';
import { readJson } from './helpers.js';

const fx = mapC32Fixture(readJson('data/fixtures/fixture.json'));
const ISSUED = Date.parse('2026-10-17T10:00:00+05:30');

const ctx = (over: Partial<EvaluationContext> = {}): EvaluationContext => ({
  inventory: fx.inventory,
  ratePlan: fx.ratePlan,
  policy: fx.policy,
  nowMs: ISSUED,
  ...over,
});

const night = (date: string, available: number | null): InventoryNight => ({
  date,
  room_type: 'standard',
  total_units: available,
  available_units: available,
  held_units: 0,
  confirmed_units: 0,
});

/** Validate like the API does, then evaluate. Every result must satisfy the contract. */
function run(request: object, context: EvaluationContext = ctx()): EvaluationResult {
  const v = validateQuoteRequest({ ...fx.request, ...request });
  if (!v.ok) throw new Error(JSON.stringify(v.problem.errors));
  const result = evaluate(v.value, context);
  expect(Evaluation.safeParse(result.evaluation).success).toBe(true);
  return result;
}

describe('T01 fixture quote through the full pipeline', () => {
  const { evaluation: e, validity } = run({});

  it('offers all 10 rooms with auto-confirm allowed', () => {
    expect(e).toMatchObject({
      decision: 'OFFER',
      reasons: [],
      requested_rooms: 10,
      offered_rooms: 10,
      shortfall_rooms: 0,
      auto_confirm_allowed: true,
      check_in: '2026-11-01',
      check_out: '2026-11-03',
      nights: 2,
      counter_offers: [],
    });
    expect(e.totals).toMatchObject({
      room_revenue_inr: 40000,
      variable_cost_inr: 16000,
      contribution_inr: 24000,
      contribution_floor_inr: 20000,
      min_rate_per_room_night_inr: 1800,
    });
  });

  it('carries the validity window and ends the trail with the decision', () => {
    expect(validity.valid_until).toBe('2026-10-20T04:30:00.000Z');
    expect(e.trail.at(-1)).toBe('decision OFFER, auto-confirm allowed');
  });
});

describe('T02 12 rooms requested, 10 available on both nights', () => {
  const { evaluation: e } = run({ rooms: 12 });

  it('is a partial offer for 10 rooms, shortfall 2, never an over-hold (BR-05)', () => {
    expect(e).toMatchObject({
      decision: 'PARTIAL_OFFER',
      reasons: ['PARTIAL_AVAILABILITY'],
      requested_rooms: 12,
      offered_rooms: 10,
      shortfall_rooms: 2,
      auto_confirm_allowed: false,
    });
  });

  it('prices only the offered rooms', () => {
    expect(e.totals).toMatchObject({
      room_nights: 20,
      room_revenue_inr: 40000,
      contribution_inr: 24000,
    });
    expect(e.trail[0]).toBe(
      '12 requested, 10 sellable on every night (2026-11-01, 2026-11-02): offering 10',
    );
  });
});

describe('T09 second night has no inventory row', () => {
  const { evaluation: e } = run({}, ctx({ inventory: [night('2026-11-01', 10)] }));

  it('declines with NO_INVENTORY_DATA: the night is not on sale, never assumed available', () => {
    expect(e).toMatchObject({
      decision: 'DECLINE',
      reasons: ['NO_INVENTORY_DATA'],
      offered_rooms: 0,
      shortfall_rooms: 10,
      auto_confirm_allowed: false,
    });
  });

  it('prices nothing and explains which night is missing', () => {
    expect(e.totals.room_nights).toBe(0);
    expect(e.trail).toEqual([
      'no inventory for standard on 2026-11-02: not on sale',
      'decision DECLINE: NO_INVENTORY_DATA, no auto-confirm',
    ]);
  });
});

describe('T10 night 1 has 10 available, night 2 has 8; request 12', () => {
  const inventory = [night('2026-11-01', 10), night('2026-11-02', 8)];

  it('sellable is the minimum over the nights: 8 rooms offered, shortfall 4', () => {
    const { evaluation: e } = run({ rooms: 12 }, ctx({ inventory }));
    expect(e).toMatchObject({ offered_rooms: 8, shortfall_rooms: 4 });
    expect(e.reasons).toContain('PARTIAL_AVAILABILITY');
    expect(e.totals).toMatchObject({ room_nights: 16, contribution_inr: 19200 });
  });

  it('8 rooms at full price clear the floor (16 x 1800 - 12800 = 16000): a clean PARTIAL_OFFER', () => {
    const { evaluation: e } = run({ rooms: 12 }, ctx({ inventory }));
    expect(e).toMatchObject({
      decision: 'PARTIAL_OFFER',
      reasons: ['PARTIAL_AVAILABILITY'],
      auto_confirm_allowed: false,
    });
    expect(e.totals.contribution_floor_inr).toBe(16000);
  });

  it('a partial offer over the Reception discount limit goes to REVIEW (D-019)', () => {
    const { evaluation: e } = run({ rooms: 12, rate_per_room_night_inr: 1700 }, ctx({ inventory }));
    expect(e).toMatchObject({
      decision: 'REVIEW',
      reasons: ['FLOOR_BREACH', 'PARTIAL_AVAILABILITY'],
      auto_confirm_allowed: false,
    });
    expect(e.totals.shortfall_inr).toBe(1600); // 100 under on 16 room-nights
  });
});

describe('T11 no rooms sellable', () => {
  it('declines with NO_CAPACITY and offers nothing', () => {
    const { evaluation: e } = run(
      {},
      ctx({ inventory: [night('2026-11-01', 10), night('2026-11-02', 0)] }),
    );
    expect(e).toMatchObject({
      decision: 'DECLINE',
      reasons: ['NO_CAPACITY'],
      offered_rooms: 0,
      shortfall_rooms: 10,
      auto_confirm_allowed: false,
    });
    expect(e.trail).toEqual([
      '0 rooms sellable on every night (2026-11-01, 2026-11-02): nothing to offer',
      'decision DECLINE: NO_CAPACITY, no auto-confirm',
    ]);
  });

  it('also declines when fewer rooms than the minimum partial offer are sellable', () => {
    const policy = { ...fx.policy, min_partial_rooms_units: 5 };
    const { evaluation: e } = run(
      {},
      ctx({ policy, inventory: [night('2026-11-01', 3), night('2026-11-02', 3)] }),
    );
    expect(e).toMatchObject({ decision: 'DECLINE', reasons: ['NO_CAPACITY'], offered_rooms: 0 });
  });
});

describe('T06 variable cost is null: completed by the decision engine', () => {
  const ratePlan = fx.ratePlan.map((r) => ({ ...r, variable_cost_per_room_night_inr: null }));
  const { evaluation: e } = run({}, ctx({ ratePlan }));

  it('contribution is null (not 0) and the decision is REVIEW with UNKNOWN_COST', () => {
    expect(e.totals.contribution_inr).toBeNull();
    expect(e.totals.contribution_margin_pct).toBeNull();
    expect(e).toMatchObject({
      decision: 'REVIEW',
      reasons: ['UNKNOWN_COST'],
      offered_rooms: 10,
      auto_confirm_allowed: false,
    });
  });

  it('never reports a floor breach it cannot know about', () => {
    expect(e.reasons).not.toContain('FLOOR_BREACH');
    expect(e.trail).toContain('contribution unknown, so the floor cannot be checked');
  });
});

describe('T05 public check 3: a discount below the floor needs review', () => {
  it('rate 1500 is REVIEW with FLOOR_BREACH and no auto-confirm', () => {
    const { evaluation: e } = run({ rate_per_room_night_inr: 1500 });
    expect(e).toMatchObject({
      decision: 'REVIEW',
      reasons: ['FLOOR_BREACH'],
      offered_rooms: 10,
      auto_confirm_allowed: false,
    });
    expect(e.totals).toMatchObject({ contribution_inr: 14000, shortfall_inr: 6000 });
  });

  it('rate at the lowest Reception rate (1800, 10% off) is a clean OFFER; 1799 is not', () => {
    expect(run({ rate_per_room_night_inr: 1799 }).evaluation.decision).toBe('REVIEW');
    expect(run({ rate_per_room_night_inr: 1800 }).evaluation).toMatchObject({
      decision: 'OFFER',
      auto_confirm_allowed: true,
    });
  });
});

describe('T14 breakfast bundled at 150 per guest-night (assumption A6), 2 guests per room', () => {
  const { evaluation: e } = run({
    inclusions: [
      { name: 'Breakfast', basis: 'per_guest_night', unit_cost_inr: 150, included_in_rate: true },
    ],
  });

  it('cost 6000 drops contribution to 18000: REVIEW with FLOOR_BREACH, shortfall 2000', () => {
    expect(e.totals).toMatchObject({
      room_revenue_inr: 40000,
      variable_cost_inr: 16000,
      inclusions_cost_inr: 6000,
      inclusions_revenue_inr: 0,
      contribution_inr: 18000,
      shortfall_inr: 2000,
    });
    expect(e).toMatchObject({
      decision: 'REVIEW',
      reasons: ['FLOOR_BREACH'],
      auto_confirm_allowed: false,
    });
  });

  it('minimum safe rate is the lowest Reception rate plus breakfast per room-night: 1800 + 300 = 2100', () => {
    expect(e.totals.min_rate_per_room_night_inr).toBe(2100);
    expect(e.trail).toContain(
      'Breakfast: 10 rooms x 2 guests x 2 nights = 40 guest-nights x 150 = 6000 cost, included in the rate',
    );
  });
});

describe('T19 breakfast charged separately at 200 per guest-night (assumption)', () => {
  const { evaluation: e } = run({
    inclusions: [
      {
        name: 'Breakfast',
        basis: 'per_guest_night',
        unit_cost_inr: 150,
        included_in_rate: false,
        price_inr: 200,
      },
    ],
  });

  it('revenue 48000, cost 22000, contribution 26000: OFFER', () => {
    expect(e.totals).toMatchObject({
      room_revenue_inr: 40000,
      inclusions_revenue_inr: 8000,
      variable_cost_inr: 16000,
      inclusions_cost_inr: 6000,
      contribution_inr: 26000,
    });
    // total revenue 48000 and total cost 22000, as stated in the blueprint
    expect(e.totals.room_revenue_inr! + e.totals.inclusions_revenue_inr!).toBe(48000);
    expect(e.totals.variable_cost_inr! + e.totals.inclusions_cost_inr!).toBe(22000);
    expect(e).toMatchObject({ decision: 'OFFER', reasons: [], auto_confirm_allowed: true });
  });
});
