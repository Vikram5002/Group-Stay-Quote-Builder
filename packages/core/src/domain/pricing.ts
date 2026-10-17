import type { QuoteTotals } from '../contract/quote.js';
import type { FloorPolicy } from './floor.js';

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
