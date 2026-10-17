import { z } from 'zod';
import { daysBetween } from '../domain/calendar.js';
import {
  CounterOfferType,
  Decision,
  InclusionBasis,
  QuoteStatus,
  ReasonCode,
  Role,
} from './codes.js';
import {
  Inr,
  Instant,
  IsoDate,
  LIMITS,
  NonEmptyText,
  Pct,
  PropertyId,
  RoomType,
  TermsHash,
  Ulid,
  UnitInr,
  Units,
} from './primitives.js';

// ---------------------------------------------------------------------------
// Request side
// ---------------------------------------------------------------------------

/**
 * A costed extra such as breakfast (blueprint 5.6).
 * per_guest_night units = rooms x guests_per_room x nights; per_room_night units = rooms x nights.
 * If included_in_rate is false and price_inr is set, it is charged separately and adds revenue.
 */
export const InclusionInput = z
  .strictObject({
    name: NonEmptyText(60),
    basis: InclusionBasis,
    unit_cost_inr: UnitInr.nullable(),
    included_in_rate: z.boolean(),
    price_inr: UnitInr.optional(),
  })
  .superRefine((inc, ctx) => {
    if (inc.included_in_rate && inc.price_inr !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['price_inr'],
        message: 'price_inr must be omitted when the inclusion is included in the rate',
        params: { code: 'INCONSISTENT' },
      });
    }
  });
export type InclusionInput = z.infer<typeof InclusionInput>;

export const Organiser = z.strictObject({
  name: NonEmptyText(120),
  reference: NonEmptyText(64).optional(),
});
export type Organiser = z.infer<typeof Organiser>;

/**
 * Stay dates. Give nights, check_out, or both (they must agree). nights is 1 to 28 (BR-02).
 * Refinement only: the derived night count is computed by the engine with the calendar helpers.
 */
export const Stay = z
  .strictObject({
    check_in: IsoDate,
    nights: z.int().min(LIMITS.MIN_NIGHTS).max(LIMITS.MAX_NIGHTS).optional(),
    check_out: IsoDate.optional(),
  })
  .superRefine((s, ctx) => {
    if (s.nights === undefined && s.check_out === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['nights'],
        message: 'Provide nights or check_out',
        params: { code: 'REQUIRED' },
      });
      return;
    }
    if (s.check_out === undefined) return;
    let span: number;
    try {
      span = daysBetween(s.check_in, s.check_out);
    } catch {
      return; // the date format issue is already reported on the field itself
    }
    if (span < LIMITS.MIN_NIGHTS) {
      ctx.addIssue({
        code: 'custom',
        path: ['check_out'],
        message: 'check_out must be after check_in',
        params: { code: 'DATE_ORDER' },
      });
    } else if (span > LIMITS.MAX_NIGHTS) {
      ctx.addIssue({
        code: 'custom',
        path: ['check_out'],
        message: `A stay can be at most ${LIMITS.MAX_NIGHTS} nights`,
        params: { code: 'OUT_OF_RANGE' },
      });
    } else if (s.nights !== undefined && s.nights !== span) {
      ctx.addIssue({
        code: 'custom',
        path: ['nights'],
        message: 'nights does not match check_in to check_out',
        params: { code: 'INCONSISTENT' },
      });
    }
  });
export type Stay = z.infer<typeof Stay>;

/** POST /v1/quotes and POST /v1/quotes/preview body. Unknown fields are rejected (BR-18). */
export const QuoteRequest = z.strictObject({
  organiser: Organiser,
  stay: Stay,
  room_type: RoomType,
  rooms: z.int().min(LIMITS.MIN_ROOMS).max(LIMITS.MAX_ROOMS),
  /** Explicit override rate. When omitted, the rate plan is used per night (BR-08). */
  rate_per_room_night_inr: UnitInr.optional(),
  /** Overrides the policy default for per-guest inclusions. */
  guests_per_room_units: z.int().min(1).max(LIMITS.MAX_GUESTS_PER_ROOM).optional(),
  inclusions: z.array(InclusionInput).max(LIMITS.MAX_INCLUSIONS).optional(),
});
export type QuoteRequest = z.infer<typeof QuoteRequest>;

// ---------------------------------------------------------------------------
// Result side
// ---------------------------------------------------------------------------

/**
 * Money result of a quote. Integer INR. A null value means it could not be computed because an
 * input is unknown; it is never shown as 0 (blueprint 5.4).
 */
export const QuoteTotals = z.strictObject({
  room_nights: Units,
  room_revenue_inr: Inr.nullable(),
  inclusions_revenue_inr: Inr.nullable(),
  variable_cost_inr: Inr.nullable(),
  inclusions_cost_inr: Inr.nullable(),
  contribution_inr: Inr.nullable(),
  contribution_margin_pct: Pct.nullable(),
  /** Floor rate x room-nights - variable cost (D-056); null when the variable cost is unknown. */
  contribution_floor_inr: Inr.nullable(),
  /** Minimum rate per room-night: package floor / total rooms, variable cost included. */
  floor_rate_per_room_night_inr: Inr,
  floor_headroom_inr: Inr.nullable(),
  shortfall_inr: Inr.nullable(),
  min_rate_per_room_night_inr: Inr.nullable(),
});
export type QuoteTotals = z.infer<typeof QuoteTotals>;

/** A floor-safe alternative, fully re-evaluated by the same engine (blueprint 6.4). */
export const CounterOffer = z.strictObject({
  type: CounterOfferType,
  summary: z.string(),
  rooms: z.int().min(1).optional(),
  rate_per_room_night_inr: UnitInr.optional(),
  check_in: IsoDate.optional(),
  inclusions: z.array(InclusionInput).optional(),
  contribution_inr: Inr,
  floor_headroom_inr: Inr,
});
export type CounterOffer = z.infer<typeof CounterOffer>;

/** Engine output. Every decision carries reason codes and an arithmetic trail. */
export const Evaluation = z.strictObject({
  decision: Decision,
  reasons: z.array(ReasonCode),
  check_in: IsoDate,
  check_out: IsoDate,
  nights: z.int().min(LIMITS.MIN_NIGHTS).max(LIMITS.MAX_NIGHTS),
  requested_rooms: z.int().min(1),
  offered_rooms: Units,
  shortfall_rooms: Units,
  /** True only for OFFER with no reasons. */
  auto_confirm_allowed: z.boolean(),
  totals: QuoteTotals,
  counter_offers: z.array(CounterOffer),
  /** Human-readable arithmetic, for example "20 x 2000 = 40000". */
  trail: z.array(z.string()),
});
export type Evaluation = z.infer<typeof Evaluation>;

/** POST /v1/quotes/preview response: stateless, no hold, no save. */
export const QuotePreviewResponse = z.strictObject({
  evaluation: Evaluation,
  valid_until: Instant.nullable(),
  terms_hash: TermsHash,
});
export type QuotePreviewResponse = z.infer<typeof QuotePreviewResponse>;

export const Actor = z.strictObject({
  user_id: z.string().min(1).max(128),
  role: Role,
});
export type Actor = z.infer<typeof Actor>;

export const Approval = z.strictObject({
  approved_by: Actor,
  approved_at: Instant,
  reason: z.string(),
  /** Approval is valid only while the quote's terms hash equals this (BR-11). */
  terms_hash: TermsHash,
});
export type Approval = z.infer<typeof Approval>;

/** A saved quote resource. */
export const Quote = z.strictObject({
  quote_id: Ulid,
  property_id: PropertyId,
  status: QuoteStatus,
  version: z.int().min(1),
  request: QuoteRequest,
  evaluation: Evaluation,
  terms_hash: TermsHash,
  issued_at: Instant,
  valid_until: Instant.nullable(),
  created_by: Actor,
  created_at: Instant,
  updated_at: Instant,
  approval: Approval.nullable(),
  /** Set when an amendment leaves a confirmed booking below the floor (BR-16). */
  review_required: z.boolean(),
});
export type Quote = z.infer<typeof Quote>;

export const QuoteList = z.strictObject({
  items: z.array(Quote),
  next_cursor: z.string().nullable(),
});
export type QuoteList = z.infer<typeof QuoteList>;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const Reason = NonEmptyText(500);

export const ApproveRequest = z.strictObject({ reason: Reason.min(5) });
export type ApproveRequest = z.infer<typeof ApproveRequest>;

export const RejectRequest = z.strictObject({ reason: Reason.min(5) });
export type RejectRequest = z.infer<typeof RejectRequest>;

export const ExtendRequest = z.strictObject({
  hours: z.int().min(1).max(LIMITS.MAX_POLICY_HOURS),
});
export type ExtendRequest = z.infer<typeof ExtendRequest>;

/** Partial cancellation: reduce the number of rooms on a confirmed quote. */
export const AmendmentRequest = z.strictObject({
  rooms: z.int().min(1).max(LIMITS.MAX_ROOMS),
  reason: Reason.optional(),
});
export type AmendmentRequest = z.infer<typeof AmendmentRequest>;

export const CancelRequest = z.strictObject({ reason: Reason.optional() });
export type CancelRequest = z.infer<typeof CancelRequest>;

export const ListQuotesQuery = z.strictObject({
  status: QuoteStatus.optional(),
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  cursor: z.string().max(512).optional(),
  limit: z
    .string()
    .regex(/^(?:[1-9]|[1-9]\d|100)$/, 'limit must be 1 to 100')
    .optional(),
});
export type ListQuotesQuery = z.infer<typeof ListQuotesQuery>;
