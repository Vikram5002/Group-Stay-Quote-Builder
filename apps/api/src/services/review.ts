import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import {
  isExpired,
  ownerDiscountTotals,
  validateQuoteRequest,
  type Actor,
  type Quote,
  type QuoteEvent,
} from '@c32/core';
import { TransactionConditionError } from '../data/errors.js';
import { releaseHolds } from '../data/holds.js';
import { getQuote, putEventTx, replaceQuoteTx } from '../data/quotes.js';
import type { ServiceDeps } from './create-quote.js';
import { ServiceError } from './errors.js';
import { expireQuote } from './expire-quote.js';
import { loadPolicy } from './inputs.js';
import { termsHash } from './terms-hash.js';

/**
 * The owner's review queue (FR-11, BR-11, BR-12, US-06).
 *
 * approve: PENDING_REVIEW -> OFFERED with an approval that records who, when, why and the terms
 *          hash. Confirm accepts the approval only while the quote's terms hash still equals it,
 *          so any later change to rooms, dates, rate or inclusions invalidates it (T17).
 * reject:  PENDING_REVIEW -> REJECTED and the holds go back to inventory.
 *
 * Four-eyes: the approver must be a Service Manager (route) and must not be the quote's creator (here).
 */

async function openForReview(deps: ServiceDeps, quoteId: string): Promise<Quote> {
  const quote = await getQuote(deps.data, quoteId);
  if (!quote) throw new ServiceError('NOT_FOUND', `Quote ${quoteId} not found`);
  if (
    quote.status === 'PENDING_REVIEW' &&
    quote.valid_until !== null &&
    isExpired(quote.valid_until, deps.clock.now())
  ) {
    await expireQuote(deps, quoteId);
    throw new ServiceError('QUOTE_EXPIRED', `Quote expired at ${quote.valid_until}`);
  }
  if (quote.status !== 'PENDING_REVIEW') {
    throw new ServiceError(
      'INVALID_STATE',
      `Only a PENDING_REVIEW quote can be reviewed, not ${quote.status}`,
    );
  }
  return quote;
}

async function commit(deps: ServiceDeps, quoteId: string, run: () => Promise<unknown>) {
  try {
    await run();
  } catch (err) {
    if (
      err instanceof TransactionConditionError ||
      (err as { name?: string }).name === 'TransactionCanceledException'
    ) {
      const now = await getQuote(deps.data, quoteId);
      throw new ServiceError(
        'VERSION_CONFLICT',
        `Quote changed while reviewing (now ${now?.status ?? 'missing'})`,
      );
    }
    throw err;
  }
}

export async function approveQuote(
  deps: ServiceDeps,
  quoteId: string,
  actor: Actor,
  reason: string,
): Promise<Quote> {
  if (actor.role !== 'ServiceManager')
    throw new ServiceError('FORBIDDEN', 'Only a Service Manager can approve');
  const quote = await openForReview(deps, quoteId);
  if (quote.created_by.user_id === actor.user_id) {
    throw new ServiceError('FORBIDDEN', 'Four-eyes rule: you cannot approve a quote you created');
  }
  if (quote.awaiting_owner) {
    throw new ServiceError(
      'INVALID_STATE',
      'This quote is waiting for the Owner to set the discount',
    );
  }
  if (quote.evaluation.reasons.includes('UNKNOWN_AVAILABILITY')) {
    throw new ServiceError(
      'INVALID_STATE',
      'Availability is unknown, so no rooms are held; fix the inventory and quote again',
    );
  }

  const at = new Date(deps.clock.now()).toISOString();
  const next: Quote = {
    ...quote,
    status: 'OFFERED',
    version: quote.version + 1,
    updated_at: at,
    approval: { approved_by: actor, approved_at: at, reason, terms_hash: quote.terms_hash },
  };
  const event: QuoteEvent = {
    event_id: deps.newId(),
    quote_id: quoteId,
    type: 'APPROVED',
    actor,
    at,
    before: { status: quote.status, version: quote.version },
    after: { status: 'OFFERED', version: next.version, terms_hash: quote.terms_hash },
    reason,
  };
  await commit(deps, quoteId, () =>
    deps.data.doc.send(
      new TransactWriteCommand({
        TransactItems: [
          replaceQuoteTx(deps.data, next, quote.version, 'PENDING_REVIEW', {
            condition: 'valid_until > :now',
            values: { ':now': at },
          }),
          putEventTx(deps.data, event),
        ],
      }),
    ),
  );
  return next;
}

export async function rejectQuote(
  deps: ServiceDeps,
  quoteId: string,
  actor: Actor,
  reason: string,
): Promise<Quote> {
  if (actor.role !== 'ServiceManager')
    throw new ServiceError('FORBIDDEN', 'Only a Service Manager can reject');
  const quote = await openForReview(deps, quoteId);

  const at = new Date(deps.clock.now()).toISOString();
  const next: Quote = { ...quote, status: 'REJECTED', version: quote.version + 1, updated_at: at };
  const event: QuoteEvent = {
    event_id: deps.newId(),
    quote_id: quoteId,
    type: 'REJECTED',
    actor,
    at,
    before: { status: quote.status, version: quote.version },
    after: { status: 'REJECTED', version: next.version },
    reason,
  };
  const writes = [
    replaceQuoteTx(deps.data, next, quote.version, 'PENDING_REVIEW'),
    putEventTx(deps.data, event),
  ];
  await commit(deps, quoteId, async () => {
    const released = await releaseHolds(deps.data, quoteId, writes);
    if (!released.released) {
      await deps.data.doc.send(new TransactWriteCommand({ TransactItems: writes }));
    }
  });
  return next;
}

/**
 * The Owner's discount (D-062): a quote the Service Manager sent to the Owner is re-priced at the
 * Owner's percent (any amount) and issued as OFFERED, with the Owner's approval bound to the new
 * terms so it can be confirmed. Holds are unchanged: the rooms do not change.
 */
export async function ownerDiscount(
  deps: ServiceDeps,
  quoteId: string,
  actor: Actor,
  discountPct: number,
  reason: string | null,
): Promise<Quote> {
  if (actor.role !== 'Owner')
    throw new ServiceError('FORBIDDEN', 'Only the Owner sets this discount');
  const quote = await openForReview(deps, quoteId);
  if (!quote.awaiting_owner) {
    throw new ServiceError('INVALID_STATE', 'This quote was not sent to the Owner');
  }
  const policy = await loadPolicy(deps.data);
  const priced = ownerDiscountTotals(quote.evaluation.totals, discountPct, policy);
  const { rate_per_room_night_inr: _rate, discount_inr: _inr, ...base } = quote.request;
  const request = { ...base, discount_pct: discountPct };
  const resolved = validateQuoteRequest(request);
  if (!resolved.ok) throw new Error(`Stored request for ${quoteId} no longer validates`);

  const evaluation = {
    ...quote.evaluation,
    decision:
      quote.evaluation.decision === 'PARTIAL_OFFER'
        ? ('PARTIAL_OFFER' as const)
        : ('OFFER' as const),
    reasons: quote.evaluation.reasons.filter((r) => r !== 'FLOOR_BREACH'),
    auto_confirm_allowed: false,
    totals: priced.totals,
    counter_offers: [],
    trail: [...quote.evaluation.trail, ...priced.trail],
  };
  const hash = termsHash(resolved.value, evaluation);
  const at = new Date(deps.clock.now()).toISOString();
  const why = reason ?? `Owner discount ${discountPct}%`;
  const { awaiting_owner: _waiting, ...rest } = quote;
  const next: Quote = {
    ...rest,
    status: 'OFFERED',
    version: quote.version + 1,
    updated_at: at,
    request,
    evaluation,
    terms_hash: hash,
    approval: { approved_by: actor, approved_at: at, reason: why, terms_hash: hash },
  };
  const event: QuoteEvent = {
    event_id: deps.newId(),
    quote_id: quoteId,
    type: 'OWNER_DISCOUNTED',
    actor,
    at,
    before: { status: quote.status, version: quote.version },
    after: {
      status: 'OFFERED',
      version: next.version,
      discount_pct: discountPct,
      room_revenue_inr: priced.totals.room_revenue_inr,
      terms_hash: hash,
    },
    reason: why,
  };
  await commit(deps, quoteId, () =>
    deps.data.doc.send(
      new TransactWriteCommand({
        TransactItems: [
          replaceQuoteTx(deps.data, next, quote.version, 'PENDING_REVIEW', {
            condition: 'valid_until > :now',
            values: { ':now': at },
          }),
          putEventTx(deps.data, event),
        ],
      }),
    ),
  );
  return next;
}
