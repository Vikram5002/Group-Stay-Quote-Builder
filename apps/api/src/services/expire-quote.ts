import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { isExpired, type Actor, type Quote, type QuoteEvent } from '@c32/core';
import { TransactionConditionError } from '../data/errors.js';
import { releaseHolds } from '../data/holds.js';
import { getQuote, putEventTx, replaceQuoteTx } from '../data/quotes.js';
import type { ServiceDeps } from './create-quote.js';

/**
 * Expire a quote whose valid_until has passed (blueprint 5.7, BR-09, BR-14): mark it EXPIRED,
 * release its holds and append an EXPIRED event, all in one transaction. Used lazily by confirm
 * (410 QUOTE_EXPIRED) and by the expiry worker and sweeper (T1.13). Safe to call any number of
 * times from anywhere: only one call changes anything.
 */

export const SYSTEM_ACTOR: Actor = { user_id: 'system:expiry', role: 'Owner' };

export type ExpireResult =
  | { expired: true; quote: Quote }
  | { expired: false; reason: 'NOT_FOUND' | 'NOT_OPEN' | 'NOT_DUE'; quote: Quote | null };

export async function expireQuote(deps: ServiceDeps, quoteId: string): Promise<ExpireResult> {
  const quote = await getQuote(deps.data, quoteId);
  if (!quote) return { expired: false, reason: 'NOT_FOUND', quote: null };
  if (quote.status !== 'OFFERED' && quote.status !== 'PENDING_REVIEW') {
    return { expired: false, reason: 'NOT_OPEN', quote };
  }
  const nowMs = deps.clock.now();
  if (quote.valid_until === null || !isExpired(quote.valid_until, nowMs)) {
    return { expired: false, reason: 'NOT_DUE', quote };
  }

  const at = new Date(nowMs).toISOString();
  const next: Quote = { ...quote, status: 'EXPIRED', version: quote.version + 1, updated_at: at };
  const event: QuoteEvent = {
    event_id: deps.newId(),
    quote_id: quoteId,
    type: 'EXPIRED',
    actor: SYSTEM_ACTOR,
    at,
    before: { status: quote.status },
    after: { status: 'EXPIRED' },
    reason: `valid_until ${quote.valid_until} passed`,
  };
  const writes = [
    replaceQuoteTx(deps.data, next, quote.version, quote.status),
    putEventTx(deps.data, event),
  ];

  try {
    const released = await releaseHolds(deps.data, quoteId, writes);
    if (!released.released) {
      // No holds (unknown availability): just close the quote.
      await deps.data.doc.send(new TransactWriteCommand({ TransactItems: writes }));
    }
  } catch (err) {
    // Someone else expired, confirmed or changed it first: re-read and report.
    if (err instanceof TransactionConditionError || isConditionalFailure(err)) {
      const now = await getQuote(deps.data, quoteId);
      return { expired: false, reason: 'NOT_OPEN', quote: now };
    }
    throw err;
  }
  return { expired: true, quote: next };
}

function isConditionalFailure(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name: string }).name === 'TransactionCanceledException'
  );
}
