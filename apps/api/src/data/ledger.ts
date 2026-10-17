import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { createLedger, type Booking, type InventoryNight, type LedgerState } from '@c32/core';
import { itemToInventory, type DataContext } from './catalog.js';

/**
 * Read the whole room-night ledger (inventory nights and hold lines) into the core ledger model,
 * so `checkLedger` can verify BR-15 against what is really stored. Used by the evidence bundle
 * and the nightly reconciliation (T1.13). A full scan is fine at a single property's scale.
 */
export async function readLedgerState(ctx: DataContext): Promise<LedgerState> {
  const items: Record<string, unknown>[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const out = await ctx.doc.send(
      new ScanCommand({
        TableName: ctx.tableName,
        ConsistentRead: true,
        FilterExpression: 'entity IN (:inv, :hold)',
        ExpressionAttributeValues: { ':inv': 'INV', ':hold': 'HOLD' },
        ...(start ? { ExclusiveStartKey: start } : {}),
      }),
    );
    items.push(...((out.Items ?? []) as Record<string, unknown>[]));
    start = out.LastEvaluatedKey;
  } while (start);

  const prefix = `PROP#${ctx.propertyId}`;
  const inventory: InventoryNight[] = items
    .filter((i) => i['entity'] === 'INV' && i['PK'] === prefix)
    .map(itemToInventory);
  const bookings = new Map<string, Booking>();
  for (const line of items.filter((i) => i['entity'] === 'HOLD')) {
    const id = line['quote_id'] as string;
    const existing = bookings.get(id);
    const date = line['date'] as string;
    const units = line['units'] as number;
    bookings.set(id, {
      quote_id: id,
      room_type: line['room_type'] as string,
      dates: existing ? [...existing.dates, date].sort() : [date],
      units,
      // Each hold line keeps its own night's rooms, so multi-line quotes add up right (D-058).
      units_by_date: { ...existing?.units_by_date, [date]: units },
      state: line['state'] as Booking['state'],
    });
  }
  return { nights: createLedger(inventory).nights, bookings };
}
