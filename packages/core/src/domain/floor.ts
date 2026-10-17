import type { Policy } from '../contract/policy.js';
import { assertInt } from './money.js';

/** The policy fields the floor depends on. */
export type FloorPolicy = Pick<
  Policy,
  'floor_mode' | 'contribution_floor_inr' | 'floor_per_room_night_inr'
>;

/**
 * Contribution floor in INR for a package of `roomNights` (decision G1, D-001).
 * - absolute: the package floor, whatever the volume.
 * - per_room_night: floor per room-night times room-nights, so it scales with volume.
 */
export function floorFor(policy: FloorPolicy, roomNights: number): number {
  assertInt('roomNights', roomNights);
  if (policy.floor_mode === 'absolute') return policy.contribution_floor_inr;
  if (policy.floor_per_room_night_inr === null) {
    throw new RangeError('floor_per_room_night_inr is required in per_room_night mode');
  }
  return policy.floor_per_room_night_inr * roomNights;
}

/** BR-06: the floor passes when contribution is at least the floor (equal passes). */
export function floorPasses(contributionInr: number, floorInr: number): boolean {
  return contributionInr >= floorInr;
}
