import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { canonicalJson } from '@c32/core';
import { createHash, randomUUID } from 'node:crypto';
import type { DataContext } from './catalog.js';

/**
 * Idempotency for create, confirm, approve and cancel (BR-17, blueprint 8.2). A client sends an
 * Idempotency-Key header; the first request with that key runs, and any repeat gets the stored
 * response back instead of running again.
 *
 * - Same key, same request, finished       -> replay the stored response.
 * - Same key, different request            -> 409 IDEMPOTENCY_CONFLICT.
 * - Same key while the first is running    -> 409 IDEMPOTENCY_CONFLICT (retry shortly). The lock
 *   is a lease, so a crashed invocation cannot block the key forever.
 * - The first request failed with 5xx      -> nothing is stored; the client may retry.
 *
 * Records live in the main table (PK IDEM#scope#key) with a `ttl` attribute for cleanup only.
 */

export interface StoredResponse {
  status: number;
  body: unknown;
}

export class IdempotencyConflictError extends Error {
  readonly code = 'IDEMPOTENCY_CONFLICT';
  constructor(readonly why: 'DIFFERENT_REQUEST' | 'IN_PROGRESS') {
    super(
      why === 'IN_PROGRESS'
        ? 'A request with this Idempotency-Key is still in progress; retry shortly'
        : 'This Idempotency-Key was used with a different request',
    );
    this.name = 'IdempotencyConflictError';
  }
}

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const RETAIN_SECONDS = 24 * 3600;
const LEASE_MS = 30_000;

/** SHA-256 of the canonical request (method, path and body), to detect key reuse. */
export function requestHash(parts: { method: string; path: string; body: unknown }): string {
  return createHash('sha256').update(canonicalJson(parts), 'utf8').digest('hex');
}

const keyOf = (scope: string, key: string) => ({ PK: `IDEM#${scope}#${key}`, SK: 'IDEM' });

export interface IdempotencyInput {
  /** Who and what, for example "sales-1:confirm:01J...". Keys never collide across scopes. */
  scope: string;
  key: string;
  requestHash: string;
  nowMs: number;
}

/** Run `work` at most once per (scope, key). Returns its response or the stored replay. */
export async function withIdempotency(
  ctx: DataContext,
  input: IdempotencyInput,
  work: () => Promise<StoredResponse>,
): Promise<StoredResponse & { replayed: boolean }> {
  if (!IDEMPOTENCY_KEY_PATTERN.test(input.key)) throw new RangeError('Invalid Idempotency-Key');
  const Key = keyOf(input.scope, input.key);
  // Fencing token: only the attempt that holds the lock may finish or clear the record.
  const token = randomUUID();

  try {
    await ctx.doc.send(
      new PutCommand({
        TableName: ctx.tableName,
        Item: {
          ...Key,
          entity: 'IDEM',
          state: 'in_progress',
          request_hash: input.requestHash,
          locked_until: input.nowMs + LEASE_MS,
          lock_token: token,
          ttl: Math.floor(input.nowMs / 1000) + RETAIN_SECONDS,
        },
        // New key, or an abandoned lease for the same request.
        ConditionExpression:
          'attribute_not_exists(PK) OR (#state = :busy AND locked_until < :now AND request_hash = :hash)',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: {
          ':busy': 'in_progress',
          ':now': input.nowMs,
          ':hash': input.requestHash,
        },
      }),
    );
  } catch (err) {
    if (!(err instanceof ConditionalCheckFailedException)) throw err;
    const existing = await ctx.doc.send(
      new GetCommand({ TableName: ctx.tableName, Key, ConsistentRead: true }),
    );
    const item = existing.Item;
    if (!item) throw new IdempotencyConflictError('IN_PROGRESS'); // vanished mid-check: retry
    if (item['request_hash'] !== input.requestHash)
      throw new IdempotencyConflictError('DIFFERENT_REQUEST');
    if (item['state'] !== 'completed') throw new IdempotencyConflictError('IN_PROGRESS');
    return { status: item['status_code'] as number, body: item['body'], replayed: true };
  }

  /** Clear our own lock so the client may retry; a newer attempt's record is left alone. */
  const abandon = () =>
    ctx.doc
      .send(
        new DeleteCommand({
          TableName: ctx.tableName,
          Key,
          ConditionExpression: 'lock_token = :token',
          ExpressionAttributeValues: { ':token': token },
        }),
      )
      .catch((err: unknown) => {
        if (!(err instanceof ConditionalCheckFailedException)) throw err;
      });

  let response: StoredResponse;
  try {
    response = await work();
  } catch (err) {
    await abandon();
    throw err;
  }
  if (response.status >= 500) {
    await abandon();
    return { ...response, replayed: false };
  }
  try {
    await ctx.doc.send(
      new UpdateCommand({
        TableName: ctx.tableName,
        Key,
        UpdateExpression:
          'SET #state = :done, status_code = :status, body = :body REMOVE locked_until, lock_token',
        ConditionExpression: 'lock_token = :token',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: {
          ':done': 'completed',
          ':status': response.status,
          ':body': response.body,
          ':token': token,
        },
      }),
    );
  } catch (err) {
    // Our lease expired and a retry took over; its response is the one that is kept.
    if (!(err instanceof ConditionalCheckFailedException)) throw err;
  }
  return { ...response, replayed: false };
}
