import { isExpired, type Actor, type Quote, type QuoteEvent } from '@c32/core';
import { NotHeldError, TransactionConditionError } from '../data/errors.js';
import { confirmHolds } from '../data/holds.js';
import { getQuote, putEventTx, replaceQuoteTx } from '../data/quotes.js';
import type { ServiceDeps } from './create-quote.js';
import { ServiceError } from './errors.js';
import { expireQuote } from './expire-quote.js';

/**
 * Confirm a quote (BR-10). Allowed only when the quote is OFFERED, not expired, still holds its
 * rooms, and is either clean (a partial offer counts as clean) or carries an owner approval bound
 * to the current terms hash (BR-11). The quote update is conditioned on version, status and
 * valid_until inside the same transaction that moves the holds, so a concurrent change or an
 * expiry at the last millisecond cannot slip through.
 */

/** Reasons that never need an owner: a clean partial offer is confirmable. */
const CLEAN = new Set(['PARTIAL_AVAILABILITY']);

export function needsApproval(quote: Quote): boolean {
  const dirty = quote.evaluation.reasons.some((r) => !CLEAN.has(r));
  const approved = quote.approval !== null && quote.approval.terms_hash === quote.terms_hash;
  return dirty && !approved;
}

export async function confirmQuote(
  deps: ServiceDeps,
  quoteId: string,
  actor: Actor,
): Promise<Quote> {
  const quote = await getQuote(deps.data, quoteId);
  if (!quote) throw new ServiceError('NOT_FOUND', `Quote ${quoteId} not found`);

  const nowMs = deps.clock.now();
  if (
    (quote.status === 'OFFERED' || quote.status === 'PENDING_REVIEW') &&
    quote.valid_until !== null &&
    isExpired(quote.valid_until, nowMs)
  ) {
    await expireQuote(deps, quoteId); // releases the holds exactly once
    throw new ServiceError('QUOTE_EXPIRED', `Quote expired at ${quote.valid_until}`);
  }
  if (quote.status === 'PENDING_REVIEW') {
    throw new ServiceError(
      'APPROVAL_REQUIRED',
      'Service Manager approval is required before confirming',
    );
  }
  if (quote.status !== 'OFFERED') {
    throw new ServiceError('INVALID_STATE', `Cannot confirm a ${quote.status} quote`);
  }
  if (needsApproval(quote)) {
    throw new ServiceError(
      'APPROVAL_REQUIRED',
      'Service Manager approval is required before confirming',
    );
  }

  const at = new Date(nowMs).toISOString();
  const next: Quote = { ...quote, status: 'CONFIRMED', version: quote.version + 1, updated_at: at };
  const event: QuoteEvent = {
    event_id: deps.newId(),
    quote_id: quoteId,
    type: 'CONFIRMED',
    actor,
    at,
    before: { status: quote.status, version: quote.version },
    after: { status: 'CONFIRMED', version: next.version },
    reason: null,
  };

  try {
    await confirmHolds(deps.data, quoteId, [
      replaceQuoteTx(deps.data, next, quote.version, 'OFFERED', {
        condition: 'valid_until > :now',
        values: { ':now': at },
      }),
      putEventTx(deps.data, event),
    ]);
  } catch (err) {
    if (err instanceof NotHeldError) {
      throw new ServiceError('INVALID_STATE', 'This quote holds no rooms to confirm');
    }
    if (err instanceof TransactionConditionError) {
      // Changed by someone else, or expired at the last moment: report the current truth.
      const current = await getQuote(deps.data, quoteId);
      if (current?.status === 'CONFIRMED') {
        throw new ServiceError('INVALID_STATE', 'Quote is already confirmed');
      }
      throw new ServiceError('VERSION_CONFLICT', 'The quote changed; reload and try again');
    }
    throw err;
  }
  return next;
}
