import type { InclusionInput } from '../contract/quote.js';
import { assertInt } from './money.js';
import type { PricingExtras } from './pricing.js';

/**
 * Inclusions such as breakfast (blueprint 5.6, FR-13, G4).
 *
 *   per_guest_night : units = rooms x guests_per_room x nights
 *   per_room_night  : units = rooms x nights
 *   cost            = unit_cost_inr x units                 (always paid by the hotel)
 *   revenue         = price_inr x units                     (only when charged separately:
 *                                                            included_in_rate false, price set)
 *
 * A null unit cost, or unknown guests per room for a per-guest inclusion, makes the cost unknown
 * (UNKNOWN_COST). It is never read as 0 or as one guest.
 */

export interface InclusionLine {
  name: string;
  units: number | null;
  cost_inr: number | null;
  revenue_inr: number;
  /** Human-readable arithmetic for the trail. */
  explain: string;
}

export interface InclusionExtras extends PricingExtras {
  lines: InclusionLine[];
}

function unitsFor(
  inc: InclusionInput,
  rooms: number,
  nights: number,
  guestsPerRoom: number | null,
): { units: number | null; basis: string } {
  if (inc.basis === 'per_room_night') {
    return { units: rooms * nights, basis: `${rooms} rooms x ${nights} nights` };
  }
  if (guestsPerRoom === null) return { units: null, basis: 'guests per room unknown' };
  return {
    units: rooms * guestsPerRoom * nights,
    basis: `${rooms} rooms x ${guestsPerRoom} guests x ${nights} nights`,
  };
}

function lineFor(
  inc: InclusionInput,
  rooms: number,
  nights: number,
  guestsPerRoom: number | null,
): InclusionLine {
  const { units, basis } = unitsFor(inc, rooms, nights, guestsPerRoom);
  const charged = !inc.included_in_rate && inc.price_inr !== undefined;
  const cost = units === null || inc.unit_cost_inr === null ? null : units * inc.unit_cost_inr;
  // Revenue needs only the units; if units are unknown the whole line is unknown via cost.
  const revenue = charged && units !== null ? units * (inc.price_inr as number) : 0;

  const unitWord = inc.basis === 'per_guest_night' ? 'guest-nights' : 'room-nights';
  let explain: string;
  if (units === null) {
    explain = `${inc.name}: ${basis}, cost unknown`;
  } else if (cost === null) {
    explain = `${inc.name}: ${basis} = ${units} ${unitWord}, unit cost unknown`;
  } else {
    explain = `${inc.name}: ${basis} = ${units} ${unitWord} x ${inc.unit_cost_inr} = ${cost} cost`;
    explain += charged
      ? `, charged separately ${units} x ${inc.price_inr} = ${revenue} revenue`
      : ', included in the rate';
  }
  return { name: inc.name, units, cost_inr: cost, revenue_inr: revenue, explain };
}

/** Total package extras from a quote's inclusions, priced for the offered rooms. */
export function inclusionExtras(
  inclusions: readonly InclusionInput[],
  rooms: number,
  nights: number,
  guestsPerRoom: number | null,
): InclusionExtras {
  assertInt('rooms', rooms);
  assertInt('nights', nights);
  if (guestsPerRoom !== null) assertInt('guestsPerRoom', guestsPerRoom, 1);

  const lines = inclusions.map((inc) => lineFor(inc, rooms, nights, guestsPerRoom));
  const anyUnknown = lines.some((l) => l.cost_inr === null);
  return {
    lines,
    cost_inr: anyUnknown ? null : lines.reduce((sum, l) => sum + (l.cost_inr as number), 0),
    revenue_inr: anyUnknown ? null : lines.reduce((sum, l) => sum + l.revenue_inr, 0),
  };
}
