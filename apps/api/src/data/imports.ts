import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { ImportKind, ImportReport } from '@c32/core';
import type { DataContext } from './catalog.js';
import { keys } from './table.js';

/**
 * Import bookkeeping (FR-07, blueprint 8.3): one record per upload, a marker per committed content
 * hash (re-importing identical content changes nothing), and the ledger-safe inventory update.
 */

export interface ImportRecord {
  import_id: string;
  kind: ImportKind;
  format: 'csv' | 'json';
  file_name: string;
  file_key: string;
  created_by: string;
  created_at: string;
  report: ImportReport | null;
}

const RETAIN_SECONDS = 30 * 24 * 3600;
const importKey = (id: string) => ({ PK: `IMPORT#${id}`, SK: 'META' });
const hashKey = (ctx: DataContext, kind: ImportKind, sha: string) => ({
  PK: keys.property(ctx.propertyId),
  SK: `IMPORTHASH#${kind}#${sha}`,
});

export async function putImport(ctx: DataContext, rec: ImportRecord, nowMs: number) {
  await ctx.doc.send(
    new PutCommand({
      TableName: ctx.tableName,
      Item: {
        ...importKey(rec.import_id),
        entity: 'IMPORT',
        ...rec,
        ttl: Math.floor(nowMs / 1000) + RETAIN_SECONDS,
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    }),
  );
}

export async function getImport(ctx: DataContext, id: string): Promise<ImportRecord | null> {
  const out = await ctx.doc.send(
    new GetCommand({ TableName: ctx.tableName, Key: importKey(id), ConsistentRead: true }),
  );
  if (!out.Item) return null;
  const { PK: _pk, SK: _sk, entity: _e, ttl: _t, ...rec } = out.Item;
  return rec as ImportRecord;
}

export async function saveImportReport(ctx: DataContext, id: string, report: ImportReport) {
  await ctx.doc.send(
    new UpdateCommand({
      TableName: ctx.tableName,
      Key: importKey(id),
      UpdateExpression: 'SET report = :r',
      ExpressionAttributeValues: { ':r': report },
    }),
  );
}

export async function wasCommitted(
  ctx: DataContext,
  kind: ImportKind,
  sha: string,
): Promise<boolean> {
  const out = await ctx.doc.send(
    new GetCommand({
      TableName: ctx.tableName,
      Key: hashKey(ctx, kind, sha),
      ConsistentRead: true,
    }),
  );
  return Boolean(out.Item);
}

/** Record a committed content hash. Returns false if another commit of the same file won. */
export async function markCommitted(
  ctx: DataContext,
  kind: ImportKind,
  sha: string,
  importId: string,
  at: string,
): Promise<boolean> {
  try {
    await ctx.doc.send(
      new PutCommand({
        TableName: ctx.tableName,
        Item: { ...hashKey(ctx, kind, sha), entity: 'IMPORTHASH', import_id: importId, at },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return false;
    throw err;
  }
}

export type TotalUpdate = 'written' | 'unchanged' | 'below_sold' | 'unknown_with_holds';

/**
 * Set a night's total rooms from an import while keeping total = available + held + confirmed
 * (BR-15): available becomes total - held - confirmed. A total below what is already held or
 * confirmed is refused, as is making availability unknown while rooms are held. Optimistic on
 * the night's version, retried a few times if a hold lands in between.
 */
export async function setInventoryTotal(
  ctx: DataContext,
  roomType: string,
  date: string,
  total: number | null,
): Promise<TotalUpdate> {
  const Key = { PK: keys.property(ctx.propertyId), SK: keys.inventory(roomType, date) };
  for (let attempt = 0; attempt < 5; attempt++) {
    const out = await ctx.doc.send(
      new GetCommand({ TableName: ctx.tableName, Key, ConsistentRead: true }),
    );
    const cur = out.Item;
    const held = (cur?.['held_units'] as number | undefined) ?? 0;
    const confirmed = (cur?.['confirmed_units'] as number | undefined) ?? 0;
    const sold = held + confirmed;
    if (cur && (cur['total_units'] ?? null) === total) return 'unchanged';
    if (total === null && sold > 0) return 'unknown_with_holds';
    if (total !== null && total < sold) return 'below_sold';

    const item = {
      ...Key,
      entity: 'INV',
      date,
      room_type: roomType,
      total_units: total,
      ...(total === null ? {} : { available_units: total - sold }),
      held_units: held,
      confirmed_units: confirmed,
      version: ((cur?.['version'] as number | undefined) ?? -1) + 1,
    };
    try {
      await ctx.doc.send(
        new PutCommand({
          TableName: ctx.tableName,
          Item: item,
          ...(cur
            ? {
                ConditionExpression: 'version = :v',
                ExpressionAttributeValues: { ':v': cur['version'] },
              }
            : { ConditionExpression: 'attribute_not_exists(PK)' }),
        }),
      );
      return 'written';
    } catch (err) {
      if (!(err instanceof ConditionalCheckFailedException)) throw err;
      // A hold or another import changed this night: read again and recompute.
    }
  }
  throw new Error(`Inventory ${roomType} ${date} kept changing during the import`);
}
