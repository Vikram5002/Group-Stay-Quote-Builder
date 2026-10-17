import { z } from 'zod';
import { IsoDate, RoomType, UnitInr, Units } from './primitives.js';

/**
 * Sellable rooms for one room type and night: a ledger, not a number (blueprint 1.1, 8.2).
 *
 * Invariant (BR-15): total = available + held + confirmed, available >= 0.
 * Unknown availability: total_units and available_units are both null. No hold can be taken.
 */
export const InventoryNight = z
  .strictObject({
    date: IsoDate,
    room_type: RoomType,
    total_units: Units.nullable(),
    available_units: Units.nullable(),
    held_units: Units,
    confirmed_units: Units,
  })
  .superRefine((n, ctx) => {
    if ((n.total_units === null) !== (n.available_units === null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['available_units'],
        message: 'total_units and available_units must both be known or both be null',
        params: { code: 'INCONSISTENT' },
      });
      return;
    }
    if (
      n.total_units !== null &&
      n.available_units !== null &&
      n.total_units !== n.available_units + n.held_units + n.confirmed_units
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['total_units'],
        message: 'total_units must equal available_units + held_units + confirmed_units',
        params: { code: 'INCONSISTENT' },
      });
    }
  });
export type InventoryNight = z.infer<typeof InventoryNight>;

/** Price and variable cost for one night and room type. Null cost means unknown, never zero. */
export const RatePlanNight = z.strictObject({
  date: IsoDate,
  room_type: RoomType,
  rate_per_room_night_inr: UnitInr.nullable(),
  variable_cost_per_room_night_inr: UnitInr.nullable(),
  /** Optional, for discount display only. The floor check never depends on it (G6). */
  rack_rate_inr: UnitInr.nullable(),
});
export type RatePlanNight = z.infer<typeof RatePlanNight>;

export const AvailabilityResponse = z.strictObject({
  room_type: RoomType,
  from: IsoDate,
  to: IsoDate,
  nights: z.array(InventoryNight),
});
export type AvailabilityResponse = z.infer<typeof AvailabilityResponse>;
