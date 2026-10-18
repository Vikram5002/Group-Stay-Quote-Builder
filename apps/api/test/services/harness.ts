import {
  ManualClock,
  mapC32Fixture,
  validateQuoteRequest,
  type Actor,
  type InventoryNight,
  type ResolvedQuoteRequest,
} from '@c32/core';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { monotonicFactory } from 'ulid';
import { putInventory, putRatePlan } from '../../src/data/catalog.js';
import type { ServiceDeps } from '../../src/services/create-quote.js';
import { createTestTable } from '../data/local-db.js';

/** Service test harness: a fresh table seeded with the C32 fixture, a manual clock, ULIDs. */

export const fixture = mapC32Fixture(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../../data/fixtures/fixture.json', import.meta.url)),
      'utf8',
    ),
  ),
);

export const ISSUED = '2026-10-17T10:00:00+05:30';
export const sales: Actor = { user_id: 'sales-1', role: 'Reception' };
export const owner: Actor = { user_id: 'owner-1', role: 'ServiceManager' };

export async function serviceHarness(inventory: InventoryNight[] = fixture.inventory) {
  const { ctx, drop } = await createTestTable();
  await putInventory(ctx, inventory);
  await putRatePlan(ctx, fixture.ratePlan);
  const clock = new ManualClock(ISSUED);
  const deps: ServiceDeps = { data: ctx, clock, newId: monotonicFactory() };
  return { deps, clock, ctx, drop };
}

/** The fixture request with overrides, validated like the API does. */
export function request(over: object = {}): ResolvedQuoteRequest {
  const v = validateQuoteRequest({ ...fixture.request, ...over });
  if (!v.ok) throw new Error(JSON.stringify(v.problem.errors));
  return v.value;
}
