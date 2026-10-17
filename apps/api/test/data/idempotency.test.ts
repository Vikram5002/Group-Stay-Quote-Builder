import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DataContext } from '../../src/data/catalog.js';
import {
  IdempotencyConflictError,
  requestHash,
  withIdempotency,
  type IdempotencyInput,
} from '../../src/data/idempotency.js';
import { createTestTable, hasDb } from './local-db.js';

const NOW = Date.parse('2026-10-17T04:30:00Z');
let counter = 0;
const freshKey = () => `key-${Date.now()}-${counter++}`;

describe.skipIf(!hasDb)('idempotency store (DynamoDB Local)', () => {
  let ctx: DataContext;
  let drop: () => Promise<void>;
  beforeAll(async () => ({ ctx, drop } = await createTestTable()));
  afterAll(async () => drop());

  const input = (key: string, body: unknown = { a: 1 }, nowMs = NOW): IdempotencyInput => ({
    scope: 'sales-1:confirm:Q1',
    key,
    requestHash: requestHash({ method: 'POST', path: '/v1/quotes/Q1/confirm', body }),
    nowMs,
  });

  it('runs once and replays the stored response for a repeat', async () => {
    const key = freshKey();
    let runs = 0;
    const work = async () => {
      runs++;
      return { status: 200, body: { status: 'CONFIRMED', version: 2 } };
    };
    const first = await withIdempotency(ctx, input(key), work);
    const second = await withIdempotency(ctx, input(key), work);
    expect(runs).toBe(1);
    expect(first).toEqual({
      status: 200,
      body: { status: 'CONFIRMED', version: 2 },
      replayed: false,
    });
    expect(second).toEqual({ ...first, replayed: true });
  });

  it('stores and replays client errors too (4xx is a real answer)', async () => {
    const key = freshKey();
    const work = async () => ({ status: 409, body: { code: 'APPROVAL_REQUIRED' } });
    await withIdempotency(ctx, input(key), work);
    expect(await withIdempotency(ctx, input(key), work)).toMatchObject({
      status: 409,
      replayed: true,
    });
  });

  it('rejects the same key with a different request', async () => {
    const key = freshKey();
    await withIdempotency(ctx, input(key, { a: 1 }), async () => ({ status: 200, body: {} }));
    await expect(
      withIdempotency(ctx, input(key, { a: 2 }), async () => ({ status: 200, body: {} })),
    ).rejects.toMatchObject({ why: 'DIFFERENT_REQUEST' });
  });

  it('keys are scoped: the same key in another scope runs independently', async () => {
    const key = freshKey();
    let runs = 0;
    const work = async () => ({ status: 200, body: { run: ++runs } });
    await withIdempotency(ctx, input(key), work);
    await withIdempotency(ctx, { ...input(key), scope: 'sales-2:confirm:Q1' }, work);
    expect(runs).toBe(2);
  });

  it('a concurrent duplicate gets IN_PROGRESS while the first is still running', async () => {
    const key = freshKey();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = withIdempotency(ctx, input(key), async () => {
      await gate;
      return { status: 200, body: { ok: true } };
    });
    await new Promise((r) => setTimeout(r, 50)); // let the first take the lock
    await expect(
      withIdempotency(ctx, input(key), async () => ({ status: 200, body: {} })),
    ).rejects.toMatchObject({ why: 'IN_PROGRESS' });
    release();
    expect((await first).replayed).toBe(false);
  });

  it('a crashed first attempt (expired lease) can be taken over by a retry', async () => {
    const key = freshKey();
    // A first attempt that stalls past its 30 s lease.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const stuck = withIdempotency(ctx, input(key), async () => {
      await gate;
      return { status: 200, body: { from: 'first' } };
    });
    await new Promise((r) => setTimeout(r, 50));
    const retry = await withIdempotency(ctx, input(key, { a: 1 }, NOW + 31_000), async () => ({
      status: 200,
      body: { from: 'retry' },
    }));
    expect(retry).toMatchObject({ body: { from: 'retry' }, replayed: false });
    release();
    await stuck;
    // The late first attempt must not overwrite what the retry stored.
    const replay = await withIdempotency(ctx, input(key, { a: 1 }, NOW + 32_000), async () => ({
      status: 200,
      body: { from: 'third' },
    }));
    expect(replay).toMatchObject({ body: { from: 'retry' }, replayed: true });
  });

  it('a failure or 5xx stores nothing, so the client can retry', async () => {
    const key = freshKey();
    await expect(
      withIdempotency(ctx, input(key), async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const after500 = await withIdempotency(ctx, input(key), async () => ({
      status: 503,
      body: {},
    }));
    expect(after500).toMatchObject({ status: 503, replayed: false });
    const ok = await withIdempotency(ctx, input(key), async () => ({
      status: 200,
      body: { ok: 1 },
    }));
    expect(ok).toMatchObject({ status: 200, replayed: false });
  });

  it('rejects malformed keys before touching the table', async () => {
    for (const bad of ['short', 'has space in it', 'x'.repeat(129)]) {
      await expect(
        withIdempotency(ctx, input(bad), async () => ({ status: 200, body: {} })),
      ).rejects.toBeInstanceOf(RangeError);
    }
    expect(new IdempotencyConflictError('IN_PROGRESS').code).toBe('IDEMPOTENCY_CONFLICT');
  });
});
