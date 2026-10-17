/**
 * Calendar-date arithmetic on ISO dates (YYYY-MM-DD). Blueprint 5.2.
 *
 * Dates are treated as plain calendar days, never as instants, so time zones and DST cannot
 * shift them. A night is identified by the date on which it starts: check-in 2026-11-01 for
 * 2 nights occupies nights 2026-11-01 and 2026-11-02 and checks out on 2026-11-03.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** Days since 1970-01-01 for a valid ISO calendar date. Throws on an invalid date. */
export function toEpochDay(iso: string): number {
  const match = ISO_DATE.exec(iso);
  if (!match) throw new RangeError(`Not an ISO date: ${iso}`);
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const ms = Date.UTC(year, month - 1, day);
  const back = new Date(ms);
  if (
    back.getUTCFullYear() !== year ||
    back.getUTCMonth() !== month - 1 ||
    back.getUTCDate() !== day
  ) {
    throw new RangeError(`Not a real calendar date: ${iso}`);
  }
  return ms / MS_PER_DAY;
}

/** ISO calendar date for a day count since 1970-01-01. */
export function fromEpochDay(epochDay: number): string {
  if (!Number.isInteger(epochDay)) throw new RangeError(`Epoch day must be an integer`);
  return new Date(epochDay * MS_PER_DAY).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return fromEpochDay(toEpochDay(iso) + days);
}

/** Whole days from check-in to check-out (can be zero or negative; callers validate). */
export function daysBetween(fromIso: string, toIso: string): number {
  return toEpochDay(toIso) - toEpochDay(fromIso);
}

/** The night dates of a stay, in order. */
export function stayNights(checkIn: string, nights: number): string[] {
  if (!Number.isInteger(nights) || nights < 0) throw new RangeError('nights must be >= 0');
  const start = toEpochDay(checkIn);
  return Array.from({ length: nights }, (_, i) => fromEpochDay(start + i));
}

export function checkOutDate(checkIn: string, nights: number): string {
  return addDays(checkIn, nights);
}
