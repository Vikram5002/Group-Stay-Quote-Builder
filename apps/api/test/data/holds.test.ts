import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { checkLedger } from '@c32/core';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getInventory, putInventory, type DataContext } from '../../src/data/catalog.js';
import {
  HoldConflictError,
  NotHeldError,
  TransactionConditionError,
} from '../../src/data/errors.js';
import {
  acquireHolds,
  amendHolds,
  cancelHolds,
  confirmHolds,
  extendHolds,
  getHoldLines,
  releaseHolds,
  type HoldRequest,
} from '../../src/data/holds.js';
import { keys } from '../../src/data/table.js';
import { createTestTable, hasDb, night, readLedger } from './local-db.js';

const STAY = ['2026-11-01', '2026-11-02'];
const EXPIRES = '2026-10-20T04:30:00.000Z';
const req = (quoteId: string, units: number, dates = STAY): HoldRequest => ({
  quoteId,
  roomType: 'standard',
  dates,
  units,
  expiresAt: EXPIRES,
});

describe.skipIf(!hasDb)('transactional holds (DynamoDB Local)', () => {
  let ctx: DataContext;
  const drops: (() => Promise<void>)[] = [];

  /** Every test starts from the fixture: 10 standard rooms on both nights. */
  beforeEach(async () => {
    const t = await createTestTable();
    ctx = t.ctx;
    drops.push(t.drop);
    await putInventory(ctx, [night('2026-11-01', 10), night('2026-11-02', 10)]);
  });
  afterAll(async () => {
    for (const drop of drops) await drop();
  });

  const counters = async () =>
    (await getInventory(ctx, 'standard', '2026-11-01', '2026-11-02')).map((n) => [
      n.available_units,
      n.held_units,
      n.confirmed_units,
    ]);

  const consistent = async () => expect(checkLedger(await readLedger(ctx))).toEqual([]);

  describe('acquire (BR-13)', () => {
    it('moves units from available to held on every night and writes hold lines', async () => {
      const lines = await acquireHolds(ctx, req('Q1', 4));
      expect(lines).toHaveLength(2);
      expect(await counters()).toEqual([
        [6, 4, 0],
        [6, 4, 0],
      ]);
      expect(await getHoldLines(ctx, 'Q1')).toEqual([
        {
          quote_id: 'Q1',
          room_type: 'standard',
          date: '2026-11-01',
          units: 4,
          state: 'held',
          expires_at: EXPIRES,
        },
        {
          quote_id: 'Q1',
          room_type: 'standard',
          date: '2026-11-02',
          units: 4,
          state: 'held',
          expires_at: EXPIRES,
        },
      ]);
      await consistent();
    });

    it('T02 shape: holding all 10 leaves 0 available, and an 11th room is refused', async () => {
      await acquireHolds(ctx, req('Q1', 10));
      expect(await counters()).toEqual([
        [0, 10, 0],
        [0, 10, 0],
      ]);
      await expect(acquireHolds(ctx, req('Q2', 1))).rejects.toMatchObject({
        reason: 'INSUFFICIENT',
        available: 0,
        date: '2026-11-01',
      });
      await consistent();
    });

    it('is all or nothing: a short second night leaves the first night untouched', async () => {
      await putInventory(ctx, [night('2026-11-02', 3)]);
      const err = await acquireHolds(ctx, req('Q1', 4)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HoldConflictError);
      expect(err).toMatchObject({ date: '2026-11-02', reason: 'INSUFFICIENT', available: 3 });
      const nights = await getInventory(ctx, 'standard', '2026-11-01', '2026-11-02');
      expect(nights.map((n) => n.available_units)).toEqual([10, 3]);
      expect(await getHoldLines(ctx, 'Q1')).toEqual([]);
    });

    it('names a missing night as NO_INVENTORY_DATA and never creates the row', async () => {
      await expect(
        acquireHolds(ctx, req('Q1', 1, ['2026-11-01', '2026-11-03'])),
      ).rejects.toMatchObject({
        date: '2026-11-03',
        reason: 'NO_INVENTORY_DATA',
      });
      expect(await getInventory(ctx, 'standard', '2026-11-03', '2026-11-03')).toEqual([]);
    });

    it('refuses a night with unknown availability (no available_units attribute)', async () => {
      await putInventory(ctx, [night('2026-11-02', null)]);
      await expect(acquireHolds(ctx, req('Q1', 1))).rejects.toMatchObject({
        date: '2026-11-02',
        reason: 'UNKNOWN_AVAILABILITY',
      });
    });

    it('refuses a second hold for the same quote', async () => {
      await acquireHolds(ctx, req('Q1', 2));
      await expect(acquireHolds(ctx, req('Q1', 2))).rejects.toMatchObject({
        reason: 'ALREADY_HELD',
      });
      expect(await counters()).toEqual([
        [8, 2, 0],
        [8, 2, 0],
      ]);
    });

    it('refuses a second hold for the same quote on different nights (found by the model test)', async () => {
      await acquireHolds(ctx, req('Q1', 1, ['2026-11-02']));
      await expect(acquireHolds(ctx, req('Q1', 1, ['2026-11-01']))).rejects.toMatchObject({
        reason: 'ALREADY_HELD',
      });
      expect(await counters()).toEqual([
        [10, 0, 0],
        [9, 1, 0],
      ]);
    });

    it('a released quote may hold again', async () => {
      await acquireHolds(ctx, req('Q1', 2));
      await releaseHolds(ctx, 'Q1');
      await acquireHolds(ctx, req('Q1', 3));
      expect(await counters()).toEqual([
        [7, 3, 0],
        [7, 3, 0],
      ]);
      await consistent();
    });

    it('writes extra items in the same transaction, and rolls back when their condition fails', async () => {
      const quoteKey = { PK: keys.property('p1'), SK: keys.quote('Q1') };
      await acquireHolds(ctx, req('Q1', 2), [
        {
          Put: {
            TableName: ctx.tableName,
            Item: { ...quoteKey, entity: 'QUOTE', status: 'OFFERED' },
          },
        },
      ]);
      const saved = await ctx.doc.send(new GetCommand({ TableName: ctx.tableName, Key: quoteKey }));
      expect(saved.Item?.['status']).toBe('OFFERED');

      const err = await acquireHolds(ctx, req('Q2', 2), [
        {
          Put: {
            TableName: ctx.tableName,
            Item: { ...quoteKey, entity: 'QUOTE' },
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
      ]).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TransactionConditionError);
      expect(await getHoldLines(ctx, 'Q2')).toEqual([]);
      expect(await counters()).toEqual([
        [8, 2, 0],
        [8, 2, 0],
      ]);
    });

    it('rejects bad input before calling DynamoDB', async () => {
      await expect(acquireHolds(ctx, req('Q1', 0))).rejects.toBeInstanceOf(RangeError);
      await expect(acquireHolds(ctx, req('Q1', 1, []))).rejects.toBeInstanceOf(RangeError);
      // 51 nights x 2 items = 102 > 100; 50 nights would be exactly the limit.
      const tooMany = Array.from({ length: 51 }, (_, i) => `night-${i}`);
      await expect(acquireHolds(ctx, req('Q1', 1, tooMany))).rejects.toThrow(/limit is 100/);
    });
  });

  describe('release is exactly once (BR-14)', () => {
    it('returns the rooms and deletes the hold lines', async () => {
      await acquireHolds(ctx, req('Q1', 4));
      const r = await releaseHolds(ctx, 'Q1');
      expect(r.released).toBe(true);
      expect(r.lines).toHaveLength(2);
      expect(await counters()).toEqual([
        [10, 0, 0],
        [10, 0, 0],
      ]);
      expect(await getHoldLines(ctx, 'Q1')).toEqual([]);
      await consistent();
    });

    it('a second release does nothing', async () => {
      await acquireHolds(ctx, req('Q1', 4));
      await releaseHolds(ctx, 'Q1');
      expect(await releaseHolds(ctx, 'Q1')).toEqual({ released: false, lines: [] });
      expect(await counters()).toEqual([
        [10, 0, 0],
        [10, 0, 0],
      ]);
    });

    it('scheduler and sweeper racing: exactly one release wins', async () => {
      await acquireHolds(ctx, req('Q1', 4));
      const results = await Promise.all([
        releaseHolds(ctx, 'Q1'),
        releaseHolds(ctx, 'Q1'),
        releaseHolds(ctx, 'Q1'),
      ]);
      expect(results.filter((r) => r.released)).toHaveLength(1);
      expect(await counters()).toEqual([
        [10, 0, 0],
        [10, 0, 0],
      ]);
      await consistent();
    });

    it('T13 shape: B is refused while A holds everything, then succeeds after A is released', async () => {
      await acquireHolds(ctx, req('A', 10));
      await expect(acquireHolds(ctx, req('B', 5))).rejects.toMatchObject({
        reason: 'INSUFFICIENT',
      });
      await releaseHolds(ctx, 'A');
      await acquireHolds(ctx, req('B', 5));
      expect(await counters()).toEqual([
        [5, 5, 0],
        [5, 5, 0],
      ]);
      await consistent();
    });

    it('does not release confirmed rooms', async () => {
      await acquireHolds(ctx, req('Q1', 4));
      await confirmHolds(ctx, 'Q1');
      expect(await releaseHolds(ctx, 'Q1')).toEqual({ released: false, lines: [] });
      expect(await counters()).toEqual([
        [6, 0, 4],
        [6, 0, 4],
      ]);
    });
  });

  describe('confirm', () => {
    it('moves held units to confirmed and marks the lines confirmed', async () => {
      await acquireHolds(ctx, req('Q1', 4));
      const lines = await confirmHolds(ctx, 'Q1');
      expect(lines.every((l) => l.state === 'confirmed')).toBe(true);
      expect(await counters()).toEqual([
        [6, 0, 4],
        [6, 0, 4],
      ]);
      expect((await getHoldLines(ctx, 'Q1')).map((l) => l.state)).toEqual([
        'confirmed',
        'confirmed',
      ]);
      await consistent();
    });

    it('cannot confirm twice, or confirm a quote with no holds', async () => {
      await acquireHolds(ctx, req('Q1', 4));
      await confirmHolds(ctx, 'Q1');
      await expect(confirmHolds(ctx, 'Q1')).rejects.toBeInstanceOf(NotHeldError);
      await expect(confirmHolds(ctx, 'nope')).rejects.toBeInstanceOf(NotHeldError);
    });

    it('rolls back when the quote condition in the same transaction fails (e.g. expired)', async () => {
      await acquireHolds(ctx, req('Q1', 4));
      const err = await confirmHolds(ctx, 'Q1', [
        {
          ConditionCheck: {
            TableName: ctx.tableName,
            Key: { PK: keys.property('p1'), SK: keys.quote('Q1') },
            ConditionExpression: 'attribute_exists(PK)', // no quote item: condition fails
          },
        },
      ]).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TransactionConditionError);
      expect(await counters()).toEqual([
        [6, 4, 0],
        [6, 4, 0],
      ]);
    });

    it('a confirm racing a release: one wins and the ledger stays consistent', async () => {
      await acquireHolds(ctx, req('Q1', 4));
      const [confirmed, released] = await Promise.allSettled([
        confirmHolds(ctx, 'Q1'),
        releaseHolds(ctx, 'Q1'),
      ]);
      const confirmWon = confirmed.status === 'fulfilled';
      const releaseWon = released.status === 'fulfilled' && released.value.released;
      expect(confirmWon !== releaseWon).toBe(true);
      await consistent();
    });
  });

  describe('amend, cancel and extend (BR-16)', () => {
    it('amend 10 to 7 releases 3 rooms per night (6 room-nights)', async () => {
      await acquireHolds(ctx, req('Q1', 10));
      await confirmHolds(ctx, 'Q1');
      const r = await amendHolds(ctx, 'Q1', 7);
      expect(r.released_units).toBe(3);
      expect(await counters()).toEqual([
        [3, 0, 7],
        [3, 0, 7],
      ]);
      expect((await getHoldLines(ctx, 'Q1')).map((l) => l.units)).toEqual([7, 7]);
      await consistent();
    });

    it('amend only reduces, only confirmed bookings, and never applies twice', async () => {
      await acquireHolds(ctx, req('Q1', 4));
      await expect(amendHolds(ctx, 'Q1', 2)).rejects.toBeInstanceOf(NotHeldError); // still held
      await confirmHolds(ctx, 'Q1');
      for (const bad of [0, 4, 5])
        await expect(amendHolds(ctx, 'Q1', bad)).rejects.toBeInstanceOf(RangeError);
      const results = await Promise.allSettled([
        amendHolds(ctx, 'Q1', 3),
        amendHolds(ctx, 'Q1', 2),
      ]);
      if (results.filter((x) => x.status === 'fulfilled').length !== 1)
        console.log(
          'AMEND_RACE',
          JSON.stringify(
            results.map((x) =>
              x.status === 'fulfilled' ? 'ok' : String((x as PromiseRejectedResult).reason),
            ),
          ),
        );
      expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      await consistent();
    });

    it('cancel releases held and confirmed bookings and allows a new hold', async () => {
      await acquireHolds(ctx, req('H', 3));
      await acquireHolds(ctx, req('C', 4));
      await confirmHolds(ctx, 'C');
      expect((await cancelHolds(ctx, 'H')).released).toBe(true);
      expect((await cancelHolds(ctx, 'C')).released).toBe(true);
      expect(await counters()).toEqual([
        [10, 0, 0],
        [10, 0, 0],
      ]);
      expect(await cancelHolds(ctx, 'C')).toEqual({ released: false, lines: [] });
      await acquireHolds(ctx, req('C', 2));
      await consistent();
    });

    it('extend moves the expiry of held lines only', async () => {
      await acquireHolds(ctx, req('Q1', 2));
      await extendHolds(ctx, 'Q1', '2026-10-22T04:30:00.000Z');
      expect((await getHoldLines(ctx, 'Q1')).map((l) => l.expires_at)).toEqual([
        '2026-10-22T04:30:00.000Z',
        '2026-10-22T04:30:00.000Z',
      ]);
      await confirmHolds(ctx, 'Q1');
      await expect(extendHolds(ctx, 'Q1', '2026-10-23T04:30:00.000Z')).rejects.toBeInstanceOf(
        NotHeldError,
      );
    });
  });
});
