import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import {
  amendTotals,
  isExpired,
  orderReasons,
  startOfDayUtc,
  validateQuoteRequest,
  type Actor,
  type Evaluation,
  type Quote,
  type QuoteEvent,
  type QuoteStatus,
} from '@c32/core';
import { NotHeldError, TransactionConditionError } from '../data/errors.js';
import { amendHolds, cancelHolds, extendHolds, getHoldLines } from '../data/holds.js';
import { getQuote, putEventTx, replaceQuoteTx } from '../data/quotes.js';
import type { ServiceDeps } from './create-quote.js';
import { ServiceError } from './errors.js';
import { expireQuote } from './expire-quote.js';
import { loadPolicy } from './inputs.js';
import { scheduleQuietly } from './scheduler.js';
import { termsHash } from './terms-hash.js';

/**
 * Changes to an existing quote (FR-14, BR-16): partial cancellation (amend), extend validity,
 * and full cancellation. Each is one transaction: holds, quote and audit event together.
 */

const H = 3_600_000;
const OPEN: ReadonlySet<QuoteStatus> = new Set(['OFFERED', 'PENDING_REVIEW']);

async function load(deps: ServiceDeps, quoteId: string): Promise<Quote> {
  const quote = await getQuote(deps.data, quoteId);
  if (!quote) throw new ServiceError('NOT_FOUND', `Quote ${quoteId} not found`);
  return quote;
}

/** An open quote past valid_until is expired on the spot (holds released) and the call is 410. */
async function refuseIfExpired(deps: ServiceDeps, quote: Quote): Promise<void> {
  if (
    OPEN.has(quote.status) &&
    quote.valid_until !== null &&
    isExpired(quote.valid_until, deps.clock.now())
  ) {
    await expireQuote(deps, quote.quote_id);
    throw new ServiceError('QUOTE_EXPIRED', `Quote expired at ${quote.valid_until}`);
  }
}

async function guarded(deps: ServiceDeps, quoteId: string, run: () => Promise<unknown>) {
  try {
    await run();
  } catch (err) {
    if (err instanceof NotHeldError)
      throw new ServiceError('INVALID_STATE', 'This quote holds no such rooms');
    if (err instanceof TransactionConditionError) {
      const now = await getQuote(deps.data, quoteId);
      throw new ServiceError(
        'VERSION_CONFLICT',
        `Quote changed meanwhile (now ${now?.status ?? 'missing'})`,
      );
    }
    throw err;
  }
}

function event(
  deps: ServiceDeps,
  quoteId: string,
  type: QuoteEvent['type'],
  actor: Actor,
  at: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  reason: string | null,
): QuoteEvent {
  return { event_id: deps.newId(), quote_id: quoteId, type, actor, at, before, after, reason };
}

/**
 * Partial cancellation of a CONFIRMED booking. Rooms are always released (a cancellation is never
 * blocked); the remaining booking is re-checked against the current floor and, if it now falls
 * short, `review_required` is set for the owner. The terms hash is recomputed (BR-11).
 */
export async function amendQuote(
  deps: ServiceDeps,
  quoteId: string,
  actor: Actor,
  rooms: number,
  reason: string | null,
): Promise<Quote> {
  const quote = await load(deps, quoteId);
  if (quote.status !== 'CONFIRMED') {
    throw new ServiceError(
      'INVALID_STATE',
      `Only a CONFIRMED booking can be amended, not ${quote.status}`,
    );
  }
  const current = quote.evaluation.offered_rooms;
  if (rooms >= current) {
    throw new ServiceError('INVALID_STATE', `An amendment must reduce rooms below ${current}`);
  }

  const policy = await loadPolicy(deps.data);
  const amended = amendTotals(quote.evaluation.totals, current, rooms, policy);
  const reasons = orderReasons([
    ...quote.evaluation.reasons.filter((r) => r !== 'FLOOR_BREACH'),
    ...(amended.floor_ok === false ? (['FLOOR_BREACH'] as const) : []),
  ]);
  const evaluation: Evaluation = {
    ...quote.evaluation,
    offered_rooms: rooms,
    shortfall_rooms: quote.evaluation.requested_rooms - rooms,
    totals: amended.totals,
    reasons,
    auto_confirm_allowed: false,
    counter_offers: [],
    trail: [...quote.evaluation.trail, ...amended.trail],
  };
  const resolved = validateQuoteRequest(quote.request);
  if (!resolved.ok) throw new Error(`Stored request for ${quoteId} no longer validates`);

  const at = new Date(deps.clock.now()).toISOString();
  const next: Quote = {
    ...quote,
    version: quote.version + 1,
    updated_at: at,
    evaluation,
    terms_hash: termsHash(resolved.value, evaluation),
    review_required: amended.floor_ok === false,
  };
  const e = event(
    deps,
    quoteId,
    'AMENDED',
    actor,
    at,
    { rooms: current, contribution_inr: quote.evaluation.totals.contribution_inr },
    {
      rooms,
      contribution_inr: amended.totals.contribution_inr,
      review_required: next.review_required,
    },
    reason,
  );

  await guarded(deps, quoteId, () =>
    amendHolds(deps.data, quoteId, rooms, [
      replaceQuoteTx(deps.data, next, quote.version, 'CONFIRMED'),
      putEventTx(deps.data, e),
    ]),
  );
  return next;
}

/** Full cancellation from OFFERED, PENDING_REVIEW or CONFIRMED; every held room comes back. */
export async function cancelQuote(
  deps: ServiceDeps,
  quoteId: string,
  actor: Actor,
  reason: string | null,
): Promise<Quote> {
  const quote = await load(deps, quoteId);
  await refuseIfExpired(deps, quote);
  if (!OPEN.has(quote.status) && quote.status !== 'CONFIRMED') {
    throw new ServiceError('INVALID_STATE', `Cannot cancel a ${quote.status} quote`);
  }
  const at = new Date(deps.clock.now()).toISOString();
  const next: Quote = { ...quote, status: 'CANCELLED', version: quote.version + 1, updated_at: at };
  const writes = [
    replaceQuoteTx(deps.data, next, quote.version, quote.status),
    putEventTx(
      deps.data,
      event(
        deps,
        quoteId,
        'CANCELLED',
        actor,
        at,
        { status: quote.status },
        { status: 'CANCELLED' },
        reason,
      ),
    ),
  ];
  await guarded(deps, quoteId, async () => {
    const released = await cancelHolds(deps.data, quoteId, writes);
    if (!released.released)
      await deps.data.doc.send(new TransactWriteCommand({ TransactItems: writes }));
  });
  return next;
}

/**
 * Extend an open quote's validity by `hours`, within policy: at most one validity window per
 * call, and never past the stay cutoff. Its held lines move to the new expiry in the same write.
 */
export async function extendQuote(
  deps: ServiceDeps,
  quoteId: string,
  actor: Actor,
  hours: number,
): Promise<Quote> {
  const quote = await load(deps, quoteId);
  await refuseIfExpired(deps, quote);
  if (!OPEN.has(quote.status) || quote.valid_until === null) {
    throw new ServiceError(
      'INVALID_STATE',
      `Only an open quote can be extended, not ${quote.status}`,
    );
  }
  const policy = await loadPolicy(deps.data);
  if (hours > policy.validity_hours) {
    throw new ServiceError(
      'INVALID_STATE',
      `An extension can be at most ${policy.validity_hours} hours`,
    );
  }
  const cutoffMs =
    startOfDayUtc(quote.request.stay.check_in, policy.timezone) - policy.stay_cutoff_hours * H;
  const untilMs = Date.parse(quote.valid_until) + hours * H;
  if (untilMs > cutoffMs) {
    throw new ServiceError(
      'INVALID_STATE',
      `The quote cannot stay open past the stay cutoff ${new Date(cutoffMs).toISOString()}`,
    );
  }

  const at = new Date(deps.clock.now()).toISOString();
  const validUntil = new Date(untilMs).toISOString();
  const next: Quote = {
    ...quote,
    valid_until: validUntil,
    version: quote.version + 1,
    updated_at: at,
  };
  const writes = [
    replaceQuoteTx(deps.data, next, quote.version, quote.status, {
      condition: 'valid_until > :now',
      values: { ':now': at },
    }),
    putEventTx(
      deps.data,
      event(
        deps,
        quoteId,
        'EXTENDED',
        actor,
        at,
        { valid_until: quote.valid_until },
        { valid_until: validUntil, hours },
        null,
      ),
    ),
  ];
  const held = (await getHoldLines(deps.data, quoteId)).some((l) => l.state === 'held');
  await guarded(deps, quoteId, () =>
    held
      ? extendHolds(deps.data, quoteId, validUntil, writes)
      : deps.data.doc.send(new TransactWriteCommand({ TransactItems: writes })),
  );
  await scheduleQuietly(deps.scheduler, quoteId, validUntil);
  return next;
}
