import { z } from 'zod';

/** Version of the published API contract (Zod schemas, codes, OpenAPI). Bump on any change. */
export const CONTRACT_VERSION = '0.3.0';

// ---------------------------------------------------------------------------
// Decisions and quote lifecycle
// ---------------------------------------------------------------------------

export const DECISIONS = ['OFFER', 'PARTIAL_OFFER', 'REVIEW', 'DECLINE'] as const;
export const Decision = z.enum(DECISIONS);
export type Decision = z.infer<typeof Decision>;

export const QUOTE_STATUSES = [
  'OFFERED',
  'PENDING_REVIEW',
  'CONFIRMED',
  'DECLINED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED',
] as const;
export const QuoteStatus = z.enum(QUOTE_STATUSES);
export type QuoteStatus = z.infer<typeof QuoteStatus>;

/**
 * Allowed status transitions. Approval moves PENDING_REVIEW to OFFERED with an approval
 * bound to the terms hash (BR-10, BR-11). Amendments and extensions keep the status and bump
 * the quote version. DECLINED, REJECTED, EXPIRED and CANCELLED are terminal.
 */
export const QUOTE_TRANSITIONS: Readonly<Record<QuoteStatus, readonly QuoteStatus[]>> = {
  OFFERED: ['CONFIRMED', 'EXPIRED', 'CANCELLED'],
  PENDING_REVIEW: ['OFFERED', 'REJECTED', 'EXPIRED', 'CANCELLED'],
  CONFIRMED: ['CANCELLED'],
  DECLINED: [],
  REJECTED: [],
  EXPIRED: [],
  CANCELLED: [],
};

export function canTransition(from: QuoteStatus, to: QuoteStatus): boolean {
  return QUOTE_TRANSITIONS[from].includes(to);
}

export function isTerminalStatus(status: QuoteStatus): boolean {
  return QUOTE_TRANSITIONS[status].length === 0;
}

/** Status a freshly evaluated quote is saved with, by decision. */
export const INITIAL_STATUS: Readonly<Record<Decision, QuoteStatus>> = {
  OFFER: 'OFFERED',
  PARTIAL_OFFER: 'OFFERED',
  REVIEW: 'PENDING_REVIEW',
  DECLINE: 'DECLINED',
};

// ---------------------------------------------------------------------------
// Reason codes (why a decision was made). Blueprint 6.5.
// ---------------------------------------------------------------------------

export const REASON_CODES = [
  'FLOOR_BREACH',
  'UNKNOWN_COST',
  'UNKNOWN_RATE',
  'UNKNOWN_AVAILABILITY',
  'NO_INVENTORY_DATA',
  'NO_CAPACITY',
  'PARTIAL_AVAILABILITY',
  'TOO_LATE_TO_QUOTE',
] as const;
export const ReasonCode = z.enum(REASON_CODES);
export type ReasonCode = z.infer<typeof ReasonCode>;

export const REASON_DESCRIPTIONS: Readonly<Record<ReasonCode, string>> = {
  FLOOR_BREACH: 'The rate is below the floor rate (package floor divided by total rooms).',
  UNKNOWN_COST: 'A required cost is unknown (null), so contribution cannot be computed.',
  UNKNOWN_RATE: 'The rate plan has no rate for a night and no override rate was given.',
  UNKNOWN_AVAILABILITY: 'Room-night availability is unknown for at least one night.',
  NO_INVENTORY_DATA: 'At least one night of the stay has no inventory row, so it is not on sale.',
  NO_CAPACITY: 'No rooms, or fewer than the minimum partial offer, are sellable.',
  PARTIAL_AVAILABILITY: 'Fewer rooms than requested are sellable on every night.',
  TOO_LATE_TO_QUOTE: 'The validity window before the stay cutoff is too short.',
};

// ---------------------------------------------------------------------------
// API error codes (RFC 9457 problem+json). Blueprint 9.4.
// ---------------------------------------------------------------------------

export const ERROR_CODES = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'APPROVAL_REQUIRED',
  'HOLD_CONFLICT',
  'VERSION_CONFLICT',
  'INVALID_STATE',
  'IDEMPOTENCY_CONFLICT',
  'QUOTE_EXPIRED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'VALIDATION_FAILED',
  'THROTTLED',
  'INTERNAL',
] as const;
export const ErrorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ERROR_HTTP_STATUS: Readonly<Record<ErrorCode, number>> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  APPROVAL_REQUIRED: 409,
  HOLD_CONFLICT: 409,
  VERSION_CONFLICT: 409,
  INVALID_STATE: 409,
  IDEMPOTENCY_CONFLICT: 409,
  QUOTE_EXPIRED: 410,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  VALIDATION_FAILED: 422,
  THROTTLED: 429,
  INTERNAL: 500,
};

export const ERROR_TITLES: Readonly<Record<ErrorCode, string>> = {
  UNAUTHENTICATED: 'Sign-in required',
  FORBIDDEN: 'Not allowed',
  NOT_FOUND: 'Not found',
  APPROVAL_REQUIRED: 'Owner approval required',
  HOLD_CONFLICT: 'Room-nights are no longer available',
  VERSION_CONFLICT: 'The record was changed by someone else',
  INVALID_STATE: 'Action not allowed in the current state',
  IDEMPOTENCY_CONFLICT: 'Idempotency key reused with a different request',
  QUOTE_EXPIRED: 'Quote has expired',
  PAYLOAD_TOO_LARGE: 'Request body too large',
  UNSUPPORTED_MEDIA_TYPE: 'Unsupported content type',
  VALIDATION_FAILED: 'Request validation failed',
  THROTTLED: 'Too many requests',
  INTERNAL: 'Unexpected error',
};

/** Field-level validation issue codes returned inside a VALIDATION_FAILED problem. */
export const VALIDATION_ISSUE_CODES = [
  'REQUIRED',
  'INVALID_TYPE',
  'NOT_INTEGER',
  'OUT_OF_RANGE',
  'INVALID_LENGTH',
  'INVALID_DATE',
  'INVALID_FORMAT',
  'INVALID_ENUM',
  'UNKNOWN_FIELD',
  'DATE_ORDER',
  'INCONSISTENT',
  'INVALID_JSON',
  'INVALID_VALUE',
] as const;
export const ValidationIssueCode = z.enum(VALIDATION_ISSUE_CODES);
export type ValidationIssueCode = z.infer<typeof ValidationIssueCode>;

// ---------------------------------------------------------------------------
// Other enumerations
// ---------------------------------------------------------------------------

export const ROLES = ['Sales', 'Owner', 'Viewer'] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

export const INCLUSION_BASES = ['per_guest_night', 'per_room_night'] as const;
export const InclusionBasis = z.enum(INCLUSION_BASES);
export type InclusionBasis = z.infer<typeof InclusionBasis>;

export const COUNTER_OFFER_TYPES = [
  'RAISE_RATE',
  'REPRICE_INCLUSION',
  'CHANGE_VOLUME',
  'PARTIAL_ROOMS',
  'ALT_DATES',
] as const;
export const CounterOfferType = z.enum(COUNTER_OFFER_TYPES);
export type CounterOfferType = z.infer<typeof CounterOfferType>;

export const QUOTE_EVENT_TYPES = [
  'QUOTE_CREATED',
  'QUOTE_DECLINED',
  'HOLD_ACQUIRED',
  'HOLD_RELEASED',
  'APPROVED',
  'REJECTED',
  'CONFIRMED',
  'EXTENDED',
  'AMENDED',
  'CANCELLED',
  'EXPIRED',
] as const;
export const QuoteEventType = z.enum(QUOTE_EVENT_TYPES);
export type QuoteEventType = z.infer<typeof QuoteEventType>;
