import { z } from 'zod';
import { LIMITS, PropertyId, Units } from './primitives.js';

const hours = (min: number) => z.int().min(min).max(LIMITS.MAX_POLICY_HOURS);

function isIanaTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const PolicyFields = z.strictObject({
  property_id: PropertyId,
  timezone: z.string().refine(isIanaTimeZone, {
    message: 'Must be an IANA time zone, for example Asia/Kolkata',
    params: { code: 'INVALID_FORMAT' },
  }),
  /**
   * Package floor (D-056): divided by the hotel's total rooms it gives the floor rate, the
   * minimum rate per room-night. The floor rate already includes the variable cost.
   */
  contribution_floor_inr: z
    .int()
    .min(0)
    .max(LIMITS.MAX_UNIT_INR * 100),
  /** Rooms the hotel has (owner setting). Divides the package floor; sets each night's total. */
  total_rooms_units: z.int().min(1).max(LIMITS.MAX_ROOMS),
  validity_hours: hours(1),
  stay_cutoff_hours: hours(0),
  /** If the computed validity window is shorter than this, the quote is TOO_LATE_TO_QUOTE. */
  min_validity_hours: hours(0),
  min_partial_rooms_units: z.int().min(1).max(LIMITS.MAX_ROOMS),
  /** Default guests per room for per-guest inclusions. Null means unknown, never 1. */
  guests_per_room_units: z.int().min(1).max(LIMITS.MAX_GUESTS_PER_ROOM).nullable(),
  /** Optimistic-concurrency version. */
  version: Units,
});

type PolicyShape = z.infer<typeof PolicyFields>;

function checkPolicy(
  p: Pick<PolicyShape, 'min_validity_hours' | 'validity_hours'>,
  ctx: z.RefinementCtx,
) {
  if (p.min_validity_hours > p.validity_hours) {
    ctx.addIssue({
      code: 'custom',
      path: ['min_validity_hours'],
      message: 'min_validity_hours cannot exceed validity_hours',
      params: { code: 'INCONSISTENT' },
    });
  }
}

export const Policy = PolicyFields.superRefine(checkPolicy);
export type Policy = z.infer<typeof Policy>;

/** PUT /v1/policy body. `version` is the version the client last read (optimistic check). */
export const PolicyUpdateRequest = PolicyFields.omit({ property_id: true }).superRefine(
  checkPolicy,
);
export type PolicyUpdateRequest = z.infer<typeof PolicyUpdateRequest>;

/**
 * Defaults, from the assumption register (blueprint appendix A). HYPOTHESIS values are tuned
 * in the pilot. Floor and rooms match the fixture: 20000 over 10 rooms is a floor rate of 2000.
 */
export const DEFAULT_POLICY: Readonly<Policy> = Object.freeze({
  property_id: 'p1',
  timezone: 'Asia/Kolkata', // A8
  contribution_floor_inr: 20000, // fixture; / 10 rooms = 2000 per room-night (D-056)
  total_rooms_units: 10, // fixture inventory
  validity_hours: 72, // A2 (HYPOTHESIS)
  stay_cutoff_hours: 24, // A3 (HYPOTHESIS)
  min_validity_hours: 2, // A13 (HYPOTHESIS)
  min_partial_rooms_units: 1, // A10
  guests_per_room_units: 2, // A5 (illustrative)
  version: 0,
});
