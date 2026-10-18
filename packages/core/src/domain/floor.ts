import type { Policy } from '../contract/policy.js';
import { assertInt, ceilDiv } from './money.js';

/** The policy fields the floor depends on. */
export type FloorPolicy = Pick<
  Policy,
  'contribution_floor_inr' | 'total_rooms_units' | 'max_sales_discount_pct'
>;

/**
 * Floor rate (D-056): the minimum rate per room-night, package floor / total rooms, rounded up
 * so it never lands under the floor. It already includes the variable cost: a room sold at the
 * floor rate earns the floor rate minus its cost. Example: 20000 / 10 rooms = 2000.
 */
export function floorRate(policy: FloorPolicy): number {
  assertInt('contribution_floor_inr', policy.contribution_floor_inr);
  assertInt('total_rooms_units', policy.total_rooms_units, 1);
  return ceilDiv(policy.contribution_floor_inr, policy.total_rooms_units);
}

/**
 * Rate after a whole-percent discount off the floor rate (D-057), rounded up so a discount never
 * takes more than it says. Example: 5% off 2000 = 1900.
 */
export function discountedRate(policy: FloorPolicy, discountPct: number): number {
  assertInt('discount_pct', discountPct, 0, 100);
  return ceilDiv(floorRate(policy) * (100 - discountPct), 100);
}

/**
 * Rate after a discount in whole rupees off the floor rate, never below 0. Example: 200 off 2000
 * = 1800. The owner's limit is still a percentage, so 200 off 2000 is exactly the 10% limit.
 */
export function amountOffRate(policy: FloorPolicy, discountInr: number): number {
  assertInt('discount_inr', discountInr, 0);
  return Math.max(0, floorRate(policy) - discountInr);
}

/**
 * Lowest rate Sales may agree to without owner review: the floor rate less the owner's maximum
 * Sales discount. Example: 2000 less 10% = 1800.
 */
export function minimumRate(policy: FloorPolicy): number {
  assertInt('max_sales_discount_pct', policy.max_sales_discount_pct, 0, 100);
  return discountedRate(policy, policy.max_sales_discount_pct);
}

/**
 * The floor expressed as contribution for a package: minimum rate x room-nights - variable cost.
 * A package passes when its contribution reaches it, which with a flat rate and no inclusions is
 * exactly "rate >= minimum rate", that is "discount <= the Sales limit"; a bundled inclusion's
 * cost must also be covered. Null when the variable cost is unknown (never treated as 0).
 */
export function floorFor(
  policy: FloorPolicy,
  roomNights: number,
  variableCostInr: number | null,
): number | null {
  assertInt('roomNights', roomNights);
  if (variableCostInr === null) return null;
  return minimumRate(policy) * roomNights - variableCostInr;
}

/** BR-06: the floor passes when contribution is at least the floor (equal passes). */
export function floorPasses(contributionInr: number, floorInr: number): boolean {
  return contributionInr >= floorInr;
}
