import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import {
  DEFAULT_POLICY,
  INITIAL_STATUS,
  evaluate,
  type Actor,
  type Clock,
  type Quote,
  type QuoteEvent,
  type ResolvedQuoteRequest,
} from '@c32/core';
import { getInventory, getRatePlan, type DataContext } from '../data/catalog.js';
import { ContentionError, HoldConflictError } from '../data/errors.js';
import { acquireHolds } from '../data/holds.js';
import { getPolicy } from '../data/policy.js';
import { putEventTx, putNewQuoteTx } from '../data/quotes.js';
import { termsHash } from './terms-hash.js';

/**
 * Create a quote (blueprint 6.2 step 8, FR-01 to FR-05). Evaluate, then commit the holds, the
 * quote and its audit event in ONE transaction. If another quote took the rooms in between,
 * the hold transaction fails as a whole; we re-read inventory and evaluate again, so the loser
 * of a race gets the right PARTIAL_OFFER or DECLINE instead of an error (T12).
 */

export interface ServiceDeps {
  data: DataContext;
  clock: Clock;
  /** ULID generator; injected so tests are deterministic. */
  newId: () => string;
}

const MAX_ATTEMPTS = 4;
const RETRYABLE = new Set(['INSUFFICIENT', 'NO_INVENTORY_DATA', 'UNKNOWN_AVAILABILITY']);

/** The stored request keeps one canonical stay form: check-in and nights. */
function storedRequest(r: ResolvedQuoteRequest): Quote['request'] {
  return { ...r, stay: { check_in: r.stay.check_in, nights: r.stay.nights } };
}

export async function createQuote(
  deps: ServiceDeps,
  request: ResolvedQuoteRequest,
  actor: Actor,
): Promise<Quote> {
  const { data } = deps;
  const quoteId = deps.newId();
  const policy = (await getPolicy(data)) ?? { ...DEFAULT_POLICY, property_id: data.propertyId };
  const first = request.stay.night_dates[0] as string;
  const last = request.stay.night_dates.at(-1) as string;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const [inventory, ratePlan] = await Promise.all([
      getInventory(data, request.room_type, first, last),
      getRatePlan(data, request.room_type, first, last),
    ]);
    const nowMs = deps.clock.now();
    const { evaluation, validity } = evaluate(request, { inventory, ratePlan, policy, nowMs });
    const declined = evaluation.decision === 'DECLINE';

    const quote: Quote = {
      quote_id: quoteId,
      property_id: data.propertyId,
      status: INITIAL_STATUS[evaluation.decision],
      version: 1,
      request: storedRequest(request),
      evaluation,
      terms_hash: termsHash(request, evaluation),
      issued_at: validity.issued_at,
      valid_until: declined ? null : validity.valid_until,
      created_by: actor,
      created_at: validity.issued_at,
      updated_at: validity.issued_at,
      approval: null,
      review_required: false,
    };
    const event: QuoteEvent = {
      event_id: deps.newId(),
      quote_id: quoteId,
      type: declined ? 'QUOTE_DECLINED' : 'QUOTE_CREATED',
      actor,
      at: validity.issued_at,
      before: null,
      after: {
        status: quote.status,
        decision: evaluation.decision,
        offered_rooms: evaluation.offered_rooms,
        reasons: evaluation.reasons,
      },
      reason: null,
    };
    const writes = [putNewQuoteTx(data, quote), putEventTx(data, event)];

    // Holds are taken for every non-declined quote whose availability is known, including
    // REVIEW, so an approved quote can still be confirmed (BR-10). Unknown availability: no hold.
    const takesHold =
      !declined &&
      evaluation.offered_rooms > 0 &&
      !evaluation.reasons.includes('UNKNOWN_AVAILABILITY');

    if (!takesHold) {
      await data.doc.send(new TransactWriteCommand({ TransactItems: writes }));
      return quote;
    }
    try {
      await acquireHolds(
        data,
        {
          quoteId,
          roomType: request.room_type,
          dates: request.stay.night_dates,
          units: evaluation.offered_rooms,
          expiresAt: validity.valid_until,
        },
        writes,
      );
      return quote;
    } catch (err) {
      if (err instanceof HoldConflictError && RETRYABLE.has(err.reason)) continue;
      throw err;
    }
  }
  throw new ContentionError(MAX_ATTEMPTS);
}
