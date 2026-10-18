import { describe, expect, it } from 'vitest';
import {
  Evaluation,
  commercialTerms,
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

describe('inclusions in the pipeline', () => {
  const breakfast = {
    name: 'Breakfast',
    basis: 'per_guest_night' as const,
    unit_cost_inr: 150,
    included_in_rate: true,
  };

  it('guests per room come from the request before the policy default', () => {
    // 10 rooms x 3 guests x 2 nights x 150 = 9000; 24000 - 9000 = 15000 < 20000
    const { evaluation: e } = run({ inclusions: [breakfast], guests_per_room_units: 3 });
    expect(e.totals.inclusions_cost_inr).toBe(9000);
    expect(e.trail).toContain(
      'Breakfast: 10 rooms x 3 guests x 2 nights = 60 guest-nights x 150 = 9000 cost, included in the rate',
    );
  });

  it('unknown guests per room (no request value, policy null) is REVIEW with UNKNOWN_COST', () => {
    const policy = { ...fx.policy, guests_per_room_units: null };
    const { evaluation: e } = run({ inclusions: [breakfast] }, ctx({ policy }));
    expect(e).toMatchObject({ decision: 'REVIEW', reasons: ['UNKNOWN_COST'] });
    expect(e.totals.contribution_inr).toBeNull();
  });

  it('inclusions are priced for the offered rooms on a partial offer', () => {
    // 12 requested, 10 offered: 10 x 2 x 2 x 150 = 6000, not 7200
    const { evaluation: e } = run({ rooms: 12, inclusions: [breakfast] });
    expect(e.offered_rooms).toBe(10);
    expect(e.totals.inclusions_cost_inr).toBe(6000);
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

  it('the floor scales with the offered rooms, so a small group at the floor rate is an OFFER', () => {
    const { evaluation: e } = run({ rooms: 3 });
    expect(e.totals).toMatchObject({
      room_nights: 6,
      contribution_floor_inr: 6000, // 6 x 1800 - 4800
      contribution_inr: 7200,
    });
    expect(e.decision).toBe('OFFER');
  });

  it('one room for one night at the floor rate is an OFFER (the small booking case)', () => {
    expect(run({ rooms: 1, stay: { check_in: '2026-11-01', nights: 1 } }).evaluation.decision).toBe(
      'OFFER',
    );
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

describe('Reception discount off the full price (D-057)', () => {
  it('5% off: rate 1900, within the 10% limit, a clean OFFER', () => {
    const { evaluation: e } = run({ rate_per_room_night_inr: undefined, discount_pct: 5 });
    expect(e.decision).toBe('OFFER');
    expect(e.totals).toMatchObject({
      room_revenue_inr: 38000,
      list_revenue_inr: 40000,
      discount_pct: 5,
      max_discount_pct: 10,
      min_room_revenue_inr: 36000,
    });
  });

  it('10% off is the limit; 11% goes to the owner, with a raise-the-rate fix', () => {
    expect(run({ rate_per_room_night_inr: undefined, discount_pct: 10 }).evaluation.decision).toBe(
      'OFFER',
    );
    const { evaluation: e } = run({ rate_per_room_night_inr: undefined, discount_pct: 11 });
    expect(e).toMatchObject({ decision: 'REVIEW', reasons: ['FLOOR_BREACH'] });
    expect(e.counter_offers[0]).toMatchObject({
      type: 'RAISE_RATE',
      rate_per_room_night_inr: 1800,
    });
  });

  it('the owner limit comes from the policy', () => {
    const policy = { ...fx.policy, max_sales_discount_pct: 20 };
    expect(
      run({ rate_per_room_night_inr: undefined, discount_pct: 15 }, ctx({ policy })).evaluation
        .decision,
    ).toBe('OFFER');
  });

  it('a discount and a rate together are refused', () => {
    const v = validateQuoteRequest({
      ...fx.request,
      rate_per_room_night_inr: 2000,
      discount_pct: 5,
    });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.problem.errors).toEqual([
        {
          path: 'discount_pct',
          code: 'INCONSISTENT',
          message: 'Give one price: a % discount, a ₹ discount or a rate',
        },
      ]);
    }
  });
});

describe('Reception discount in rupees off the full price', () => {
  const base = { rate_per_room_night_inr: undefined };

  it('200 off 2000 is a rate of 1800: the 10% limit, still a clean OFFER', () => {
    const { evaluation: e } = run({ ...base, discount_inr: 200 });
    expect(e.decision).toBe('OFFER');
    expect(e.totals).toMatchObject({
      room_revenue_inr: 36000,
      list_revenue_inr: 40000,
      discount_pct: 10,
    });
    expect(e.trail.join('\n')).toMatch(/discount 200 off the full price 2000 = rate 1800/);
  });

  it('201 off goes to the owner, and the fix raises the rate without the discount', () => {
    const { evaluation: e } = run({ ...base, discount_inr: 201 });
    expect(e).toMatchObject({ decision: 'REVIEW', reasons: ['FLOOR_BREACH'] });
    expect(e.counter_offers[0]).toMatchObject({
      type: 'RAISE_RATE',
      rate_per_room_night_inr: 1800,
    });
  });

  it.each([
    ['a % and a ₹ discount', { discount_pct: 5, discount_inr: 100 }],
    ['a ₹ discount and a rate', { discount_inr: 100, rate_per_room_night_inr: 2000 }],
    ['a % discount and a rate', { discount_pct: 5, rate_per_room_night_inr: 2000 }],
  ])('%s together are refused', (_label, over) => {
    const v = validateQuoteRequest({ ...fx.request, ...over });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.problem.errors).toEqual([
        {
          path: 'discount_pct' in over ? 'discount_pct' : 'discount_inr',
          code: 'INCONSISTENT',
          message: 'Give one price: a % discount, a ₹ discount or a rate',
        },
      ]);
    }
  });
});

describe('the organiser contact and the note for the owner', () => {
  it('are accepted, and are not part of the commercial terms', () => {
    const plain = validateQuoteRequest(fx.request);
    const full = validateQuoteRequest({
      ...fx.request,
      organiser: {
        name: 'Fictional Events Pvt Ltd',
        contact_name: 'Priya Rao',
        email: 'priya@fictional.example',
        phone: '+91 98765 43210',
      },
      note_for_owner: 'Repeat client; they book every quarter.',
    });
    expect(plain.ok && full.ok).toBe(true);
    if (plain.ok && full.ok) {
      const e = evaluate(full.value, ctx()).evaluation;
      expect(commercialTerms(full.value, e)).toBe(commercialTerms(plain.value, e));
    }
  });

  it('a ₹ discount is part of the terms; without one the terms text is unchanged', () => {
    const v = validateQuoteRequest({
      ...fx.request,
      rate_per_room_night_inr: undefined,
      discount_inr: 100,
    });
    const plain = validateQuoteRequest(fx.request);
    if (!v.ok || !plain.ok) throw new Error('invalid');
    expect(commercialTerms(v.value, evaluate(v.value, ctx()).evaluation)).toContain(
      '"discount_inr":100',
    );
    expect(commercialTerms(plain.value, evaluate(plain.value, ctx()).evaluation)).not.toContain(
      'discount_inr',
    );
  });

  it.each([
    ['an email that is not one', { email: 'priya-at-example' }, 'organiser.email'],
    ['a phone with letters', { phone: 'call me' }, 'organiser.phone'],
  ])('refuses %s', (_label, contact, path) => {
    const v = validateQuoteRequest({
      ...fx.request,
      organiser: { name: 'Fictional Events Pvt Ltd', ...contact },
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.problem.errors?.map((i) => i.path)).toEqual([path]);
  });
});
