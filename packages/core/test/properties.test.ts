import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  evaluate,
  flatNights,
  price,
  stayNights,
  validateQuoteRequest,
  type EvaluationContext,
  type QuoteRequest,
} from '../src/index.js';
import {
  CHECK_IN,
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
          expect(t.floor_headroom_inr).toBe(t.contribution_inr! - t.contribution_floor_inr);
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
      floor: { floor_mode: 'absolute', contribution_floor_inr: 0, floor_per_room_night_inr: null },
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
            floor_mode: 'absolute' as const,
            contribution_floor_inr: 0,
            floor_per_room_night_inr: null,
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
