import type { Policy } from '../contract/policy.js';
import { assertInt, ceilDiv } from './money.js';

/** The policy fields the floor depends on. */
export type FloorPolicy = Pick<Policy, 'contribution_floor_inr' | 'total_rooms_units'>;

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
 * The floor expressed as contribution for a package: floor rate x room-nights - variable cost.
 * A package passes when its contribution reaches it, which with a flat rate and no inclusions is
 * exactly "rate >= floor rate"; a bundled inclusion's cost must also be covered. Null when the
 * variable cost is unknown (never treated as 0).
 */
export function floorFor(
  policy: FloorPolicy,
  roomNights: number,
  variableCostInr: number | null,
): number | null {
  assertInt('roomNights', roomNights);
  if (variableCostInr === null) return null;
  return floorRate(policy) * roomNights - variableCostInr;
}

/** BR-06: the floor passes when contribution is at least the floor (equal passes). */
export function floorPasses(contributionInr: number, floorInr: number): boolean {
  return contributionInr >= floorInr;
}
