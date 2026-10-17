import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { Quote, QuoteEvent, type QuoteStatus } from '@c32/core';
import type { DataContext } from './catalog.js';
import type { TxItem } from './holds.js';
import { TABLE, keys } from './table.js';

/**
 * Quotes and their audit events (blueprint 8.1, BR-19). Quotes live in the property partition;
 * events in the quote's own partition, sorted by ULID (time order). Writes are returned as
 * transaction items so they commit together with the holds they belong to.
 */

/** Open quotes sort by expiry (for the sweeper); closed ones by creation time. */
const OPEN: ReadonlySet<QuoteStatus> = new Set(['OFFERED', 'PENDING_REVIEW']);

function indexKeys(q: Quote) {
  return {
    GSI1PK: keys.statusIndex(q.property_id, q.status),
    GSI1SK: OPEN.has(q.status) && q.valid_until !== null ? q.valid_until : q.created_at,
  };
}

export function quoteToItem(q: Quote): Record<string, unknown> {
  return {
    PK: keys.property(q.property_id),
    SK: keys.quote(q.quote_id),
    entity: 'QUOTE',
    ...indexKeys(q),
    ...q,
  };
}

export function itemToQuote(item: Record<string, unknown>): Quote {
  const { PK: _pk, SK: _sk, entity: _e, GSI1PK: _g1, GSI1SK: _g2, ...fields } = item;
  return Quote.parse(fields);
}

/** Put a new quote; fails the transaction if the id already exists. */
export function putNewQuoteTx(ctx: DataContext, q: Quote): TxItem {
  return {
    Put: {
      TableName: ctx.tableName,
      Item: quoteToItem(q),
      ConditionExpression: 'attribute_not_exists(PK)',
    },
  };
}

/**
 * Replace a quote only if it is still at `expectedVersion` with `expectedStatus` (optimistic
 * concurrency). Extra conditions, such as not yet expired, are ANDed in.
 */
export function replaceQuoteTx(
  ctx: DataContext,
  next: Quote,
  expectedVersion: number,
  expectedStatus: QuoteStatus,
  extra?: { condition: string; values: Record<string, unknown> },
): TxItem {
  return {
    Put: {
      TableName: ctx.tableName,
      Item: quoteToItem(next),
      ConditionExpression: `version = :v AND #status = :s${extra ? ` AND ${extra.condition}` : ''}`,
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':v': expectedVersion, ':s': expectedStatus, ...extra?.values },
    },
  };
}

export function putEventTx(ctx: DataContext, e: QuoteEvent): TxItem {
  return {
    Put: {
      TableName: ctx.tableName,
      Item: { PK: keys.quote(e.quote_id), SK: keys.event(e.event_id), entity: 'EVT', ...e },
      ConditionExpression: 'attribute_not_exists(PK)',
    },
  };
}

export async function getQuote(ctx: DataContext, quoteId: string): Promise<Quote | null> {
  const out = await ctx.doc.send(
    new GetCommand({
      TableName: ctx.tableName,
      Key: { PK: keys.property(ctx.propertyId), SK: keys.quote(quoteId) },
      ConsistentRead: true,
    }),
  );
  return out.Item ? itemToQuote(out.Item) : null;
}

/** A quote's audit trail, oldest first. */
export async function getEvents(ctx: DataContext, quoteId: string): Promise<QuoteEvent[]> {
  const out = await ctx.doc.send(
    new QueryCommand({
      TableName: ctx.tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': keys.quote(quoteId), ':prefix': 'EVT#' },
      ConsistentRead: true,
    }),
  );
  return (out.Items ?? []).map((item) => {
    const { PK: _pk, SK: _sk, entity: _e, ...fields } = item;
    return QuoteEvent.parse(fields);
  });
}

export interface ListQuotesOptions {
  status?: QuoteStatus;
  /** Check-in on or after / on or before (ISO dates). */
  from?: string;
  to?: string;
  cursor?: string;
  limit: number;
}

export class InvalidCursorError extends Error {
  constructor() {
    super('Invalid cursor');
    this.name = 'InvalidCursorError';
  }
}

const encodeCursor = (key: Record<string, unknown>) =>
  Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');

function decodeCursor(cursor: string): Record<string, unknown> {
  try {
    const key: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof key !== 'object' || key === null || Array.isArray(key)) throw new Error();
    return key as Record<string, unknown>;
  } catch {
    throw new InvalidCursorError();
  }
}

/**
 * List quotes, newest first. By status via GSI1 (the review queue, expiring soon); otherwise the
 * property partition, where ULID sort keys are already in creation order. Paged by cursor.
 */
export async function listQuotes(
  ctx: DataContext,
  opts: ListQuotesOptions,
): Promise<{ items: Quote[]; next_cursor: string | null }> {
  const filters: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  if (opts.from !== undefined || opts.to !== undefined) {
    names['#req'] = 'request';
    names['#stay'] = 'stay';
    names['#ci'] = 'check_in';
  }
  if (opts.from !== undefined) {
    filters.push('#req.#stay.#ci >= :from');
    values[':from'] = opts.from;
  }
  if (opts.to !== undefined) {
    filters.push('#req.#stay.#ci <= :to');
    values[':to'] = opts.to;
  }

  const byStatus = opts.status !== undefined;
  const out = await ctx.doc.send(
    new QueryCommand({
      TableName: ctx.tableName,
      ...(byStatus
        ? {
            IndexName: TABLE.gsi1.name,
            KeyConditionExpression: 'GSI1PK = :pk',
            ExpressionAttributeValues: {
              ':pk': keys.statusIndex(ctx.propertyId, opts.status as QuoteStatus),
              ...values,
            },
          }
        : {
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :q)',
            ExpressionAttributeValues: {
              ':pk': keys.property(ctx.propertyId),
              ':q': 'QUOTE#',
              ...values,
            },
            ConsistentRead: true,
          }),
      ...(filters.length > 0 ? { FilterExpression: filters.join(' AND ') } : {}),
      ...(Object.keys(names).length > 0 ? { ExpressionAttributeNames: names } : {}),
      ScanIndexForward: false,
      Limit: opts.limit,
      ...(opts.cursor ? { ExclusiveStartKey: decodeCursor(opts.cursor) } : {}),
    }),
  );
  return {
    items: (out.Items ?? []).map(itemToQuote),
    next_cursor: out.LastEvaluatedKey ? encodeCursor(out.LastEvaluatedKey) : null,
  };
}
