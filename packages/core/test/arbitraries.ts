import fc from 'fast-check';
import {
  DEFAULT_POLICY,
  stayNights,
  type FloorPolicy,
  type InventoryNight,
  type NightPrice,
  type Policy,
  type PricingExtras,
  type RatePlanNight,
} from '../src/index.js';

/** Random generators for property tests. Values stay inside the contract's limits. */

const CHECK_IN = '2026-11-01';

export const rate = fc.integer({ min: 0, max: 20_000 });
export const cost = fc.integer({ min: 0, max: 10_000 });
export const rooms = fc.integer({ min: 0, max: 500 });
export const positiveRooms = fc.integer({ min: 1, max: 500 });
export const nightCount = fc.integer({ min: 1, max: 28 });

/** A value that is sometimes unknown. */
export const maybe = <T>(arb: fc.Arbitrary<T>) => fc.option(arb, { nil: null, freq: 4 });

export const floorPolicy: fc.Arbitrary<FloorPolicy> = fc.record({
  contribution_floor_inr: fc.integer({ min: 0, max: 200_000 }),
  total_rooms_units: fc.integer({ min: 1, max: 200 }),
});

export const policy: fc.Arbitrary<Policy> = fc
  .tuple(floorPolicy, fc.integer({ min: 1, max: 20 }))
  .map(([floor, minPartial]) => ({
    ...DEFAULT_POLICY,
    ...floor,
    min_partial_rooms_units: minPartial,
  }));

/** Nightly prices for `n` nights, all known. */
export const knownNights = (n: number): fc.Arbitrary<NightPrice[]> =>
  fc.array(fc.tuple(rate, cost), { minLength: n, maxLength: n }).map((pairs) =>
    stayNights(CHECK_IN, n).map((date, i) => ({
      date,
      rate_inr: pairs[i]![0],
      variable_cost_inr: pairs[i]![1],
    })),
  );

/** Nightly prices where any rate or cost may be unknown. */
export const anyNights = (n: number): fc.Arbitrary<NightPrice[]> =>
  fc.array(fc.tuple(maybe(rate), maybe(cost)), { minLength: n, maxLength: n }).map((pairs) =>
    stayNights(CHECK_IN, n).map((date, i) => ({
      date,
      rate_inr: pairs[i]![0],
      variable_cost_inr: pairs[i]![1],
    })),
  );

export const knownExtras: fc.Arbitrary<PricingExtras> = fc.record({
  revenue_inr: fc.integer({ min: 0, max: 100_000 }),
  cost_inr: fc.integer({ min: 0, max: 100_000 }),
});

export const anyExtras: fc.Arbitrary<PricingExtras> = fc.record({
  revenue_inr: maybe(fc.integer({ min: 0, max: 100_000 })),
  cost_inr: maybe(fc.integer({ min: 0, max: 100_000 })),
});

/** Inventory and a matching rate plan for `n` nights; availability may be unknown or missing. */
export const stock = (n: number) =>
  fc
    .array(
      fc.oneof(
        { weight: 6, arbitrary: fc.integer({ min: 0, max: 60 }) },
        { weight: 1, arbitrary: fc.constant(null) },
        { weight: 1, arbitrary: fc.constant('missing' as const) },
      ),
      { minLength: n, maxLength: n },
    )
    .chain((avail) =>
      knownNights(n).map((prices) => {
        const dates = stayNights(CHECK_IN, n);
        const inventory: InventoryNight[] = [];
        dates.forEach((date, i) => {
          const a = avail[i]!;
          if (a === 'missing') return;
          inventory.push({
            date,
            room_type: 'standard',
            total_units: a,
            available_units: a,
            held_units: 0,
            confirmed_units: 0,
          });
        });
        const ratePlan: RatePlanNight[] = prices.map((p) => ({
          date: p.date,
          room_type: 'standard',
          rate_per_room_night_inr: p.rate_inr,
          variable_cost_per_room_night_inr: p.variable_cost_inr,
          rack_rate_inr: null,
        }));
        return { inventory, ratePlan };
      }),
    );

export { CHECK_IN };
