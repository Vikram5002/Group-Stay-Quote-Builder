import { CreateTableCommand, DeleteTableCommand } from '@aws-sdk/client-dynamodb';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { createLedger, type Booking, type InventoryNight, type LedgerState } from '@c32/core';
import { randomUUID } from 'node:crypto';
import { itemToInventory, type DataContext } from '../../src/data/catalog.js';
import { createDocClient } from '../../src/data/client.js';
import { createTableInput } from '../../src/data/table.js';

/**
 * DynamoDB Local for integration tests. Start it with `npm run db:up -w @c32/api` and set
 * DYNAMODB_ENDPOINT=http://localhost:8100. Without the variable the suites are skipped locally;
 * in CI a missing database is an error, so it can never pass silently.
 */
export const endpoint = process.env['DYNAMODB_ENDPOINT'];

if (!endpoint && process.env['CI']) {
  throw new Error('DYNAMODB_ENDPOINT must be set in CI for the data layer integration tests');
}

export const hasDb = Boolean(endpoint);

/** A fresh table per test file, so suites never share state. */
export async function createTestTable(): Promise<{ ctx: DataContext; drop: () => Promise<void> }> {
  const tableName = `c32-test-${randomUUID().slice(0, 8)}`;
  const doc = createDocClient({
    tableName,
    region: 'ap-south-1',
    ...(endpoint ? { endpoint } : {}),
  });
  await doc.send(new CreateTableCommand(createTableInput(tableName)));
  return {
    ctx: { doc, tableName, propertyId: 'p1' },
    drop: async () => {
      await doc.send(new DeleteTableCommand({ TableName: tableName }));
      doc.destroy();
    },
  };
}

/** Read the whole table into the core ledger model, to compare and to run checkLedger. */
export async function readLedger(ctx: DataContext): Promise<LedgerState> {
  const items: Record<string, unknown>[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const out = await ctx.doc.send(
      new ScanCommand({
        TableName: ctx.tableName,
        ConsistentRead: true,
        ...(start ? { ExclusiveStartKey: start } : {}),
      }),
    );
    items.push(...((out.Items ?? []) as Record<string, unknown>[]));
    start = out.LastEvaluatedKey;
  } while (start);

  const inventory: InventoryNight[] = items
    .filter((i) => i['entity'] === 'INV')
    .map(itemToInventory);
  const state = createLedger(inventory);
  const bookings = new Map<string, Booking>();
  for (const line of items.filter((i) => i['entity'] === 'HOLD')) {
    const id = line['quote_id'] as string;
    const existing = bookings.get(id);
    const date = line['date'] as string;
    bookings.set(id, {
      quote_id: id,
      room_type: line['room_type'] as string,
      dates: existing ? [...existing.dates, date].sort() : [date],
      units: line['units'] as number,
      state: line['state'] as Booking['state'],
    });
  }
  return { nights: state.nights, bookings };
}

export const night = (
  date: string,
  total: number | null,
  roomType = 'standard',
): InventoryNight => ({
  date,
  room_type: roomType,
  total_units: total,
  available_units: total,
  held_units: 0,
  confirmed_units: 0,
});
