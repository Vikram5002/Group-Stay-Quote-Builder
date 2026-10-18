import { describe, expect, it } from 'vitest';
import {
  Evaluation,
  evaluate,
  flatNights,
  mapC32Fixture,
  stayNights,
  validateQuoteRequest,
  type EvaluationContext,
  type InventoryNight,
  type RatePlanNight,
} from '../src/index.js';
import { readJson } from './helpers.js';

/**
 * Multi-line quotes (D-058): the owner's example, 5 rooms for 3 nights plus 3 rooms for 4
 * nights, both from 1 Nov. Nights 1 to 3 need 8 rooms, night 4 needs 3.
 */
const fx = mapC32Fixture(readJson('data/fixtures/fixture.json'));
const DATES = stayNights('2026-11-01', 10);

const inventory = (free: Record<string, number | null> = {}): InventoryNight[] =>
  DATES.map((date) => {
    const n = date in free ? (free[date] ?? null) : 10;
    return {
      date,
      room_type: 'standard',
      total_units: n,
      available_units: n,
      held_units: 0,
      confirmed_units: 0,
    };
  });
const ratePlan: RatePlanNight[] = flatNights('2026-11-01', 10, 2000, 800).map((n) => ({
  date: n.date,
  room_type: 'standard',
  rate_per_room_night_inr: n.rate_inr,
  variable_cost_per_room_night_inr: n.variable_cost_inr,
  rack_rate_inr: null,
}));
const ctx = (over: Partial<EvaluationContext> = {}): EvaluationContext => ({
  inventory: inventory(),
  ratePlan,
  policy: fx.policy,
  nowMs: Date.parse('2026-10-17T10:00:00+05:30'),
  ...over,
});

const request = (over: object = {}) => ({
  organiser: { name: 'Wedding party' },
  room_type: 'standard',
  stay: { check_in: '2026-11-01', nights: 3 },
  rooms: 5,
  additional_lines: [{ stay: { check_in: '2026-11-01', nights: 4 }, rooms: 3 }],
  ...over,
});

function run(over: object = {}, context = ctx()) {
  const v = validateQuoteRequest(request(over));
  if (!v.ok) throw new Error(JSON.stringify(v.problem.errors));
  const { evaluation } = evaluate(v.value, context);
  expect(Evaluation.safeParse(evaluation).success).toBe(true);
  return evaluation;
}

describe('5 rooms x 3 nights + 3 rooms x 4 nights in one quote', () => {
  const e = run();

  it('is one OFFER for 8 rooms, nights 1 Nov to 5 Nov', () => {
    expect(e).toMatchObject({
      decision: 'OFFER',
      reasons: [],
      check_in: '2026-11-01',
      check_out: '2026-11-05',
      nights: 4,
      requested_rooms: 8,
      offered_rooms: 8,
      auto_confirm_allowed: true,
    });
    expect(e.lines).toEqual([
      { check_in: '2026-11-01', check_out: '2026-11-04', nights: 3, rooms: 5 },
      { check_in: '2026-11-01', check_out: '2026-11-05', nights: 4, rooms: 3 },
    ]);
  });

  it('prices each line on its own nights: 15 + 12 = 27 room-nights', () => {
    expect(e.totals).toMatchObject({
      room_nights: 27,
      room_revenue_inr: 54000, // 27 x 2000
      variable_cost_inr: 21600, // 27 x 800
      contribution_inr: 32400,
      list_revenue_inr: 54000,
      contribution_floor_inr: 27000, // 27 x 1800 - 21600
      floor_headroom_inr: 5400,
      min_rate_per_room_night_inr: 1800,
    });
  });

  it('explains the rooms needed per night and each line', () => {
    expect(e.trail).toContain('2026-11-01: 8 rooms needed, 10 free');
    expect(e.trail).toContain('2026-11-04: 3 rooms needed, 10 free');
    expect(e.trail).toContain(
      'line 1: 5 rooms x 3 nights from 2026-11-01 = 15 room-nights, room revenue 30000, variable cost 12000',
    );
    expect(e.trail).toContain(
      'line 2: 3 rooms x 4 nights from 2026-11-01 = 12 room-nights, room revenue 24000, variable cost 9600',
    );
  });
});

describe('multi-line rules', () => {
  it('a shortage on any night declines the whole quote (held together or not at all)', () => {
    const e = run({}, ctx({ inventory: inventory({ '2026-11-02': 7 }) }));
    expect(e).toMatchObject({ decision: 'DECLINE', reasons: ['NO_CAPACITY'], offered_rooms: 0 });
    expect(e.trail).toContain('2026-11-02: 8 rooms needed, 7 free');
    expect(e.trail).toContain(
      'not enough rooms on 2026-11-02: the lines are held together or not at all',
    );
  });

  it('enough rooms on a night only one line needs is fine', () => {
    expect(run({}, ctx({ inventory: inventory({ '2026-11-04': 3 }) })).decision).toBe('OFFER');
  });

  it('lines need not overlap; nights in between are not needed', () => {
    const e = run(
      { additional_lines: [{ stay: { check_in: '2026-11-07', nights: 2 }, rooms: 4 }] },
      ctx({ inventory: inventory({ '2026-11-05': 0 }) }),
    );
    expect(e).toMatchObject({ decision: 'OFFER', check_out: '2026-11-09', nights: 8 });
    expect(e.totals.room_nights).toBe(15 + 8);
  });

  it('the Sales discount applies to every line; over the limit goes to the owner', () => {
    expect(run({ discount_pct: 10 }).decision).toBe('OFFER');
    const e = run({ discount_pct: 11 });
    expect(e).toMatchObject({ decision: 'REVIEW', reasons: ['FLOOR_BREACH'] });
    expect(e.counter_offers[0]).toMatchObject({
      type: 'RAISE_RATE',
      rate_per_room_night_inr: 1800,
    });
  });

  it('unknown availability on a needed night is REVIEW, never assumed', () => {
    const e = run({}, ctx({ inventory: inventory({ '2026-11-03': null }) }));
    expect(e).toMatchObject({ decision: 'REVIEW', reasons: ['UNKNOWN_AVAILABILITY'] });
  });

  it('a night with no inventory row declines', () => {
    const inv = inventory().filter((n) => n.date !== '2026-11-04');
    expect(run({}, ctx({ inventory: inv }))).toMatchObject({
      decision: 'DECLINE',
      reasons: ['NO_INVENTORY_DATA'],
    });
  });

  it('breakfast is priced per line', () => {
    const e = run({
      inclusions: [
        { name: 'Breakfast', basis: 'per_guest_night', unit_cost_inr: 150, included_in_rate: true },
      ],
    });
    // (5 x 2 x 3 + 3 x 2 x 4) guest-nights x 150 = (30 + 24) x 150 = 8100
    expect(e.totals.inclusions_cost_inr).toBe(8100);
  });

  it('all lines together must fit within 28 nights', () => {
    const v = validateQuoteRequest(
      request({ additional_lines: [{ stay: { check_in: '2026-11-27', nights: 3 }, rooms: 1 }] }),
    );
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.problem.errors?.[0]).toMatchObject({ path: 'additional_lines' });
  });

  it('a single-line quote reports its one line too', () => {
    const v = validateQuoteRequest(request({ additional_lines: undefined }));
    if (!v.ok) throw new Error('invalid');
    expect(evaluate(v.value, ctx()).evaluation.lines).toEqual([
      { check_in: '2026-11-01', check_out: '2026-11-04', nights: 3, rooms: 5 },
    ]);
  });
});
