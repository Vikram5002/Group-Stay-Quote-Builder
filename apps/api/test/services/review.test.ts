import { checkLedger } from '@c32/core';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { afterEach, describe, expect, it } from 'vitest';
import { getInventory } from '../../src/data/catalog.js';
import { getHoldLines } from '../../src/data/holds.js';
import { getEvents, getQuote, quoteToItem } from '../../src/data/quotes.js';
import { confirmQuote } from '../../src/services/confirm-quote.js';
import { createQuote } from '../../src/services/create-quote.js';
import { ServiceError } from '../../src/services/errors.js';
import { approveQuote, rejectQuote } from '../../src/services/review.js';
import { termsHash } from '../../src/services/terms-hash.js';
import { hasDb, night, readLedger } from '../data/local-db.js';
import { owner, request, sales, serviceHarness } from './harness.js';

const owner2 = { user_id: 'owner-2', role: 'ServiceManager' as const };
const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => (e instanceof ServiceError ? e.code : String(e)),
  );

describe.skipIf(!hasDb)('owner review: approve and reject (DynamoDB Local)', () => {
  let drop: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await drop?.();
    drop = undefined;
  });
  async function setup(inventory?: Parameters<typeof serviceHarness>[0]) {
    const h = await serviceHarness(inventory);
    drop = h.drop;
    return h;
  }
  const belowFloor = () => request({ rate_per_room_night_inr: 1500 });

  it('T16: an owner approves a breach with a reason; confirm then succeeds; audit has actor, reason, hash', async () => {
    const { deps, ctx } = await setup();
    const q = await createQuote(deps, belowFloor(), sales);
    expect(q.status).toBe('PENDING_REVIEW');

    const a = await approveQuote(deps, q.quote_id, owner, 'Repeat client, strategic');
    expect(a).toMatchObject({
      status: 'OFFERED',
      version: 2,
      approval: {
        approved_by: owner,
        reason: 'Repeat client, strategic',
        terms_hash: q.terms_hash,
      },
    });

    const c = await confirmQuote(deps, q.quote_id, sales);
    expect(c.status).toBe('CONFIRMED');

    const events = await getEvents(ctx, q.quote_id);
    expect(events.map((e) => e.type)).toEqual(['QUOTE_CREATED', 'APPROVED', 'CONFIRMED']);
    expect(events[1]).toMatchObject({
      actor: owner,
      reason: 'Repeat client, strategic',
      after: { terms_hash: q.terms_hash },
    });
    expect(checkLedger(await readLedger(ctx))).toEqual([]);
  });

  it('T17: the creator cannot approve their own quote (four-eyes)', async () => {
    const { deps, ctx } = await setup();
    const q = await createQuote(deps, belowFloor(), owner); // an owner who also sells
    expect(await codeOf(approveQuote(deps, q.quote_id, owner, 'Looks fine to me'))).toBe(
      'FORBIDDEN',
    );
    expect((await getQuote(ctx, q.quote_id))?.status).toBe('PENDING_REVIEW');
    expect((await approveQuote(deps, q.quote_id, owner2, 'Second pair of eyes')).status).toBe(
      'OFFERED',
    );
  });

  it('T17: changing the terms after approval invalidates it, so confirm is APPROVAL_REQUIRED', async () => {
    const { deps, ctx } = await setup();
    const q = await createQuote(deps, belowFloor(), sales);
    const approved = await approveQuote(deps, q.quote_id, owner, 'Approved at 1500');

    // Any edit path recomputes the terms hash; here the rate is lowered after approval.
    const edited = request({ rate_per_room_night_inr: 1400 });
    const changed = {
      ...approved,
      request: { ...approved.request, rate_per_room_night_inr: 1400 },
      terms_hash: termsHash(edited, approved.evaluation),
    };
    expect(changed.terms_hash).not.toBe(approved.approval?.terms_hash);
    await ctx.doc.send(new PutCommand({ TableName: ctx.tableName, Item: quoteToItem(changed) }));

    expect(await codeOf(confirmQuote(deps, q.quote_id, sales))).toBe('APPROVAL_REQUIRED');
    expect((await getHoldLines(ctx, q.quote_id)).map((l) => l.state)).toEqual(['held', 'held']);
  });

  it('only a Service Manager can approve or reject, and only a PENDING_REVIEW quote', async () => {
    const { deps } = await setup();
    const q = await createQuote(deps, belowFloor(), sales);
    expect(await codeOf(approveQuote(deps, q.quote_id, sales, 'Reception approving'))).toBe(
      'FORBIDDEN',
    );
    expect(await codeOf(rejectQuote(deps, q.quote_id, sales, 'Reception rejecting'))).toBe(
      'FORBIDDEN',
    );

    await approveQuote(deps, q.quote_id, owner, 'First approval');
    expect(await codeOf(approveQuote(deps, q.quote_id, owner2, 'Second approval'))).toBe(
      'INVALID_STATE',
    );

    const declined = await createQuote(deps, request({ rooms: 1, room_type: 'deluxe' }), sales);
    expect(await codeOf(approveQuote(deps, declined.quote_id, owner, 'Declined quote'))).toBe(
      'INVALID_STATE',
    );
    expect(await codeOf(approveQuote(deps, '01JZZZZZZZZZZZZZZZZZZZZZZZ', owner, 'Missing'))).toBe(
      'NOT_FOUND',
    );
  });

  it('reject releases the holds and records the reason', async () => {
    const { deps, ctx } = await setup();
    const q = await createQuote(deps, belowFloor(), sales);
    const r = await rejectQuote(deps, q.quote_id, owner, 'Too far below the floor');
    expect(r).toMatchObject({ status: 'REJECTED', version: 2 });
    expect(await getHoldLines(ctx, q.quote_id)).toEqual([]);
    const nights = await getInventory(ctx, 'standard', '2026-11-01', '2026-11-02');
    expect(nights.map((n) => [n.available_units, n.held_units])).toEqual([
      [10, 0],
      [10, 0],
    ]);
    const events = await getEvents(ctx, q.quote_id);
    expect(events.at(-1)).toMatchObject({
      type: 'REJECTED',
      actor: owner,
      reason: 'Too far below the floor',
    });
    expect(await codeOf(confirmQuote(deps, q.quote_id, sales))).toBe('INVALID_STATE');
  });

  it('an expired review cannot be approved: 410 and the rooms come back', async () => {
    const { deps, ctx, clock } = await setup();
    const q = await createQuote(deps, belowFloor(), sales);
    clock.advance({ hours: 72 });
    expect(await codeOf(approveQuote(deps, q.quote_id, owner, 'Too late'))).toBe('QUOTE_EXPIRED');
    expect((await getQuote(ctx, q.quote_id))?.status).toBe('EXPIRED');
    expect(await getHoldLines(ctx, q.quote_id)).toEqual([]);
  });

  it('unknown availability cannot be approved (nothing is held to confirm)', async () => {
    const { deps } = await setup([night('2026-11-01', 10), night('2026-11-02', null)]);
    const q = await createQuote(deps, request(), sales);
    expect(q.evaluation.reasons).toEqual(['UNKNOWN_AVAILABILITY']);
    expect(await codeOf(approveQuote(deps, q.quote_id, owner, 'Approve anyway'))).toBe(
      'INVALID_STATE',
    );
    // It can still be rejected, which closes it.
    expect((await rejectQuote(deps, q.quote_id, owner, 'Fix inventory first')).status).toBe(
      'REJECTED',
    );
  });

  it('approve racing reject: exactly one wins', async () => {
    const { deps, ctx } = await setup();
    const q = await createQuote(deps, belowFloor(), sales);
    const [a, r] = await Promise.all([
      codeOf(approveQuote(deps, q.quote_id, owner, 'Approve it now')),
      codeOf(rejectQuote(deps, q.quote_id, owner2, 'Reject it now')),
    ]);
    expect([a, r].filter((x) => x === 'ok')).toHaveLength(1);
    expect(checkLedger(await readLedger(ctx))).toEqual([]);
  });
});
