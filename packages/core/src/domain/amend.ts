import type { QuoteTotals } from '../contract/quote.js';
import { floorPasses, type FloorPolicy } from './floor.js';
import { completeTotals } from './pricing.js';
import { counted } from './plural.js';

/**
 * Partial cancellation maths (blueprint 5.8, BR-16). Every money component of a package is
 * rooms x (a per-room amount over the stay), so the amended totals follow exactly from the
 * agreed ones: the booking keeps the prices it was sold at, it is not re-priced at today's rates.
 * The floor is then re-checked for the remaining rooms under the current floor policy.
 */

export interface AmendedTotals {
  totals: QuoteTotals;
  /** Null when contribution is unknown. */
  floor_ok: boolean | null;
  trail: string[];
}

function scale(value: number | null, from: number, to: number, name: string): number | null {
  if (value === null) return null;
  if (value % from !== 0)
    throw new RangeError(`${name} ${value} is not a multiple of ${from} rooms`);
  return (value / from) * to;
}

export function amendTotals(
  totals: QuoteTotals,
  fromRooms: number,
  toRooms: number,
  floorPolicy: FloorPolicy,
): AmendedTotals {
  if (!Number.isSafeInteger(fromRooms) || fromRooms < 1)
    throw new RangeError('fromRooms must be >= 1');
  if (!Number.isSafeInteger(toRooms) || toRooms < 1 || toRooms >= fromRooms) {
    throw new RangeError(`An amendment must reduce rooms below ${fromRooms} and keep at least 1`);
  }
  const nights = totals.room_nights / fromRooms;
  if (!Number.isInteger(nights)) throw new RangeError('room_nights is not a multiple of rooms');

  const next = completeTotals(
    {
      room_nights: toRooms * nights,
      room_revenue_inr: scale(totals.room_revenue_inr, fromRooms, toRooms, 'room_revenue_inr'),
      inclusions_revenue_inr: scale(
        totals.inclusions_revenue_inr,
        fromRooms,
        toRooms,
        'inclusions_revenue_inr',
      ),
      variable_cost_inr: scale(totals.variable_cost_inr, fromRooms, toRooms, 'variable_cost_inr'),
      inclusions_cost_inr: scale(
        totals.inclusions_cost_inr,
        fromRooms,
        toRooms,
        'inclusions_cost_inr',
      ),
    },
    floorPolicy,
  );
  const floorOk =
    next.contribution_inr === null || next.contribution_floor_inr === null
      ? null
      : floorPasses(next.contribution_inr, next.contribution_floor_inr);

  const released = (fromRooms - toRooms) * nights;
  const trail = [
    `amended ${fromRooms} to ${counted(toRooms, 'room')}: ${counted(released, 'room-night')} released`,
  ];
  if (floorOk === null) {
    trail.push('contribution unknown, so the floor cannot be checked');
  } else {
    const verdict = floorOk
      ? `>= ${next.contribution_floor_inr} floor, headroom ${next.floor_headroom_inr}`
      : `< ${next.contribution_floor_inr} floor, shortfall ${next.shortfall_inr}: owner review`;
    trail.push(`remaining contribution ${next.contribution_inr} ${verdict}`);
  }
  return { totals: next, floor_ok: floorOk, trail };
}
