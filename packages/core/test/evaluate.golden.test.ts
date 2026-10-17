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

  it('per-room-night floor (16 x 1000 = 16000): a clean PARTIAL_OFFER for 8', () => {
    const policy = { ...fx.policy, floor_mode: 'per_room_night' as const };
    const { evaluation: e } = run({ rooms: 12 }, ctx({ inventory, policy }));
    expect(e).toMatchObject({
      decision: 'PARTIAL_OFFER',
      reasons: ['PARTIAL_AVAILABILITY'],
      auto_confirm_allowed: false,
    });
    expect(e.totals.contribution_floor_inr).toBe(16000);
  });

  it('absolute floor (20000): 19200 breaches it, so the partial goes to REVIEW (D-019)', () => {
    const { evaluation: e } = run({ rooms: 12 }, ctx({ inventory }));
    expect(e).toMatchObject({
      decision: 'REVIEW',
      reasons: ['FLOOR_BREACH', 'PARTIAL_AVAILABILITY'],
      auto_confirm_allowed: false,
    });
    expect(e.totals.shortfall_inr).toBe(800);
  });
});
