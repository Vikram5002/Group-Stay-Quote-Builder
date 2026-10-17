import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import {
  QueryCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import type { DataContext } from './catalog.js';
import {
  ContentionError,
  HoldConflictError,
  NotHeldError,
  TransactionConditionError,
} from './errors.js';
import { keys } from './table.js';

/**
 * Room-night holds as DynamoDB transactions (blueprint 8.2, BR-13 to BR-15). Mirrors the pure
 * ledger model in @c32/core (`hold`, `release`, `confirm`) and is tested against it.
 *
 * Inventory items keep total = available + held + confirmed. Condition expressions cannot do
 * arithmetic on stored attributes, so available_units is stored explicitly and every move
 * changes the counters together in one transaction.
 *
 * Each quote's hold lines live in its own partition (QUOTE#id, SK HOLD#room_type#date). A line
 * is `held` until confirmed; release deletes it with an existence condition, which is what
 * makes release exactly once when the scheduler and the sweeper race.
 */

export type TxItem = NonNullable<TransactWriteCommandInput['TransactItems']>[number];

export interface HoldLine {
  quote_id: string;
  room_type: string;
  date: string;
  units: number;
  state: 'held' | 'confirmed';
  /** UTC ISO instant; the quote's valid_until (assumption A4: holds share the quote expiry). */
  expires_at: string;
}

export interface HoldRequest {
  quoteId: string;
  roomType: string;
  dates: readonly string[];
  units: number;
  expiresAt: string;
}

/** DynamoDB allows 100 items per transaction. */
export const MAX_TRANSACTION_ITEMS = 100;
const MAX_ATTEMPTS = 6;

function checkSize(lines: number, extra: number): void {
  if (lines * 2 + extra > MAX_TRANSACTION_ITEMS) {
    throw new RangeError(
      `Transaction would need ${lines * 2 + extra} items; the limit is ${MAX_TRANSACTION_ITEMS}`,
    );
  }
}

type Reason = { Code?: string; Item?: Record<string, { N?: string } | undefined> };

function reasonsOf(err: unknown): Reason[] | null {
  if (err instanceof TransactionCanceledException)
    return (err.CancellationReasons ?? []) as Reason[];
  return null;
}

/** Transaction items come in pairs per hold line; item i belongs to line floor(i / 2). */
const dateAt = (lines: readonly HoldLine[], i: number) =>
  lines[Math.floor(i / 2)]?.date ?? 'unknown';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run a transaction, retrying only when it was cancelled purely by contention
 * (TransactionConflict, nothing applied). Any failed condition is handed to `onCondition`.
 */
async function transact(
  ctx: DataContext,
  items: TxItem[],
  onCondition: (reasons: Reason[]) => never,
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await ctx.doc.send(new TransactWriteCommand({ TransactItems: items }));
      return;
    } catch (err) {
      const reasons = reasonsOf(err);
      if (reasons === null) throw err;
      if (reasons.some((r) => r.Code === 'ConditionalCheckFailed')) onCondition(reasons);
      if (attempt >= MAX_ATTEMPTS) throw new ContentionError(attempt);
      await sleep(Math.random() * 20 * 2 ** attempt); // full jitter
    }
  }
}

function inventoryKey(ctx: DataContext, roomType: string, date: string) {
  return { PK: keys.property(ctx.propertyId), SK: keys.inventory(roomType, date) };
}

function holdKey(quoteId: string, roomType: string, date: string) {
  return { PK: keys.quote(quoteId), SK: keys.hold(roomType, date) };
}

/**
 * Hold `units` rooms on every night of the stay, together with any `extra` items (the quote
 * and its audit event), or write nothing. Throws HoldConflictError naming the failing night.
 */
export async function acquireHolds(
  ctx: DataContext,
  req: HoldRequest,
  extra: TxItem[] = [],
): Promise<HoldLine[]> {
  if (!Number.isSafeInteger(req.units) || req.units < 1) throw new RangeError('units must be >= 1');
  if (req.dates.length === 0) throw new RangeError('A hold needs at least one night');
  checkSize(req.dates.length, extra.length);

  const lines: HoldLine[] = req.dates.map((date) => ({
    quote_id: req.quoteId,
    room_type: req.roomType,
    date,
    units: req.units,
    state: 'held',
    expires_at: req.expiresAt,
  }));

  const items: TxItem[] = [];
  for (const line of lines) {
    items.push({
      Update: {
        TableName: ctx.tableName,
        Key: inventoryKey(ctx, line.room_type, line.date),
        UpdateExpression:
          'SET available_units = available_units - :n, held_units = held_units + :n, version = version + :one',
        ConditionExpression: 'attribute_exists(available_units) AND available_units >= :n',
        ExpressionAttributeValues: { ':n': line.units, ':one': 1 },
        ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
      },
    });
    items.push({
      Put: {
        TableName: ctx.tableName,
        Item: { ...holdKey(line.quote_id, line.room_type, line.date), entity: 'HOLD', ...line },
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    });
  }
  items.push(...extra);

  await transact(ctx, items, (reasons) => {
    const i = reasons.findIndex((r) => r.Code === 'ConditionalCheckFailed');
    if (i >= lines.length * 2) throw new TransactionConditionError(i - lines.length * 2);
    const date = dateAt(lines, i);
    if (i % 2 === 1) throw new HoldConflictError(date, 'ALREADY_HELD');
    const old = reasons[i]?.Item;
    if (!old) throw new HoldConflictError(date, 'NO_INVENTORY_DATA');
    const available = old['available_units']?.N;
    if (available === undefined) throw new HoldConflictError(date, 'UNKNOWN_AVAILABILITY');
    throw new HoldConflictError(date, 'INSUFFICIENT', Number(available));
  });
  return lines;
}

/** All hold lines of a quote (held and confirmed), strongly consistent. */
export async function getHoldLines(ctx: DataContext, quoteId: string): Promise<HoldLine[]> {
  const out = await ctx.doc.send(
    new QueryCommand({
      TableName: ctx.tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': keys.quote(quoteId), ':prefix': keys.holdPrefix() },
      ConsistentRead: true,
    }),
  );
  return (out.Items ?? []).map((item) => ({
    quote_id: item['quote_id'] as string,
    room_type: item['room_type'] as string,
    date: item['date'] as string,
    units: item['units'] as number,
    state: item['state'] as HoldLine['state'],
    expires_at: item['expires_at'] as string,
  }));
}

export interface ReleaseResult {
  /** False when the holds were already gone: release is exactly once (BR-14). */
  released: boolean;
  lines: HoldLine[];
}

/**
 * Give a quote's held rooms back (expiry, decline, reject). Safe to call any number of times
 * from any number of workers: only one call releases; the others return released = false.
 */
export async function releaseHolds(
  ctx: DataContext,
  quoteId: string,
  extra: TxItem[] = [],
): Promise<ReleaseResult> {
  const lines = (await getHoldLines(ctx, quoteId)).filter((l) => l.state === 'held');
  if (lines.length === 0) return { released: false, lines: [] };
  checkSize(lines.length, extra.length);

  const items: TxItem[] = [];
  for (const line of lines) {
    items.push({
      Delete: {
        TableName: ctx.tableName,
        Key: holdKey(quoteId, line.room_type, line.date),
        ConditionExpression: 'attribute_exists(PK) AND #state = :held',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: { ':held': 'held' },
      },
    });
    items.push({
      Update: {
        TableName: ctx.tableName,
        Key: inventoryKey(ctx, line.room_type, line.date),
        UpdateExpression:
          'SET available_units = available_units + :n, held_units = held_units - :n, version = version + :one',
        ConditionExpression: 'attribute_exists(available_units) AND held_units >= :n',
        ExpressionAttributeValues: { ':n': line.units, ':one': 1 },
      },
    });
  }
  items.push(...extra);

  let alreadyReleased = false;
  try {
    await transact(ctx, items, (reasons) => {
      const i = reasons.findIndex((r) => r.Code === 'ConditionalCheckFailed');
      if (i >= lines.length * 2) throw new TransactionConditionError(i - lines.length * 2);
      if (i % 2 === 0) {
        alreadyReleased = true; // another caller released or confirmed first
        throw new NotHeldError(quoteId);
      }
      throw new Error(`Inventory counters for ${dateAt(lines, i)} are inconsistent`);
    });
  } catch (err) {
    if (alreadyReleased && err instanceof NotHeldError) return { released: false, lines: [] };
    throw err;
  }
  return { released: true, lines };
}

/**
 * Move a quote's held rooms to confirmed, together with `extra` items (the service adds the
 * quote update conditioned on status OFFERED and valid_until > now). Throws NotHeldError when
 * nothing is held.
 */
export async function confirmHolds(
  ctx: DataContext,
  quoteId: string,
  extra: TxItem[] = [],
): Promise<HoldLine[]> {
  const lines = (await getHoldLines(ctx, quoteId)).filter((l) => l.state === 'held');
  if (lines.length === 0) throw new NotHeldError(quoteId);
  checkSize(lines.length, extra.length);

  const items: TxItem[] = [];
  for (const line of lines) {
    items.push({
      Update: {
        TableName: ctx.tableName,
        Key: holdKey(quoteId, line.room_type, line.date),
        UpdateExpression: 'SET #state = :confirmed',
        ConditionExpression: 'attribute_exists(PK) AND #state = :held',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: { ':held': 'held', ':confirmed': 'confirmed' },
      },
    });
    items.push({
      Update: {
        TableName: ctx.tableName,
        Key: inventoryKey(ctx, line.room_type, line.date),
        UpdateExpression:
          'SET held_units = held_units - :n, confirmed_units = confirmed_units + :n, version = version + :one',
        ConditionExpression: 'held_units >= :n',
        ExpressionAttributeValues: { ':n': line.units, ':one': 1 },
      },
    });
  }
  items.push(...extra);

  await transact(ctx, items, (reasons) => {
    const i = reasons.findIndex((r) => r.Code === 'ConditionalCheckFailed');
    if (i >= lines.length * 2) throw new TransactionConditionError(i - lines.length * 2);
    if (i % 2 === 0) throw new NotHeldError(quoteId);
    throw new Error(`Inventory counters for ${dateAt(lines, i)} are inconsistent`);
  });
  return lines.map((l) => ({ ...l, state: 'confirmed' }));
}
