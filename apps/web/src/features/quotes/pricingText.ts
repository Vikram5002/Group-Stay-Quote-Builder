import type { QuoteRequest, QuoteTotals } from '@c32/core';
import { formatInr } from '../../lib/format';

export interface PricingSummary {
  /** Rate per room-night the organiser pays; null when a rate plan varies by night or is unknown. */
  rate: number | null;
  /** How the rate was set, in one line, for screens, the PDF and the copied summary. */
  text: string;
  /** The discount alone ("10% off", "₹200 off per room-night"), or null when there is none. */
  discount: string | null;
}

/**
 * How a quote is priced, worked out from the request and the server's totals: full price less a
 * discount in % or ₹ (D-057), a fixed rate, or the rate plan. Uses the engine's rounding (a %
 * discount is rounded up, a ₹ discount never goes below 0).
 */
export function describePricing(request: QuoteRequest, totals: QuoteTotals): PricingSummary {
  const full = totals.floor_rate_per_room_night_inr;
  const fixed = request.rate_per_room_night_inr;
  if (fixed !== undefined) {
    return {
      rate: fixed,
      text: `${formatInr(fixed)} per room-night, a fixed rate (full price ${formatInr(full)})`,
      discount: null,
    };
  }
  if (request.discount_pct !== undefined && request.discount_pct > 0) {
    const rate = Math.ceil((full * (100 - request.discount_pct)) / 100);
    return {
      rate,
      text: `${formatInr(full)} full price, ${request.discount_pct}% off = ${formatInr(rate)} per room-night`,
      discount: `${request.discount_pct}% off`,
    };
  }
  if (request.discount_inr !== undefined && request.discount_inr > 0) {
    const rate = Math.max(0, full - request.discount_inr);
    return {
      rate,
      text: `${formatInr(full)} full price, ${formatInr(request.discount_inr)} off = ${formatInr(rate)} per room-night`,
      discount: `${formatInr(request.discount_inr)} off per room-night`,
    };
  }
  if (request.discount_pct !== undefined || request.discount_inr !== undefined) {
    return {
      rate: full,
      text: `${formatInr(full)} per room-night, the full price`,
      discount: null,
    };
  }
  // The rate plan can differ by night; show the average when it is known.
  const average =
    totals.room_revenue_inr !== null && totals.room_nights > 0
      ? Math.round(totals.room_revenue_inr / totals.room_nights)
      : null;
  return {
    rate: null,
    text:
      average === null
        ? 'From the rate plan'
        : `From the rate plan, on average ${formatInr(average)} per room-night`,
    discount: null,
  };
}

/** What the organiser pays: room revenue plus inclusions charged on top; null when either is unknown. */
export function clientTotal(totals: QuoteTotals): number | null {
  if (totals.room_revenue_inr === null || totals.inclusions_revenue_inr === null) return null;
  return totals.room_revenue_inr + totals.inclusions_revenue_inr;
}
