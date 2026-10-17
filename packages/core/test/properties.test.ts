import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { flatNights, price } from '../src/index.js';
import {
  CHECK_IN,
  floorPolicy,
  knownExtras,
  knownNights,
  nightCount,
  rate,
  rooms,
} from './arbitraries.js';

/** Property-based invariants P1 to P6 (blueprint 14.3). */

const RUNS = { numRuns: 500 };

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
