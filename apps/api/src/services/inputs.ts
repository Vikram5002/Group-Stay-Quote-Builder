import {
  DEFAULT_POLICY,
  pastCheckInIssue,
  type InventoryNight,
  type Policy,
  type RatePlanNight,
  type ResolvedQuoteRequest,
  spanDates,
} from '@c32/core';
import { getInventory, getRatePlan, type DataContext } from '../data/catalog.js';
import { getPolicy } from '../data/policy.js';
import { ServiceError } from './errors.js';

/** The property's saved policy, or the documented defaults (version 0) when none is saved. */
export async function loadPolicy(data: DataContext): Promise<Policy> {
  return (await getPolicy(data)) ?? { ...DEFAULT_POLICY, property_id: data.propertyId };
}

/**
 * Refuse a check-in before today in the property time zone (422 on stay.check_in). It needs the
 * policy and the clock, so it runs here rather than in the request schema.
 */
export function refusePastCheckIn(request: ResolvedQuoteRequest, policy: Policy, nowMs: number) {
  const issue = pastCheckInIssue(request.stay.check_in, nowMs, policy.timezone);
  if (issue) throw new ServiceError('VALIDATION_FAILED', '1 field failed validation', [issue]);
}

/** Inventory and rate-plan nights covering a request's stay, read strongly consistent. */
export async function loadStay(
  data: DataContext,
  request: ResolvedQuoteRequest,
): Promise<{ inventory: InventoryNight[]; ratePlan: RatePlanNight[] }> {
  // Every night any line needs (D-058); for one line that is just its stay.
  const dates = spanDates(request.lines);
  const first = dates[0] as string;
  const last = dates.at(-1) as string;
  const [inventory, ratePlan] = await Promise.all([
    getInventory(data, request.room_type, first, last),
    getRatePlan(data, request.room_type, first, last),
  ]);
  return { inventory, ratePlan };
}
