import type { RatePlanNight } from '../contract/inventory.js';
import type { QuoteTotals } from '../contract/quote.js';
import { LIMITS } from '../contract/primitives.js';
import { stayNights } from './calendar.js';
import { floorFor, floorPasses, type FloorPolicy } from './floor.js';
import { assertInt, ceilDiv, percentOneDecimal, sumKnown } from './money.js';

/**
 * Pricing engine (blueprint 5.5, BR-01, BR-06, BR-07, BR-20). Pure and integer-only.
 *
 *   room_nights        = rooms x nights
 *   room_revenue_inr   = sum over nights of rooms x rate
 *   variable_cost_inr  = sum over nights of rooms x variable cost
 *   contribution_inr   = room revenue + extras revenue - variable cost - extras cost
 *   floor_ok           = contribution >= floor            (equal passes)
 *   shortfall_inr      = max(0, floor - contribution)
 *   headroom_inr       = contribution - floor             (can be negative)
 *   min_rate_inr       = ceil((floor + variable cost + extras cost - extras revenue) / room_nights)
 *
 * Any unknown (null) input makes every value that depends on it null. Unknown is never zero.
 */

/** Price and variable cost for one night of the stay. Null means unknown. */
export interface NightPrice {
  date: string;
  rate_inr: number | null;
  variable_cost_inr: number | null;
}

/**
 * Package-level extras on top of rooms. Inclusions (breakfast) are costed into this by T1.05.
 * Revenue is what the organiser pays separately; cost is what the hotel spends.
 */
export interface PricingExtras {
  revenue_inr: number | null;
  cost_inr: number | null;
  /** Optional per-item arithmetic shown in the trail, for example one line per inclusion. */
  detail?: readonly string[];
}

export interface PricingInput {
  /** Rooms being priced (the offered rooms, which may be fewer than requested). */
  rooms: number;
  /** One entry per night of the stay, in date order. */
  nights: readonly NightPrice[];
  floor: FloorPolicy;
  extras?: PricingExtras;
}

export interface PricingResult {
  totals: QuoteTotals;
  /** True or false when contribution is known; null when it is unknown. */
  floor_ok: boolean | null;
  /** Human-readable arithmetic, for example "20 x 2000 = 40000". */
  trail: string[];
}

export const NO_EXTRAS: Readonly<PricingExtras> = Object.freeze({ revenue_inr: 0, cost_inr: 0 });

/** Flat rate and cost on every night of a stay (the fixture case, and the test oracle). */
export function flatNights(
  checkIn: string,
  nights: number,
  rateInr: number | null,
  variableCostInr: number | null,
): NightPrice[] {
  return stayNights(checkIn, nights).map((date) => ({
    date,
    rate_inr: rateInr,
    variable_cost_inr: variableCostInr,
  }));
}

/**
 * Per-night prices from the rate plan for one room type (BR-08). A missing plan row leaves that
 * night's rate and cost unknown. An explicit override rate replaces the plan rate on every night;
 * cost always comes from the plan.
 */
export function nightsFromRatePlan(
  checkIn: string,
  nights: number,
  roomType: string,
  plan: readonly RatePlanNight[],
  overrideRateInr?: number,
): NightPrice[] {
  const byDate = new Map(
    plan.filter((p) => p.room_type === roomType).map((p) => [p.date, p] as const),
  );
  return stayNights(checkIn, nights).map((date) => {
    const row = byDate.get(date);
    return {
      date,
      rate_inr: overrideRateInr ?? row?.rate_per_room_night_inr ?? null,
      variable_cost_inr: row?.variable_cost_per_room_night_inr ?? null,
    };
  });
}

function validate(input: PricingInput, extras: PricingExtras): void {
  assertInt('rooms', input.rooms, 0, LIMITS.MAX_ROOMS);
  if (input.nights.length > LIMITS.MAX_NIGHTS) {
    throw new RangeError(`A stay can be at most ${LIMITS.MAX_NIGHTS} nights`);
  }
  for (const n of input.nights) {
    if (n.rate_inr !== null) assertInt(`rate on ${n.date}`, n.rate_inr, 0, LIMITS.MAX_UNIT_INR);
    if (n.variable_cost_inr !== null) {
      assertInt(`variable cost on ${n.date}`, n.variable_cost_inr, 0, LIMITS.MAX_UNIT_INR);
    }
  }
  if (extras.revenue_inr !== null) assertInt('extras revenue', extras.revenue_inr);
  if (extras.cost_inr !== null) assertInt('extras cost', extras.cost_inr);
}

/** Compute all money totals for a package. Pure; never throws for valid integer inputs. */
export function priceTotals(input: PricingInput): QuoteTotals {
  const extras = input.extras ?? NO_EXTRAS;
  validate(input, extras);

  const { rooms } = input;
  const roomNights = rooms * input.nights.length;
  const roomRevenue = sumKnown(
    input.nights.map((n) => (n.rate_inr === null ? null : rooms * n.rate_inr)),
  );
  const variableCost = sumKnown(
    input.nights.map((n) => (n.variable_cost_inr === null ? null : rooms * n.variable_cost_inr)),
  );

  return completeTotals(
    {
      room_nights: roomNights,
      room_revenue_inr: roomRevenue,
      inclusions_revenue_inr: extras.revenue_inr,
      variable_cost_inr: variableCost,
      inclusions_cost_inr: extras.cost_inr,
    },
    input.floor,
  );
}

/** The four money components every package total is built from. */
export type TotalsBase = Pick<
  QuoteTotals,
  | 'room_nights'
  | 'room_revenue_inr'
  | 'inclusions_revenue_inr'
  | 'variable_cost_inr'
  | 'inclusions_cost_inr'
>;

/**
 * Contribution, floor, margin, headroom, shortfall and minimum safe rate from the components.
 * Shared by pricing and by amendments, so the floor rules exist in one place.
 */
export function completeTotals(base: TotalsBase, floorPolicy: FloorPolicy): QuoteTotals {
  const roomNights = base.room_nights;
  const totalRevenue = sumKnown([base.room_revenue_inr, base.inclusions_revenue_inr]);
  const totalCost = sumKnown([base.variable_cost_inr, base.inclusions_cost_inr]);
  const contribution =
    totalRevenue === null || totalCost === null ? null : totalRevenue - totalCost;
  const floor = floorFor(floorPolicy, roomNights);

  // Minimum flat room rate that meets the floor (BR-20: rounded up, never down). It needs every
  // cost and the extras revenue known, and at least one room-night to spread over.
  const minRate =
    totalCost === null || base.inclusions_revenue_inr === null || roomNights === 0
      ? null
      : Math.max(0, ceilDiv(floor + totalCost - base.inclusions_revenue_inr, roomNights));

  return {
    ...base,
    contribution_inr: contribution,
    contribution_margin_pct:
      contribution === null || totalRevenue === null
        ? null
        : percentOneDecimal(contribution, totalRevenue),
    contribution_floor_inr: floor,
    floor_headroom_inr: contribution === null ? null : contribution - floor,
    shortfall_inr: contribution === null ? null : Math.max(0, floor - contribution),
    min_rate_per_room_night_inr: minRate,
  };
}

function unknownDates(
  nights: readonly NightPrice[],
  key: 'rate_inr' | 'variable_cost_inr',
): string[] {
  return nights.filter((n) => n[key] === null).map((n) => n.date);
}

/** "20 x 2000 = 40000" for a flat value, "10 x (2000 + 2200) = 42000" when it varies by night. */
function lineFor(
  label: string,
  input: PricingInput,
  key: 'rate_inr' | 'variable_cost_inr',
  total: number | null,
  roomNights: number,
): string {
  const missing = unknownDates(input.nights, key);
  if (total === null) return `${label} unknown on ${missing.join(', ')}`;
  const values = input.nights.map((n) => n[key] as number);
  const flat = values.every((v) => v === values[0]);
  if (flat && values.length > 0) return `${roomNights} x ${values[0]} = ${total} ${label}`;
  return `${input.rooms} x (${values.join(' + ')}) = ${total} ${label}`;
}

/** Human-readable arithmetic trail so every number traces back to its inputs. */
export function explainPricing(input: PricingInput, t: QuoteTotals): string[] {
  const extras = input.extras ?? NO_EXTRAS;
  const trail = [
    `${input.rooms} rooms x ${input.nights.length} nights = ${t.room_nights} room-nights`,
  ];
  trail.push(lineFor('room revenue', input, 'rate_inr', t.room_revenue_inr, t.room_nights));
  trail.push(
    lineFor('variable cost', input, 'variable_cost_inr', t.variable_cost_inr, t.room_nights),
  );

  const hasExtras = extras.revenue_inr !== 0 || extras.cost_inr !== 0;
  if (extras.detail !== undefined) trail.push(...extras.detail);
  if (hasExtras) {
    trail.push(
      `inclusions revenue ${extras.revenue_inr ?? 'unknown'}, inclusions cost ${extras.cost_inr ?? 'unknown'}`,
    );
  }

  if (input.floor.floor_mode === 'per_room_night') {
    trail.push(
      `floor ${input.floor.floor_per_room_night_inr} x ${t.room_nights} = ${t.contribution_floor_inr}`,
    );
  }

  if (t.contribution_inr === null) {
    trail.push(`contribution unknown, so the floor cannot be checked`);
  } else {
    const parts = hasExtras
      ? `${t.room_revenue_inr} + ${t.inclusions_revenue_inr} - ${t.variable_cost_inr} - ${t.inclusions_cost_inr}`
      : `${t.room_revenue_inr} - ${t.variable_cost_inr}`;
    const verdict =
      t.contribution_inr >= t.contribution_floor_inr
        ? `>= ${t.contribution_floor_inr} floor, headroom ${t.floor_headroom_inr}`
        : `< ${t.contribution_floor_inr} floor, shortfall ${t.shortfall_inr}`;
    trail.push(`${parts} = ${t.contribution_inr} contribution ${verdict}`);
  }

  if (t.min_rate_per_room_night_inr !== null) {
    const need = hasExtras
      ? `${t.contribution_floor_inr} + ${t.variable_cost_inr} + ${t.inclusions_cost_inr} - ${t.inclusions_revenue_inr}`
      : `${t.contribution_floor_inr} + ${t.variable_cost_inr}`;
    trail.push(
      `minimum safe rate ceil((${need}) / ${t.room_nights}) = ${t.min_rate_per_room_night_inr}`,
    );
  }
  return trail;
}

/** Price a package: totals, floor result and the arithmetic trail. */
export function price(input: PricingInput): PricingResult {
  const totals = priceTotals(input);
  return {
    totals,
    floor_ok:
      totals.contribution_inr === null
        ? null
        : floorPasses(totals.contribution_inr, totals.contribution_floor_inr),
    trail: explainPricing(input, totals),
  };
}
