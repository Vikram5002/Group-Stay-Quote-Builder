import {
  DEFAULT_POLICY,
  type InventoryNight,
  type Policy,
  type RatePlanNight,
  type ResolvedQuoteRequest,
} from '@c32/core';
import { getInventory, getRatePlan, type DataContext } from '../data/catalog.js';
import { getPolicy } from '../data/policy.js';

/** The property's saved policy, or the documented defaults (version 0) when none is saved. */
export async function loadPolicy(data: DataContext): Promise<Policy> {
  return (await getPolicy(data)) ?? { ...DEFAULT_POLICY, property_id: data.propertyId };
}

/** Inventory and rate-plan nights covering a request's stay, read strongly consistent. */
export async function loadStay(
  data: DataContext,
  request: ResolvedQuoteRequest,
): Promise<{ inventory: InventoryNight[]; ratePlan: RatePlanNight[] }> {
  const first = request.stay.night_dates[0] as string;
  const last = request.stay.night_dates.at(-1) as string;
  const [inventory, ratePlan] = await Promise.all([
    getInventory(data, request.room_type, first, last),
    getRatePlan(data, request.room_type, first, last),
  ]);
  return { inventory, ratePlan };
}
