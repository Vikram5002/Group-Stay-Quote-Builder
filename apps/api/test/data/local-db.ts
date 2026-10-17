import { CreateTableCommand, DeleteTableCommand } from '@aws-sdk/client-dynamodb';
import type { InventoryNight, LedgerState } from '@c32/core';
import { randomUUID } from 'node:crypto';
import type { DataContext } from '../../src/data/catalog.js';
import { createDocClient } from '../../src/data/client.js';
import { readLedgerState } from '../../src/data/ledger.js';
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

/** Read the stored ledger into the core model (same code the API uses). */
export const readLedger = (ctx: DataContext): Promise<LedgerState> => readLedgerState(ctx);

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
