import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { localDate } from '@c32/core';
import type { DataContext } from '../data/catalog.js';
import { setInventoryTotal } from '../data/imports.js';
import { keys } from '../data/table.js';

export interface RoomTotalsReport {
  /** Nights whose total was set to the new number of rooms. */
  updated: number;
  /** Nights that already had that total. */
  unchanged: number;
  /** Nights left alone because more rooms are held or booked than the new total. */
  skipped: string[];
}

/**
 * The owner's "total rooms" setting (D-056) becomes every future night's total. Past nights are
 * history and are left alone. Each night keeps the ledger invariant (BR-15) through the same
 * safe update the imports use: available = total - held - confirmed, and a total below what is
 * already held or booked is refused for that night.
 */
export async function applyRoomTotals(
  ctx: DataContext,
  totalRooms: number,
  timezone: string,
  nowMs: number,
): Promise<RoomTotalsReport> {
  const today = localDate(nowMs, timezone);
  const nights: { room_type: string; date: string }[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const out = await ctx.doc.send(
      new QueryCommand({
        TableName: ctx.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :inv)',
        ExpressionAttributeValues: { ':pk': keys.property(ctx.propertyId), ':inv': 'INV#' },
        ProjectionExpression: 'room_type, #d',
        ExpressionAttributeNames: { '#d': 'date' },
        ...(start ? { ExclusiveStartKey: start } : {}),
      }),
    );
    for (const item of out.Items ?? []) {
      const date = item['date'] as string;
      if (date >= today) nights.push({ room_type: item['room_type'] as string, date });
    }
    start = out.LastEvaluatedKey;
  } while (start);

  const report: RoomTotalsReport = { updated: 0, unchanged: 0, skipped: [] };
  // A few at a time: fast enough for a season of nights, gentle on on-demand capacity.
  for (let i = 0; i < nights.length; i += 10) {
    const batch = nights.slice(i, i + 10);
    const results = await Promise.all(
      batch.map((n) => setInventoryTotal(ctx, n.room_type, n.date, totalRooms)),
    );
    results.forEach((r, j) => {
      if (r === 'written') report.updated++;
      else if (r === 'unchanged') report.unchanged++;
      else report.skipped.push(batch[j]?.date ?? '');
    });
  }
  report.skipped.sort();
  return report;
}
