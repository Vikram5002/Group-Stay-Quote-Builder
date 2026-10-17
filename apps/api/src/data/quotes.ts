import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { Quote, QuoteEvent, type QuoteStatus } from '@c32/core';
import type { DataContext } from './catalog.js';
import type { TxItem } from './holds.js';
import { keys } from './table.js';

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
