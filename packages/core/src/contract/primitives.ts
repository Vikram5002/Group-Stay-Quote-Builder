import { z } from 'zod';

/**
 * Hard limits shared by validation, the engine and the data layer.
 * MAX_NIGHTS and MAX_ROOM_TYPE_NIGHTS come from the DynamoDB transaction limit
 * (100 items; 2 per room-type-night plus quote and event). See blueprint 8.2.
 */
export const LIMITS = {
  MIN_NIGHTS: 1,
  MAX_NIGHTS: 28,
  MIN_ROOMS: 1,
  MAX_ROOMS: 500,
  MAX_ROOM_TYPE_NIGHTS: 45,
  MAX_INCLUSIONS: 10,
  MAX_GUESTS_PER_ROOM: 6,
  /** Upper bound for any per-unit money input (rate, cost, price). */
  MAX_UNIT_INR: 1_000_000,
  MAX_POLICY_HOURS: 720,
} as const;

/** Calendar date in the property time zone. A night is identified by the date it starts. */
export const IsoDate = z.iso.date().describe('Calendar date YYYY-MM-DD in the property time zone.');

/** An instant with an explicit offset. Stored in UTC, displayed in IST. */
export const Instant = z.iso
  .datetime({ offset: true })
  .describe('ISO 8601 instant with offset. Stored in UTC.');

/** Signed whole-rupee amount (totals, contribution, headroom). Integer INR only. */
export const Inr = z.int().describe('Whole Indian rupees. Integer; can be negative for headroom.');

/** Non-negative per-unit money input: rate, cost or price per unit. */
export const UnitInr = z
  .int()
  .min(0)
  .max(LIMITS.MAX_UNIT_INR)
  .describe('Whole Indian rupees per unit. Integer, 0 or more.');

/** Non-negative count of rooms, room-nights or guests. */
export const Units = z.int().min(0).describe('Non-negative whole count.');

/** Percentage on a 0 to 100 scale, rounded half-up to one decimal place, display only. */
export const Pct = z.number().max(100).describe('Percent, display only. Rules never compare it.');

export const RoomType = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,31}$/)
  .describe('Room type code, for example "standard".');

export const PropertyId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
  .describe('Property identifier, for example "p1".');

/** ULID: 26 Crockford base32 characters, sortable by creation time. */
export const Ulid = z
  .string()
  .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/)
  .describe('ULID identifier.');

/** SHA-256 hex digest of the commercial terms; binds approvals to terms (BR-11). */
export const TermsHash = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .describe('SHA-256 hex of the canonical commercial terms.');

export const NonEmptyText = (max: number) => z.string().trim().min(1).max(max);
