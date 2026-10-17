import { checkLedger } from '@c32/core';
import { afterEach, describe, expect, it } from 'vitest';
import { getInventory } from '../../src/data/catalog.js';
import { getHoldLines } from '../../src/data/holds.js';
import { getEvents, getQuote } from '../../src/data/quotes.js';
import { amendQuote, cancelQuote, extendQuote } from '../../src/services/changes.js';
import { confirmQuote } from '../../src/services/confirm-quote.js';
import { createQuote } from '../../src/services/create-quote.js';
import { approveQuote } from '../../src/services/review.js';
import { ServiceError } from '../../src/services/errors.js';
import { hasDb, readLedger } from '../data/local-db.js';
import { owner, request, sales, serviceHarness } from './harness.js';

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => (e instanceof ServiceError ? e.code : String(e)),
  );

describe.skipIf(!hasDb)('amend, cancel and extend (DynamoDB Local)', () => {
  let drop: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await drop?.();
    drop = undefined;
  });
  async function setup() {
    const h = await serviceHarness();
    drop = h.drop;
    return h;
  }
  const counters = async (h: Awaited<ReturnType<typeof setup>>) =>
    (await getInventory(h.ctx, 'standard', '2026-11-01', '2026-11-02')).map((n) => [
      n.available_units,
      n.held_units,
      n.confirmed_units,
    ]);
  async function confirmed(h: Awaited<ReturnType<typeof setup>>, rooms = 10) {
    const q = await createQuote(h.deps, request({ rooms }), sales);
    return confirmQuote(h.deps, q.quote_id, sales);
  }

  /** 10 rooms at 1800 (below the 2000 floor rate), approved by the owner, then confirmed. */
  async function confirmedDiscount(h: Awaited<ReturnType<typeof setup>>) {
    const q = await createQuote(h.deps, request({ rate_per_room_night_inr: 1800 }), sales);
    await approveQuote(h.deps, q.quote_id, owner, 'Long-standing corporate client');
    return confirmQuote(h.deps, q.quote_id, sales);
  }

  describe('T20 partial cancellation 10 to 7', () => {
    it('at the floor rate: 6 room-nights released, contribution 16800 still meets the floor', async () => {
      const h = await setup();
      const c = await confirmed(h);
      const a = await amendQuote(h.deps, c.quote_id, sales, 7, 'Three guests dropped out');

      expect(a).toMatchObject({ status: 'CONFIRMED', version: 3, review_required: false });
      expect(a.evaluation.offered_rooms).toBe(7);
      expect(a.evaluation.totals).toMatchObject({
        room_nights: 14,
        contribution_inr: 16800,
        contribution_floor_inr: 16800,
      });
      expect(a.evaluation.reasons).toEqual([]);
      expect(a.terms_hash).not.toBe(c.terms_hash);
      expect(a.evaluation.trail.at(-2)).toBe('amended 10 to 7 rooms: 6 room-nights released');

      expect(await counters(h)).toEqual([
        [3, 0, 7],
        [3, 0, 7],
      ]);
      expect(await getQuote(h.ctx, c.quote_id)).toEqual(a);
      const events = await getEvents(h.ctx, c.quote_id);
      expect(events.at(-1)).toMatchObject({
        type: 'AMENDED',
        reason: 'Three guests dropped out',
        before: { rooms: 10, contribution_inr: 24000 },
        after: { rooms: 7, contribution_inr: 16800, review_required: false },
      });
      expect(checkLedger(await readLedger(h.ctx))).toEqual([]);
    });

    it('a booking approved below the floor rate is flagged for owner review after amending', async () => {
      const h = await setup();
      const c = await confirmedDiscount(h);
      const a = await amendQuote(h.deps, c.quote_id, sales, 7, null);
      expect(a.review_required).toBe(true);
      expect(a.evaluation.reasons).toEqual(['FLOOR_BREACH']);
      expect(a.evaluation.trail.at(-1)).toBe(
        'remaining contribution 14000 < 16800 floor, shortfall 2800: owner review',
      );
      // Rooms are released first even so (BR-16).
      expect(await counters(h)).toEqual([
        [3, 0, 7],
        [3, 0, 7],
      ]);
    });
  });

  it('amend only reduces rooms, only on a CONFIRMED booking', async () => {
    const h = await setup();
    const open = await createQuote(h.deps, request(), sales);
    expect(await codeOf(amendQuote(h.deps, open.quote_id, sales, 5, null))).toBe('INVALID_STATE');
    const c = await confirmQuote(h.deps, open.quote_id, sales);
    expect(await codeOf(amendQuote(h.deps, c.quote_id, sales, 10, null))).toBe('INVALID_STATE');
    expect(await codeOf(amendQuote(h.deps, c.quote_id, sales, 12, null))).toBe('INVALID_STATE');
    expect(await codeOf(amendQuote(h.deps, '01JZZZZZZZZZZZZZZZZZZZZZZZ', sales, 1, null))).toBe(
      'NOT_FOUND',
    );
  });

  describe('cancel', () => {
    it('a confirmed booking: every room comes back', async () => {
      const h = await setup();
      const c = await confirmed(h);
      const x = await cancelQuote(h.deps, c.quote_id, sales, 'Event called off');
      expect(x).toMatchObject({ status: 'CANCELLED', version: 3 });
      expect(await counters(h)).toEqual([
        [10, 0, 0],
        [10, 0, 0],
      ]);
      expect((await getEvents(h.ctx, c.quote_id)).at(-1)).toMatchObject({
        type: 'CANCELLED',
        reason: 'Event called off',
      });
      expect(await codeOf(cancelQuote(h.deps, c.quote_id, sales, null))).toBe('INVALID_STATE');
    });

    it('an open offer or review: holds released', async () => {
      const h = await setup();
      const q = await createQuote(h.deps, request({ rate_per_room_night_inr: 1500 }), sales);
      await cancelQuote(h.deps, q.quote_id, sales, null);
      expect(await getHoldLines(h.ctx, q.quote_id)).toEqual([]);
      expect(await counters(h)).toEqual([
        [10, 0, 0],
        [10, 0, 0],
      ]);
    });

    it('an expired open quote is expired instead (410)', async () => {
      const h = await setup();
      const q = await createQuote(h.deps, request(), sales);
      h.clock.advance({ hours: 72 });
      expect(await codeOf(cancelQuote(h.deps, q.quote_id, sales, null))).toBe('QUOTE_EXPIRED');
      expect((await getQuote(h.ctx, q.quote_id))?.status).toBe('EXPIRED');
    });

    it('declined quotes cannot be cancelled', async () => {
      const h = await setup();
      const d = await createQuote(h.deps, request({ room_type: 'deluxe' }), sales);
      expect(await codeOf(cancelQuote(h.deps, d.quote_id, sales, null))).toBe('INVALID_STATE');
    });
  });

  describe('extend', () => {
    it('moves valid_until and the hold expiry together', async () => {
      const h = await setup();
      const q = await createQuote(h.deps, request(), sales); // valid until 2026-10-20 04:30Z
      const e = await extendQuote(h.deps, q.quote_id, sales, 48);
      expect(e).toMatchObject({ valid_until: '2026-10-22T04:30:00.000Z', version: 2 });
      expect((await getHoldLines(h.ctx, q.quote_id)).map((l) => l.expires_at)).toEqual([
        '2026-10-22T04:30:00.000Z',
        '2026-10-22T04:30:00.000Z',
      ]);
      expect((await getEvents(h.ctx, q.quote_id)).at(-1)).toMatchObject({
        type: 'EXTENDED',
        after: { valid_until: '2026-10-22T04:30:00.000Z', hours: 48 },
      });
      // The extended quote is still confirmable after the original expiry.
      h.clock.advance({ hours: 80 });
      expect((await confirmQuote(h.deps, q.quote_id, sales)).status).toBe('CONFIRMED');
    });

    it('never past the stay cutoff, and at most one validity window per call', async () => {
      const h = await setup();
      const q = await createQuote(h.deps, request(), sales);
      // cutoff = 2026-11-01 00:00 IST - 24h = 2026-10-30 18:30Z; valid_until starts 10-20 04:30Z
      expect(await codeOf(extendQuote(h.deps, q.quote_id, sales, 73))).toBe('INVALID_STATE');
      await extendQuote(h.deps, q.quote_id, sales, 72); // 10-23 04:30Z
      await extendQuote(h.deps, q.quote_id, sales, 72); // 10-26 04:30Z
      await extendQuote(h.deps, q.quote_id, sales, 72); // 10-29 04:30Z
      expect(await codeOf(extendQuote(h.deps, q.quote_id, sales, 72))).toBe('INVALID_STATE');
      // Exactly up to the cutoff is allowed.
      expect((await extendQuote(h.deps, q.quote_id, sales, 38)).valid_until).toBe(
        '2026-10-30T18:30:00.000Z',
      );
      expect(await codeOf(extendQuote(h.deps, q.quote_id, sales, 1))).toBe('INVALID_STATE');
    });

    it('confirmed or expired quotes cannot be extended', async () => {
      const h = await setup();
      const c = await confirmed(h, 9); // 9 x 2 x 1200 = 21600 clears the floor
      expect(await codeOf(extendQuote(h.deps, c.quote_id, sales, 1))).toBe('INVALID_STATE');
      const q = await createQuote(h.deps, request({ rooms: 1 }), sales);
      h.clock.advance({ hours: 72 });
      expect(await codeOf(extendQuote(h.deps, q.quote_id, sales, 1))).toBe('QUOTE_EXPIRED');
    });
  });
});
