import type { Decision, QuoteEventType, QuoteStatus, ReasonCode } from '@c32/core';
import type { Tone } from '../../components';

export const STATUS_LABEL: Record<QuoteStatus, string> = {
  OFFERED: 'Offered',
  PENDING_REVIEW: 'Pending review',
  CONFIRMED: 'Confirmed',
  DECLINED: 'Declined',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
};

export const STATUS_TONE: Record<QuoteStatus, Tone> = {
  OFFERED: 'info',
  PENDING_REVIEW: 'warning',
  CONFIRMED: 'success',
  DECLINED: 'danger',
  REJECTED: 'danger',
  EXPIRED: 'neutral',
  CANCELLED: 'neutral',
};

export const DECISION_LABEL: Record<Decision, string> = {
  OFFER: 'Offer',
  PARTIAL_OFFER: 'Partial offer',
  REVIEW: 'Needs review',
  DECLINE: 'Decline',
};

export const EVENT_LABEL: Record<QuoteEventType, string> = {
  QUOTE_CREATED: 'Quote created',
  QUOTE_DECLINED: 'Quote declined',
  HOLD_ACQUIRED: 'Rooms held',
  HOLD_RELEASED: 'Rooms released',
  APPROVED: 'Approved by Service Manager',
  REJECTED: 'Rejected by Service Manager',
  CONFIRMED: 'Confirmed',
  EXTENDED: 'Validity extended',
  AMENDED: 'Amended',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
  PAYMENT_RECORDED: 'Payment recorded',
  EMAILED: 'PDF emailed',
  SENT_TO_OWNER: 'Sent to the Owner',
  OWNER_DISCOUNTED: 'Owner set the discount',
};

/** A quote still holds rooms and has a countdown while it is in one of these statuses. */
export const OPEN_STATUSES: readonly QuoteStatus[] = ['OFFERED', 'PENDING_REVIEW'];

/** Short names for reason codes, for lists and chips. The long text is REASON_DESCRIPTIONS. */
export const REASON_LABEL: Record<ReasonCode, string> = {
  FLOOR_BREACH: 'Below floor',
  UNKNOWN_COST: 'Cost unknown',
  UNKNOWN_RATE: 'Rate unknown',
  UNKNOWN_AVAILABILITY: 'Availability unknown',
  NO_INVENTORY_DATA: 'Not on sale',
  NO_CAPACITY: 'No capacity',
  PARTIAL_AVAILABILITY: 'Partial availability',
  TOO_LATE_TO_QUOTE: 'Too late to quote',
};
