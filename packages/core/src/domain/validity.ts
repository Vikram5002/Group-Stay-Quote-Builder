import type { Policy } from '../contract/policy.js';
import type { ValidationIssue } from '../contract/problem.js';
import { localDate, startOfDayUtc, toUtcIso } from './timezone.js';

/**
 * Quote validity and expiry (blueprint 5.7, BR-09).
 *
 *   valid_until = min( issued_at + validity_hours,
 *                      start_of(check_in, property_tz) - stay_cutoff_hours )
 *   valid_until - issued_at < min_validity_hours  ->  TOO_LATE_TO_QUOTE
 *
 * Expiry is authoritative on every read and confirm (isExpired); the scheduler and sweeper only
 * tidy up held inventory. DynamoDB TTL is never relied on for correctness.
 */

const MS_PER_HOUR = 3_600_000;

export type ValidityPolicy = Pick<
  Policy,
  'timezone' | 'validity_hours' | 'stay_cutoff_hours' | 'min_validity_hours'
>;

export interface Validity {
  /** UTC ISO instants, the storage form. */
  issued_at: string;
  valid_until: string;
  valid_until_ms: number;
  /** Which bound set valid_until: the validity window or the stay cutoff. */
  limited_by: 'validity_window' | 'stay_cutoff';
  /** Milliseconds from issue to valid_until; negative when the cutoff has already passed. */
  window_ms: number;
  /** True when the window is shorter than min_validity_hours: decline with TOO_LATE_TO_QUOTE. */
  too_late: boolean;
}

export function computeValidity(
  issuedAtMs: number,
  checkIn: string,
  policy: ValidityPolicy,
): Validity {
  if (!Number.isFinite(issuedAtMs)) throw new RangeError('issuedAtMs must be a finite instant');
  const byWindow = issuedAtMs + policy.validity_hours * MS_PER_HOUR;
  const byCutoff = startOfDayUtc(checkIn, policy.timezone) - policy.stay_cutoff_hours * MS_PER_HOUR;
  const validUntil = Math.min(byWindow, byCutoff);
  const windowMs = validUntil - issuedAtMs;
  return {
    issued_at: toUtcIso(issuedAtMs),
    valid_until: toUtcIso(validUntil),
    valid_until_ms: validUntil,
    limited_by: byWindow <= byCutoff ? 'validity_window' : 'stay_cutoff',
    window_ms: windowMs,
    too_late: windowMs < policy.min_validity_hours * MS_PER_HOUR,
  };
}

/**
 * A stay cannot start before today in the property time zone. That is an input error (422 on
 * stay.check_in), unlike a stay that starts too soon, which the engine declines with
 * TOO_LATE_TO_QUOTE. Returns null when the check-in is today or later.
 */
export function pastCheckInIssue(
  checkIn: string,
  nowMs: number,
  timeZone: string,
): ValidationIssue | null {
  const today = localDate(nowMs, timeZone);
  if (checkIn >= today) return null; // ISO dates compare in calendar order
  return {
    path: 'stay.check_in',
    code: 'OUT_OF_RANGE',
    message: `Check-in must be today (${today}) or later`,
  };
}

function toMs(instant: string | number): number {
  const ms = typeof instant === 'number' ? instant : Date.parse(instant);
  if (!Number.isFinite(ms)) throw new RangeError(`Not a valid instant: ${String(instant)}`);
  return ms;
}

/** A quote is expired from the valid_until instant onward (the boundary itself is expired). */
export function isExpired(validUntil: string | number, nowMs: number): boolean {
  return nowMs >= toMs(validUntil);
}

/** Whole seconds left before expiry, never negative. Drives the UI hold clock. */
export function secondsRemaining(validUntil: string | number, nowMs: number): number {
  return Math.max(0, Math.floor((toMs(validUntil) - nowMs) / 1000));
}
