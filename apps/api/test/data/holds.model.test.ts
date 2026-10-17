import {
  checkLedger,
  confirm,
  createLedger,
  hold,
  release,
  stayNights,
  type LedgerState,
} from '@c32/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { putInventory } from '../../src/data/catalog.js';
import { acquireHolds, confirmHolds, releaseHolds } from '../../src/data/holds.js';
import { createTestTable, hasDb, night, readLedger } from './local-db.js';

/**
 * Model-based test (D-028): the DynamoDB repository and the pure ledger model in @c32/core must
 * agree after every step of a random sequence. Amend and cancel join in T1.11.
 */

const DATES = stayNights('2026-11-01', 4);

const op = fc.record({
  kind: fc.constantFrom('hold', 'release', 'confirm'),
  quote: fc.constantFrom('Q1', 'Q2', 'Q3'),
  units: fc.integer({ min: 1, max: 8 }),
  from: fc.nat(3),
  length: fc.integer({ min: 1, max: 4 }),
});

/** Compare counters and bookings, ignoring Map ordering. */
function snapshot(s: LedgerState) {
  return {
    nights: [...s.nights.entries()].sort(([a], [b]) => a.localeCompare(b)),
    bookings: [...s.bookings.values()]
      .map((b) => ({ ...b, dates: [...b.dates] }))
      .sort((a, b) => a.quote_id.localeCompare(b.quote_id)),
  };
}

describe.skipIf(!hasDb)('holds repository matches the core ledger model', () => {
  it('after every step of random hold, release and confirm sequences', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 0, max: 10 }), { minLength: 4, maxLength: 4 }),
        fc.array(op, { minLength: 1, maxLength: 12 }),
        async (totals, ops) => {
          const { ctx, drop } = await createTestTable();
          try {
            const inventory = DATES.map((d, i) => night(d, totals[i]!));
            await putInventory(ctx, inventory);
            let model = createLedger(inventory);

            for (const o of ops) {
              const dates = DATES.slice(o.from, o.from + o.length);
              let next;
              let dbOk: boolean;
              if (o.kind === 'hold') {
                next = hold(model, o.quote, 'standard', dates, o.units);
                dbOk = await acquireHolds(ctx, {
                  quoteId: o.quote,
                  roomType: 'standard',
                  dates,
                  units: o.units,
                  expiresAt: '2026-10-20T04:30:00.000Z',
                }).then(
                  () => true,
                  () => false,
                );
              } else if (o.kind === 'release') {
                next = release(model, o.quote);
                dbOk = (await releaseHolds(ctx, o.quote)).released;
              } else {
                next = confirm(model, o.quote);
                dbOk = await confirmHolds(ctx, o.quote).then(
                  () => true,
                  () => false,
                );
              }
              expect(dbOk).toBe(next.ok); // both accept or both refuse
              if (next.ok) model = next.state;

              const db = await readLedger(ctx);
              expect(snapshot(db)).toEqual(snapshot(model));
              expect(checkLedger(db)).toEqual([]);
            }
          } finally {
            await drop();
          }
        },
      ),
      { numRuns: 25 },
    );
  }, 120_000);
});
