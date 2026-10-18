import { checkLedger, nightKey, type LedgerDrift, bookingUnits } from '@c32/core';
import { readLedgerState } from '../data/ledger.js';
import { listDueQuoteIds } from '../data/quotes.js';
import type { FileStore } from '../files/store.js';
import type { ServiceDeps } from './create-quote.js';
import { expireQuote } from './expire-quote.js';

/**
 * Background jobs (blueprint 5.7, 13.2, T1.13). Expiry correctness never depends on them:
 * confirm, approve, extend and cancel all expire lazily and authoritatively. These jobs give
 * held rooms back promptly and check the ledger.
 */

export interface SweepResult {
  due: number;
  expired: number;
  /** Already expired or changed by someone else (the scheduler, a confirm): not an error. */
  skipped: number;
}

/** Expire every open quote past valid_until (the 15-minute sweeper). Exactly once per quote. */
export async function sweepExpired(deps: ServiceDeps, limit = 200): Promise<SweepResult> {
  const nowIso = new Date(deps.clock.now()).toISOString();
  const ids = await listDueQuoteIds(deps.data, nowIso, limit);
  let expired = 0;
  for (const id of ids) {
    const r = await expireQuote(deps, id);
    if (r.expired) expired++;
  }
  return { due: ids.length, expired, skipped: ids.length - expired };
}

export interface ReconciliationReport {
  checked_at: string;
  property_id: string;
  nights: number;
  bookings: number;
  consistent: boolean;
  drift: LedgerDrift[];
  /** What each drifting night's counters would be if the hold lines are right. Not applied. */
  suggested: {
    key: string;
    held_units: number;
    confirmed_units: number;
    available_units: number | null;
  }[];
}

/**
 * Nightly reconciliation (blueprint 13.2): recompute held and confirmed per night from the hold
 * lines and compare with the inventory counters (BR-15). Drift is reported, with suggested
 * counters, and never auto-repaired: a person decides. The report is saved when a file store
 * is configured.
 */
export async function reconcile(
  deps: ServiceDeps,
  files?: FileStore,
): Promise<ReconciliationReport> {
  const nowMs = deps.clock.now();
  const ledger = await readLedgerState(deps.data);
  const drift = checkLedger(ledger);

  const held = new Map<string, number>();
  const confirmed = new Map<string, number>();
  for (const b of ledger.bookings.values()) {
    for (const date of b.dates) {
      const key = nightKey(b.room_type, date);
      const target = b.state === 'held' ? held : confirmed;
      target.set(key, (target.get(key) ?? 0) + bookingUnits(b, date));
    }
  }
  const drifting = [...new Set(drift.map((d) => d.key))].sort();
  const suggested = drifting.map((key) => {
    const n = ledger.nights.get(key);
    const h = held.get(key) ?? 0;
    const c = confirmed.get(key) ?? 0;
    return {
      key,
      held_units: h,
      confirmed_units: c,
      available_units: n?.total_units == null ? null : n.total_units - h - c,
    };
  });

  const report: ReconciliationReport = {
    checked_at: new Date(nowMs).toISOString(),
    property_id: deps.data.propertyId,
    nights: ledger.nights.size,
    bookings: ledger.bookings.size,
    consistent: drift.length === 0,
    drift,
    suggested,
  };
  if (files) {
    const stamp = report.checked_at.replace(/[:.]/g, '-');
    await files.put(
      `reports/reconcile-${stamp}.json`,
      JSON.stringify(report, null, 2),
      'application/json',
    );
  }
  return report;
}
