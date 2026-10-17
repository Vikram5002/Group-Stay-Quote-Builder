import type { FileStore } from './files/store.js';
import { log, metric } from './log.js';
import type { ServiceDeps } from './services/create-quote.js';
import { expireQuote } from './services/expire-quote.js';
import type { ExpireEvent } from './services/scheduler.js';
import { reconcile, sweepExpired } from './services/worker.js';

/**
 * Worker Lambda (blueprint 7.2): one function, three triggers set up by Track 3.
 *   { type: 'expire', quote_id } - EventBridge Scheduler, one per quote at valid_until
 *   { type: 'sweep' }            - EventBridge rule every 15 minutes
 *   { type: 'reconcile' }        - EventBridge rule nightly
 * Every path is idempotent, so retries and races between them are safe. An unknown event
 * throws, so it lands in the dead-letter queue instead of being ignored.
 */
export type WorkerEvent = ExpireEvent | { type: 'sweep' } | { type: 'reconcile' };

export async function handleWorkerEvent(
  deps: ServiceDeps,
  files: FileStore | null,
  event: unknown,
): Promise<Record<string, unknown>> {
  const e = event as Partial<WorkerEvent> | null;
  switch (e?.type) {
    case 'expire': {
      if (typeof e.quote_id !== 'string') throw new Error('expire event without quote_id');
      const r = await expireQuote(deps, e.quote_id);
      if (r.expired) metric('ExpiredReleased', 1);
      log('info', 'expire_event', {
        quote_id: e.quote_id,
        expired: r.expired,
        ...(r.expired ? {} : { reason: r.reason }),
      });
      return { expired: r.expired };
    }
    case 'sweep': {
      const r = await sweepExpired(deps);
      metric('ExpiredReleased', r.expired);
      log('info', 'sweep', { ...r });
      return { ...r };
    }
    case 'reconcile': {
      const r = await reconcile(deps, files ?? undefined);
      metric('LedgerDrift', r.drift.length);
      if (r.consistent)
        log('info', 'reconcile', { nights: r.nights, bookings: r.bookings, consistent: true });
      else log('error', 'ledger_drift', { drift: r.drift, suggested: r.suggested });
      return { consistent: r.consistent, drift: r.drift.length };
    }
    default:
      throw new Error(`Unknown worker event: ${JSON.stringify(event)}`);
  }
}
