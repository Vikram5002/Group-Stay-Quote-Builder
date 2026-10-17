import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { afterEach, describe, expect, it } from 'vitest';
import { getInventory } from '../../src/data/catalog.js';
import { getHoldLines } from '../../src/data/holds.js';
import { getEvents, getQuote } from '../../src/data/quotes.js';
import { keys } from '../../src/data/table.js';
import { MemoryFileStore } from '../../src/files/store.js';
import { extendQuote } from '../../src/services/changes.js';
import { confirmQuote } from '../../src/services/confirm-quote.js';
import { createQuote } from '../../src/services/create-quote.js';
import { atExpression, scheduleName, type ExpiryScheduler } from '../../src/services/scheduler.js';
import { reconcile, sweepExpired } from '../../src/services/worker.js';
import { handleWorkerEvent } from '../../src/worker-events.js';
import { hasDb } from '../data/local-db.js';
import { request, sales, serviceHarness } from './harness.js';

process.env['LOG_SILENT'] = '1';

class RecordingScheduler implements ExpiryScheduler {
  calls: [string, string][] = [];
  fail = false;
  async schedule(quoteId: string, at: string) {
    if (this.fail) throw new Error('scheduler down');
    this.calls.push([quoteId, at]);
  }
}

describe('schedule helpers', () => {
  it('formats EventBridge one-time expressions in UTC and names schedules per quote', () => {
    expect(atExpression('2026-10-20T04:30:00.000Z')).toBe('at(2026-10-20T04:30:00)');
    expect(atExpression('2026-10-20T10:00:00+05:30')).toBe('at(2026-10-20T04:30:00)');
    expect(() => atExpression('soon')).toThrow(RangeError);
    expect(scheduleName('01ABC')).toBe('c32-expire-01ABC');
  });
});

describe.skipIf(!hasDb)('expiry worker and reconciliation (DynamoDB Local)', () => {
  let drop: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await drop?.();
    drop = undefined;
  });
  async function setup() {
    const h = await serviceHarness();
    drop = h.drop;
    const scheduler = new RecordingScheduler();
    const deps = { ...h.deps, scheduler };
    return { ...h, deps, scheduler };
  }
  const available = async (h: Awaited<ReturnType<typeof setup>>) =>
    (await getInventory(h.ctx, 'standard', '2026-11-01', '2026-11-02')).map(
      (n) => n.available_units,
    );

  it('schedules expiry when a quote holds rooms and moves it on extend; declines get none', async () => {
    const h = await setup();
    const q = await createQuote(h.deps, request({ rooms: 4 }), sales);
    expect(h.scheduler.calls).toEqual([[q.quote_id, '2026-10-20T04:30:00.000Z']]);
    await extendQuote(h.deps, q.quote_id, sales, 24);
    expect(h.scheduler.calls.at(-1)).toEqual([q.quote_id, '2026-10-21T04:30:00.000Z']);
    await createQuote(h.deps, request({ room_type: 'deluxe' }), sales); // declined
    expect(h.scheduler.calls).toHaveLength(2);
  });

  it('a scheduler outage never fails the quote (the sweeper heals it)', async () => {
    const h = await setup();
    h.scheduler.fail = true;
    const q = await createQuote(h.deps, request({ rooms: 4 }), sales);
    expect(await getQuote(h.ctx, q.quote_id)).toEqual(q); // saved, with its holds
    expect(await getHoldLines(h.ctx, q.quote_id)).toHaveLength(2);
    h.clock.advance({ hours: 72 });
    expect(await sweepExpired(h.deps)).toEqual({ due: 1, expired: 1, skipped: 0 });
    expect(await available(h)).toEqual([10, 10]);
  });

  it('the sweeper expires only open quotes that are due', async () => {
    const h = await setup();
    // At the floor rate, so 2-, 7- and 1-room quotes are all clean offers.
    const early = await createQuote(h.deps, request({ rooms: 2 }), sales);
    const confirmed = await createQuote(h.deps, request({ rooms: 7 }), sales);
    await confirmQuote(h.deps, confirmed.quote_id, sales);
    h.clock.advance({ hours: 1 });
    const later = await createQuote(h.deps, request({ rooms: 1 }), sales);

    expect(await sweepExpired(h.deps)).toEqual({ due: 0, expired: 0, skipped: 0 });
    h.clock.advance({ hours: 71 }); // early is due, later is 1 hour short
    expect(await sweepExpired(h.deps)).toEqual({ due: 1, expired: 1, skipped: 0 });
    expect((await getQuote(h.ctx, early.quote_id))?.status).toBe('EXPIRED');
    expect((await getQuote(h.ctx, later.quote_id))?.status).not.toBe('EXPIRED');
    expect((await getQuote(h.ctx, confirmed.quote_id))?.status).toBe('CONFIRMED');
  });

  it('done when: the scheduler event and the sweeper racing release the rooms exactly once', async () => {
    const h = await setup();
    const q = await createQuote(h.deps, request({ rooms: 10 }), sales);
    h.clock.advance({ hours: 72 });
    await Promise.all([
      handleWorkerEvent(h.deps, null, { type: 'expire', quote_id: q.quote_id }),
      handleWorkerEvent(h.deps, null, { type: 'sweep' }),
      handleWorkerEvent(h.deps, null, { type: 'expire', quote_id: q.quote_id }),
      handleWorkerEvent(h.deps, null, { type: 'sweep' }),
    ]);
    expect(await available(h)).toEqual([10, 10]);
    expect(await getHoldLines(h.ctx, q.quote_id)).toEqual([]);
    expect((await getEvents(h.ctx, q.quote_id)).filter((e) => e.type === 'EXPIRED')).toHaveLength(
      1,
    );
    expect(await handleWorkerEvent(h.deps, null, { type: 'reconcile' })).toEqual({
      consistent: true,
      drift: 0,
    });
  });

  it('done when: reconciliation reports zero drift on the seeded dataset after real activity', async () => {
    const h = await setup();
    const files = new MemoryFileStore();
    const a = await createQuote(h.deps, request({ rooms: 9 }), sales);
    await confirmQuote(h.deps, a.quote_id, sales);
    await createQuote(h.deps, request({ rooms: 1 }), sales);
    const r = await reconcile(h.deps, files);
    expect(r).toMatchObject({ consistent: true, drift: [], suggested: [], nights: 2, bookings: 2 });
    const saved = await files.list('reports/');
    expect(saved).toHaveLength(1);
    expect(JSON.parse((await files.get(saved[0]!))!.toString())).toMatchObject({
      consistent: true,
    });
  });

  it('reconciliation detects drift and suggests counters, without repairing anything', async () => {
    const h = await setup();
    await createQuote(h.deps, request({ rooms: 4 }), sales);
    // Corrupt one night behind the system's back.
    await h.ctx.doc.send(
      new UpdateCommand({
        TableName: h.ctx.tableName,
        Key: { PK: keys.property('p1'), SK: keys.inventory('standard', '2026-11-02') },
        UpdateExpression: 'SET held_units = :h, available_units = :a',
        ExpressionAttributeValues: { ':h': 5, ':a': 5 },
      }),
    );
    const r = await reconcile(h.deps);
    expect(r.consistent).toBe(false);
    expect(r.drift).toEqual([{ key: 'standard#2026-11-02', problem: 'held_units 5 != holds 4' }]);
    expect(r.suggested).toEqual([
      { key: 'standard#2026-11-02', held_units: 4, confirmed_units: 0, available_units: 6 },
    ]);
    expect(await available(h)).toEqual([6, 5]); // reported, not repaired
    expect(await handleWorkerEvent(h.deps, null, { type: 'reconcile' })).toEqual({
      consistent: false,
      drift: 1,
    });
  });

  it('unknown or malformed events throw so they reach the dead-letter queue', async () => {
    const h = await setup();
    await expect(handleWorkerEvent(h.deps, null, { type: 'nope' })).rejects.toThrow(
      /Unknown worker event/,
    );
    await expect(handleWorkerEvent(h.deps, null, null)).rejects.toThrow();
    await expect(handleWorkerEvent(h.deps, null, { type: 'expire' })).rejects.toThrow(/quote_id/);
  });
});
