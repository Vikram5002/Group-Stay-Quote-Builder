import { REASON_CODES, type ReasonCode } from '../contract/codes.js';
import type { NightPrice, PricingExtras } from './pricing.js';

/**
 * Null and unknown policy (blueprint 5.4, G5, BR-07, BR-08). Every optional number is one of
 * three things: a known value, unknown (null), or invalid (rejected by validation with 422).
 * Unknown never becomes zero. Instead it raises a reason code, and the decision engine turns any
 * reason into REVIEW so a person looks at it.
 */

/** Narrow a nullable value to a known one. */
export function isKnown<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/** Keep reason codes unique and in catalogue order, so responses are stable and testable. */
export function orderReasons(reasons: Iterable<ReasonCode>): ReasonCode[] {
  const set = new Set(reasons);
  return REASON_CODES.filter((code) => set.has(code));
}

/**
 * Reason codes raised by unknown pricing inputs:
 * - UNKNOWN_RATE when a night has no rate (no plan rate and no override).
 * - UNKNOWN_COST when a night has no variable cost, or an inclusion's cost or revenue is unknown
 *   (for example guests per room unknown for a per-guest inclusion).
 */
export function unknownPricingReasons(
  nights: readonly NightPrice[],
  extras?: PricingExtras,
): ReasonCode[] {
  const reasons: ReasonCode[] = [];
  if (nights.some((n) => n.rate_inr === null)) reasons.push('UNKNOWN_RATE');
  const extrasUnknown =
    extras !== undefined && (extras.cost_inr === null || extras.revenue_inr === null);
  if (nights.some((n) => n.variable_cost_inr === null) || extrasUnknown) {
    reasons.push('UNKNOWN_COST');
  }
  return orderReasons(reasons);
}
