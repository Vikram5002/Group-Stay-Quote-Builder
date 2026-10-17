import {
  BatchWriteCommand,
  QueryCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import type { InventoryNight, RatePlanNight } from '@c32/core';
import { keys } from './table.js';

/**
 * Inventory and rate-plan nights for one property (blueprint 8.1). Query by room type and date
 * range on the property partition; one item per room type and night.
 */

export interface DataContext {
  doc: DynamoDBDocumentClient;
  tableName: string;
  propertyId: string;
}

type Item = Record<string, unknown>;

/**
 * Unknown availability is stored with no available_units attribute (blueprint 8.2), so the
 * hold condition attribute_exists(available_units) fails on it instead of reading 0 or infinity.
 */
export function inventoryToItem(propertyId: string, n: InventoryNight): Item {
  return {
    PK: keys.property(propertyId),
    SK: keys.inventory(n.room_type, n.date),
    entity: 'INV',
    date: n.date,
    room_type: n.room_type,
    total_units: n.total_units,
    ...(n.available_units === null ? {} : { available_units: n.available_units }),
    held_units: n.held_units,
    confirmed_units: n.confirmed_units,
    version: 0,
  };
}

export function itemToInventory(item: Item): InventoryNight {
  return {
    date: item['date'] as string,
    room_type: item['room_type'] as string,
    total_units: (item['total_units'] as number | null | undefined) ?? null,
    available_units: (item['available_units'] as number | undefined) ?? null,
    held_units: item['held_units'] as number,
    confirmed_units: item['confirmed_units'] as number,
  };
}

export function rateToItem(propertyId: string, r: RatePlanNight): Item {
  return {
    PK: keys.property(propertyId),
    SK: keys.rate(r.room_type, r.date),
    entity: 'RATE',
    date: r.date,
    room_type: r.room_type,
    rate_per_room_night_inr: r.rate_per_room_night_inr,
    variable_cost_per_room_night_inr: r.variable_cost_per_room_night_inr,
    rack_rate_inr: r.rack_rate_inr,
  };
}

export function itemToRate(item: Item): RatePlanNight {
  const n = (k: string) => (item[k] as number | null | undefined) ?? null;
  return {
    date: item['date'] as string,
    room_type: item['room_type'] as string,
    rate_per_room_night_inr: n('rate_per_room_night_inr'),
    variable_cost_per_room_night_inr: n('variable_cost_per_room_night_inr'),
    rack_rate_inr: n('rack_rate_inr'),
  };
}

/** Write items in batches of 25, retrying anything DynamoDB leaves unprocessed. */
async function batchPut(ctx: DataContext, items: Item[]): Promise<void> {
  for (let i = 0; i < items.length; i += 25) {
    let pending = items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } }));
    for (let attempt = 0; pending.length > 0; attempt++) {
      if (attempt > 8) throw new Error('BatchWrite kept returning unprocessed items');
      const out = await ctx.doc.send(
        new BatchWriteCommand({ RequestItems: { [ctx.tableName]: pending } }),
      );
      pending = (out.UnprocessedItems?.[ctx.tableName] ?? []) as typeof pending;
      if (pending.length > 0) await new Promise((r) => setTimeout(r, 2 ** attempt * 25));
    }
  }
}

/** Query every item whose sort key lies between two values, following pagination. */
async function queryBetween(ctx: DataContext, from: string, to: string): Promise<Item[]> {
  const items: Item[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const out = await ctx.doc.send(
      new QueryCommand({
        TableName: ctx.tableName,
        KeyConditionExpression: 'PK = :pk AND SK BETWEEN :from AND :to',
        ExpressionAttributeValues: {
          ':pk': keys.property(ctx.propertyId),
          ':from': from,
          ':to': to,
        },
        ConsistentRead: true,
        ...(start ? { ExclusiveStartKey: start } : {}),
      }),
    );
    items.push(...((out.Items ?? []) as Item[]));
    start = out.LastEvaluatedKey;
  } while (start);
  return items;
}

/** Seed or replace inventory nights (fixtures and tests). Imports arrive in T1.12. */
export async function putInventory(ctx: DataContext, nights: readonly InventoryNight[]) {
  await batchPut(
    ctx,
    nights.map((n) => inventoryToItem(ctx.propertyId, n)),
  );
}

export async function putRatePlan(ctx: DataContext, nights: readonly RatePlanNight[]) {
  await batchPut(
    ctx,
    nights.map((r) => rateToItem(ctx.propertyId, r)),
  );
}

/** Inventory for one room type, nights `from` to `to` inclusive. Strongly consistent. */
export async function getInventory(
  ctx: DataContext,
  roomType: string,
  from: string,
  to: string,
): Promise<InventoryNight[]> {
  const items = await queryBetween(
    ctx,
    keys.inventory(roomType, from),
    keys.inventory(roomType, to),
  );
  return items.map(itemToInventory);
}

export async function getRatePlan(
  ctx: DataContext,
  roomType: string,
  from: string,
  to: string,
): Promise<RatePlanNight[]> {
  const items = await queryBetween(ctx, keys.rate(roomType, from), keys.rate(roomType, to));
  return items.map(itemToRate);
}
