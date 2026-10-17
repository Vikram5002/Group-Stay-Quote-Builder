import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  amend,
  cancel,
  checkLedger,
  confirm,
  createLedger,
  evaluate,
  flatNights,
  hold,
  nightKey,
  price,
  release,
  stayNights,
  validateQuoteRequest,
  type EvaluationContext,
  type QuoteRequest,
} from '../src/index.js';
import {
  CHECK_IN,
  anyExtras,
  anyNights,
  cost,
  floorPolicy,
  knownExtras,
  knownNights,
  nightCount,
  policy,
  positiveRooms,
  rate,
  rooms,
  stock,
} from './arbitraries.js';

/** Property-based invariants P1 to P6 (blueprint 14.3). */

const RUNS = { numRuns: 500 };
const ISSUED = Date.parse('2026-10-17T10:00:00+05:30');

describe('P1 contribution = revenue - all costs, never NaN or fractional', () => {
  it('holds for every valid known input', () => {
    fc.assert(
      fc.property(
        rooms,
        nightCount.chain((n) => knownNights(n)),
        floorPolicy,
        knownExtras,
        (r, nights, floor, extras) => {
          const t = price({ rooms: r, nights, floor, extras }).totals;
          const revenue = t.room_revenue_inr! + t.inclusions_revenue_inr!;
          const costs = t.variable_cost_inr! + t.inclusions_cost_inr!;
          expect(t.contribution_inr).toBe(revenue - costs);
          for (const v of [
            t.room_revenue_inr,
            t.variable_cost_inr,
            t.contribution_inr,
            t.floor_headroom_inr,
            t.shortfall_inr,
            t.contribution_floor_inr,
          ]) {
            expect(Number.isSafeInteger(v)).toBe(true);
          }
          expect(t.floor_headroom_inr).toBe(t.contribution_inr! - t.contribution_floor_inr!);
          expect(t.shortfall_inr).toBe(Math.max(0, -t.floor_headroom_inr!));
        },
      ),
      RUNS,
    );
  });
});

describe('P2 revenue is non-decreasing in rate, rooms and nights', () => {
  const revenue = (r: number, n: number, perNight: number) =>
    price({
      rooms: r,
      nights: flatNights(CHECK_IN, n, perNight, 0),
      floor: { contribution_floor_inr: 0, total_rooms_units: 1 },
    }).totals.room_revenue_inr!;

  it('raising the rate never lowers revenue', () => {
    fc.assert(
      fc.property(rooms, nightCount, rate, fc.integer({ min: 0, max: 1000 }), (r, n, x, d) => {
        expect(revenue(r, n, x + d)).toBeGreaterThanOrEqual(revenue(r, n, x));
      }),
      RUNS,
    );
  });

  it('adding rooms never lowers revenue', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 499 }), nightCount, rate, (r, n, x) => {
        expect(revenue(r + 1, n, x)).toBeGreaterThanOrEqual(revenue(r, n, x));
      }),
      RUNS,
    );
  });

  it('adding a night never lowers revenue', () => {
    fc.assert(
      fc.property(rooms, fc.integer({ min: 1, max: 27 }), rate, (r, n, x) => {
        expect(revenue(r, n + 1, x)).toBeGreaterThanOrEqual(revenue(r, n, x));
      }),
      RUNS,
    );
  });

  it('also holds for per-night rates: raising any one night never lowers revenue', () => {
    fc.assert(
      fc.property(
        rooms,
        nightCount.chain((n) =>
          fc.tuple(knownNights(n), fc.nat(n - 1), fc.integer({ min: 0, max: 1000 })),
        ),
        (r, [nights, i, d]) => {
          const floor = {
            contribution_floor_inr: 0,
            total_rooms_units: 1,
          };
          const before = price({ rooms: r, nights, floor }).totals.room_revenue_inr!;
          const bumped = nights.map((x, j) => (j === i ? { ...x, rate_inr: x.rate_inr! + d } : x));
          expect(
            price({ rooms: r, nights: bumped, floor }).totals.room_revenue_inr!,
          ).toBeGreaterThanOrEqual(before);
        },
      ),
      RUNS,
    );
  });
});

const runEvaluate = (
  request: Omit<QuoteRequest, 'organiser' | 'room_type' | 'stay'> & { nights: number },
  context: Omit<EvaluationContext, 'nowMs'>,
) => {
  const v = validateQuoteRequest({
    organiser: { name: 'Property test' },
    room_type: 'standard',
    stay: { check_in: CHECK_IN, nights: request.nights },
    rooms: request.rooms,
    ...(request.rate_per_room_night_inr === undefined
      ? {}
      : { rate_per_room_night_inr: request.rate_per_room_night_inr }),
  });
  if (!v.ok) throw new Error(JSON.stringify(v.problem.errors));
  return evaluate(v.value, { ...context, nowMs: ISSUED }).evaluation;
};

describe('P3 offered rooms never exceed the smaller of requested and sellable', () => {
  it('holds on random inventory, rates and policies', () => {
    fc.assert(
      fc.property(
        positiveRooms,
        fc.integer({ min: 1, max: 7 }).chain((n) => fc.tuple(fc.constant(n), stock(n))),
        policy,
        (requested, [n, { inventory, ratePlan }], pol) => {
          const e = runEvaluate(
            { rooms: requested, nights: n },
            { inventory, ratePlan, policy: pol },
          );
          const dates = stayNights(CHECK_IN, n);
          const known = dates.map((d) => inventory.find((x) => x.date === d)?.available_units);
          const allKnown = known.every((a) => typeof a === 'number');
          const sellable = allKnown ? Math.min(...(known as number[])) : null;

          expect(e.offered_rooms).toBeLessThanOrEqual(requested);
          if (sellable !== null) expect(e.offered_rooms).toBeLessThanOrEqual(sellable);
          expect(e.offered_rooms + e.shortfall_rooms).toBe(requested);
          if (e.decision === 'DECLINE') expect(e.offered_rooms).toBe(0);
          if (e.decision === 'OFFER') expect(e.offered_rooms).toBe(requested);
          if (e.decision === 'PARTIAL_OFFER') expect(e.offered_rooms).toBeLessThan(requested);
          // Counter-offers must fit inventory too.
          for (const o of e.counter_offers) {
            if (o.rooms !== undefined && sellable !== null)
              expect(o.rooms).toBeLessThanOrEqual(sellable);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('P4 the floor passes at the minimum safe rate and fails one rupee below', () => {
  it('holds whenever there are room-nights and the minimum rate is positive', () => {
    fc.assert(
      fc.property(
        positiveRooms,
        nightCount,
        cost,
        floorPolicy,
        knownExtras,
        (r, n, c, floor, extras) => {
          const at = (x: number) =>
            price({ rooms: r, nights: flatNights(CHECK_IN, n, x, c), floor, extras });
          const min = at(0).totals.min_rate_per_room_night_inr;
          expect(min).not.toBeNull();
          expect(at(min!).floor_ok).toBe(true);
          if (min! > 0) expect(at(min! - 1).floor_ok).toBe(false);
          else expect(at(0).floor_ok).toBe(true); // costs alone already clear the floor
        },
      ),
      RUNS,
    );
  });

  it('is unknown, not invented, when there are no room-nights', () => {
    fc.assert(
      fc.property(nightCount, cost, floorPolicy, (n, c, floor) => {
        const t = price({ rooms: 0, nights: flatNights(CHECK_IN, n, 1000, c), floor }).totals;
        expect(t.min_rate_per_room_night_inr).toBeNull();
      }),
    );
  });
});

describe('P6 a null input never turns into a number', () => {
  it('pricing: any unknown rate, cost or extra makes contribution null', () => {
    fc.assert(
      fc.property(
        positiveRooms,
        nightCount.chain((n) => anyNights(n)),
        floorPolicy,
        anyExtras,
        (r, nights, floor, extras) => {
          const t = price({ rooms: r, nights, floor, extras }).totals;
          const anyUnknown =
            nights.some((x) => x.rate_inr === null || x.variable_cost_inr === null) ||
            extras.revenue_inr === null ||
            extras.cost_inr === null;
          if (anyUnknown) {
            expect(t.contribution_inr).toBeNull();
            expect(t.contribution_margin_pct).toBeNull();
            expect(t.floor_headroom_inr).toBeNull();
            expect(t.shortfall_inr).toBeNull();
          } else {
            expect(t.contribution_inr).not.toBeNull();
          }
          if (nights.some((x) => x.rate_inr === null)) expect(t.room_revenue_inr).toBeNull();
          if (nights.some((x) => x.variable_cost_inr === null)) {
            expect(t.variable_cost_inr).toBeNull();
            expect(t.contribution_floor_inr).toBeNull(); // the floor needs the cost; the floor rate does not
          }
        },
      ),
      RUNS,
    );
  });

  it('decisions: an unknown cost, rate or availability is never an OFFER or auto-confirmed', () => {
    fc.assert(
      fc.property(
        positiveRooms,
        fc
          .integer({ min: 1, max: 5 })
          .chain((n) => fc.tuple(fc.constant(n), stock(n), anyNights(n))),
        policy,
        (requested, [n, { inventory }, nights], pol) => {
          const ratePlan = nights.map((x) => ({
            date: x.date,
            room_type: 'standard',
            rate_per_room_night_inr: x.rate_inr,
            variable_cost_per_room_night_inr: x.variable_cost_inr,
            rack_rate_inr: null,
          }));
          const e = runEvaluate(
            { rooms: requested, nights: n },
            { inventory, ratePlan, policy: pol },
          );
          const priceUnknown = nights.some(
            (x) => x.rate_inr === null || x.variable_cost_inr === null,
          );
          const availUnknown = inventory.some((x) => x.available_units === null);
          if (e.decision === 'DECLINE') return; // nothing offered, nothing to price
          if (priceUnknown || availUnknown) {
            expect(e.decision).toBe('REVIEW');
            expect(e.auto_confirm_allowed).toBe(false);
            expect(e.counter_offers).toEqual([]);
          }
          if (priceUnknown) expect(e.totals.contribution_inr).toBeNull();
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('P5 the ledger invariant survives any sequence of moves (BR-13 to BR-15)', () => {
  const DATES = stayNights(CHECK_IN, 5);
  const op = fc.record({
    kind: fc.constantFrom('hold', 'release', 'confirm', 'amend', 'cancel'),
    quote: fc.constantFrom('Q1', 'Q2', 'Q3', 'Q4'),
    units: fc.integer({ min: 0, max: 12 }),
    from: fc.nat(4),
    length: fc.integer({ min: 1, max: 5 }),
  });

  it('total = available + held + confirmed and available >= 0 on every night, after every step', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 15 }), { minLength: 5, maxLength: 5 }),
        fc.array(op, { maxLength: 60 }),
        (totals, ops) => {
          let state = createLedger(
            DATES.map((date, i) => ({
              date,
              room_type: 'standard',
              total_units: totals[i]!,
              available_units: totals[i]!,
              held_units: 0,
              confirmed_units: 0,
            })),
          );
          for (const o of ops) {
            const dates = DATES.slice(o.from, o.from + o.length);
            const r =
              o.kind === 'hold'
                ? hold(state, o.quote, 'standard', dates, o.units)
                : o.kind === 'release'
                  ? release(state, o.quote)
                  : o.kind === 'confirm'
                    ? confirm(state, o.quote)
                    : o.kind === 'amend'
                      ? amend(state, o.quote, o.units)
                      : cancel(state, o.quote);
            if (r.ok) state = r.state; // a refused move changes nothing
            expect(checkLedger(state)).toEqual([]);
            for (const [i, date] of DATES.entries()) {
              const n = state.nights.get(nightKey('standard', date))!;
              expect(n.available_units).toBeGreaterThanOrEqual(0);
              expect(n.total_units).toBe(totals[i]);
            }
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
