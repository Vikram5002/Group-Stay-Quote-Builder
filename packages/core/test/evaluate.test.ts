import { describe, expect, it } from 'vitest';
import {
  Evaluation,
  evaluate,
  mapC32Fixture,
  validateQuoteRequest,
  type EvaluationContext,
  type InventoryNight,
  type RatePlanNight,
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

function run(request: object, context: EvaluationContext = ctx()) {
  const v = validateQuoteRequest({ ...fx.request, ...request });
  if (!v.ok) throw new Error(JSON.stringify(v.problem.errors));
  const result = evaluate(v.value, context);
  expect(Evaluation.safeParse(result.evaluation).success).toBe(true);
  return result;
}

describe('unknown availability (UNKNOWN_AVAILABILITY)', () => {
  const inventory: InventoryNight[] = [
    fx.inventory[0]!,
    { ...fx.inventory[1]!, total_units: null, available_units: null },
  ];

  it('goes to REVIEW, priced at the requested rooms, with no auto-confirm', () => {
    const { evaluation: e } = run({}, ctx({ inventory }));
    expect(e).toMatchObject({
      decision: 'REVIEW',
      reasons: ['UNKNOWN_AVAILABILITY'],
      offered_rooms: 10,
      auto_confirm_allowed: false,
    });
    expect(e.trail[0]).toBe('availability unknown on 2026-11-02: no hold can be taken');
  });
});

describe('unknown rate (UNKNOWN_RATE, BR-08)', () => {
  const ratePlan: RatePlanNight[] = fx.ratePlan.map((r) => ({
    ...r,
    rate_per_room_night_inr: null,
  }));

  it('without an override rate: REVIEW, revenue unknown, minimum safe rate still shown', () => {
    const { rate_per_room_night_inr: _r, ...noRate } = fx.request;
    const v = validateQuoteRequest(noRate);
    if (!v.ok) throw new Error('fixture request should be valid');
    const { evaluation: e } = evaluate(v.value, ctx({ ratePlan }));
    expect(e).toMatchObject({ decision: 'REVIEW', reasons: ['UNKNOWN_RATE'] });
    expect(e.totals.room_revenue_inr).toBeNull();
    expect(e.totals.min_rate_per_room_night_inr).toBe(1800);
  });

  it('an explicit override rate prices the quote', () => {
    const { evaluation: e } = run({ rate_per_room_night_inr: 2000 }, ctx({ ratePlan }));
    expect(e).toMatchObject({ decision: 'OFFER', reasons: [] });
  });
});

describe('too late to quote (TOO_LATE_TO_QUOTE)', () => {
  it('declines without pricing when the stay cutoff has passed', () => {
    const { evaluation: e, validity } = run(
      {},
      ctx({ nowMs: Date.parse('2026-10-31T12:00:00+05:30') }),
    );
    expect(validity.too_late).toBe(true);
    expect(e).toMatchObject({
      decision: 'DECLINE',
      reasons: ['TOO_LATE_TO_QUOTE'],
      offered_rooms: 0,
    });
    expect(e.trail).toEqual([
      'cutoff 2026-10-31T00:00:00+05:30 leaves less than 2h to respond: too late to quote',
      'decision DECLINE: TOO_LATE_TO_QUOTE, no auto-confirm',
    ]);
  });
});

describe('inclusions before the inclusions model (T1.05)', () => {
  it('any inclusion makes cost unknown, so the quote goes to REVIEW instead of ignoring it', () => {
    const { evaluation: e } = run({
      inclusions: [
        { name: 'Breakfast', basis: 'per_guest_night', unit_cost_inr: 150, included_in_rate: true },
      ],
    });
    expect(e).toMatchObject({ decision: 'REVIEW', reasons: ['UNKNOWN_COST'] });
    expect(e.totals.contribution_inr).toBeNull();
  });

  it('an empty inclusions list is the same as none', () => {
    expect(run({ inclusions: [] }).evaluation.decision).toBe('OFFER');
  });
});

describe('request forms and room types', () => {
  it('a stay given by check_out evaluates the same as by nights', () => {
    const byNights = run({}).evaluation;
    const byCheckOut = run({
      stay: { check_in: '2026-11-01', check_out: '2026-11-03' },
    }).evaluation;
    expect(byCheckOut).toEqual(byNights);
  });

  it('a room type with no inventory is declined as not on sale', () => {
    const { evaluation: e } = run({ room_type: 'deluxe' });
    expect(e).toMatchObject({ decision: 'DECLINE', reasons: ['NO_INVENTORY_DATA'] });
  });

  it('per-room-night floor scales with the offered rooms', () => {
    const policy = { ...fx.policy, floor_mode: 'per_room_night' as const };
    const { evaluation: e } = run({ rooms: 3 }, ctx({ policy }));
    expect(e.totals).toMatchObject({
      room_nights: 6,
      contribution_floor_inr: 6000,
      contribution_inr: 7200,
    });
    expect(e.decision).toBe('OFFER');
  });

  it('under the absolute floor a small group is REVIEW (the 20000 floor does not scale)', () => {
    expect(run({ rooms: 3 }).evaluation).toMatchObject({
      decision: 'REVIEW',
      reasons: ['FLOOR_BREACH'],
    });
  });
});

describe('purity', () => {
  it('does not mutate its inputs and gives the same answer twice', () => {
    const context = ctx();
    const snapshot = JSON.stringify(context);
    const a = run({ rooms: 12 }, context);
    const b = run({ rooms: 12 }, context);
    expect(JSON.stringify(context)).toBe(snapshot);
    expect(a).toEqual(b);
  });
});
