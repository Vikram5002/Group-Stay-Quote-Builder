import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import {
  INITIAL_STATUS,
  evaluate,
  type Actor,
  type Clock,
  type Quote,
  type QuoteEvent,
  type ResolvedQuoteRequest,
  roomsByNight,
} from '@c32/core';
import type { DataContext } from '../data/catalog.js';
import { ContentionError, HoldConflictError } from '../data/errors.js';
import { acquireHolds } from '../data/holds.js';
import { putEventTx, putNewQuoteTx } from '../data/quotes.js';
import { loadPolicy, loadStay, refusePastCheckIn } from './inputs.js';
import { scheduleQuietly, type ExpiryScheduler } from './scheduler.js';
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
  /** Per-quote expiry schedules (EventBridge Scheduler in AWS); none locally. */
  scheduler?: ExpiryScheduler;
}

const MAX_ATTEMPTS = 4;
const RETRYABLE = new Set(['INSUFFICIENT', 'NO_INVENTORY_DATA', 'UNKNOWN_AVAILABILITY']);

/** The stored request keeps one canonical stay form: check-in and nights. */
function storedRequest(r: ResolvedQuoteRequest): Quote['request'] {
  // `lines` is the engine's working view of stay + additional_lines; it is not stored.
  const { lines: _lines, ...rest } = r;
  return { ...rest, stay: { check_in: r.stay.check_in, nights: r.stay.nights } };
}

export async function createQuote(
  deps: ServiceDeps,
  request: ResolvedQuoteRequest,
  actor: Actor,
): Promise<Quote> {
  const { data } = deps;
  const quoteId = deps.newId();
  const policy = await loadPolicy(data);
  refusePastCheckIn(request, policy, deps.clock.now());

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { inventory, ratePlan } = await loadStay(data, request);
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
          ...holdShape(request, evaluation.offered_rooms),
          expiresAt: validity.valid_until,
        },
        writes,
      );
      await scheduleQuietly(deps.scheduler, quoteId, quote.valid_until);
      return quote;
    } catch (err) {
      if (err instanceof HoldConflictError && RETRYABLE.has(err.reason)) continue;
      throw err;
    }
  }
  throw new ContentionError(MAX_ATTEMPTS);
}

/**
 * Nights and rooms to hold. One line: the offered rooms on every night of the stay (a partial
 * offer holds fewer). Several lines (D-058): each night holds the sum of the lines covering it.
 */
function holdShape(request: ResolvedQuoteRequest, offeredRooms: number) {
  if (request.lines.length === 1) {
    return { dates: request.stay.night_dates, units: offeredRooms };
  }
  const demand = roomsByNight(request.lines);
  return {
    dates: [...demand.keys()].sort(),
    units: Math.max(...demand.values()),
    unitsByDate: Object.fromEntries(demand),
  };
}
