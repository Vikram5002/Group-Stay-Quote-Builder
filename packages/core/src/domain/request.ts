import { problem, type ProblemDetails } from '../contract/problem.js';
import { QuoteRequest, type Stay } from '../contract/quote.js';
import { LIMITS } from '../contract/primitives.js';
import { parseWith } from '../contract/validation.js';
import { checkOutDate, daysBetween, stayNights } from './calendar.js';

/**
 * Request validation entry point (FR-06, BR-02, BR-18). Turns untrusted JSON into a resolved
 * request the engine can use, or a ready-to-send 422 problem with field-level codes.
 */

/** A stay with both forms filled in: check-out and the list of night dates. */
export interface ResolvedStay {
  check_in: string;
  check_out: string;
  nights: number;
  /** Each night is identified by the date it starts (blueprint 5.2). */
  night_dates: string[];
}

/** One block of rooms: its stay and how many rooms (D-058). */
export interface ResolvedLine {
  stay: ResolvedStay;
  rooms: number;
}

export type ResolvedQuoteRequest = Omit<QuoteRequest, 'stay'> & {
  stay: ResolvedStay;
  /** Every block of rooms, the first one being `stay` and `rooms`. */
  lines: ResolvedLine[];
};

/** Earliest check-in to latest check-out over all lines, as night dates. */
export function spanDates(lines: readonly ResolvedLine[]): string[] {
  const first = lines.map((l) => l.stay.check_in).sort()[0] as string;
  const last = lines
    .map((l) => l.stay.check_out)
    .sort()
    .at(-1) as string;
  return stayNights(first, daysBetween(first, last));
}

/** Rooms needed on each night: the sum over the lines that cover it. */
export function roomsByNight(lines: readonly ResolvedLine[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of lines) {
    for (const date of line.stay.night_dates) out.set(date, (out.get(date) ?? 0) + line.rooms);
  }
  return out;
}

export type QuoteRequestResult =
  { ok: true; value: ResolvedQuoteRequest } | { ok: false; problem: ProblemDetails };

/** Fill in nights or check-out from the other. Expects a stay that passed the schema. */
export function resolveStay(stay: Stay): ResolvedStay {
  const nights = stay.nights ?? daysBetween(stay.check_in, stay.check_out as string);
  return {
    check_in: stay.check_in,
    check_out: stay.check_out ?? checkOutDate(stay.check_in, nights),
    nights,
    night_dates: stayNights(stay.check_in, nights),
  };
}

export function validateQuoteRequest(input: unknown, instance?: string): QuoteRequestResult {
  const parsed = parseWith(QuoteRequest, input);
  if (!parsed.ok) {
    const count = parsed.issues.length;
    return {
      ok: false,
      problem: problem('VALIDATION_FAILED', {
        detail: `${count} field${count === 1 ? '' : 's'} failed validation`,
        errors: parsed.issues,
        ...(instance === undefined ? {} : { instance }),
      }),
    };
  }
  const v = parsed.value;
  const lines: ResolvedLine[] = [
    { stay: resolveStay(v.stay), rooms: v.rooms },
    ...(v.additional_lines ?? []).map((l) => ({ stay: resolveStay(l.stay), rooms: l.rooms })),
  ];
  if (lines.length > 1 && spanDates(lines).length > LIMITS.MAX_NIGHTS) {
    return {
      ok: false,
      problem: problem('VALIDATION_FAILED', {
        detail: '1 field failed validation',
        errors: [
          {
            path: 'additional_lines',
            code: 'OUT_OF_RANGE',
            message: `All lines together must fit within ${LIMITS.MAX_NIGHTS} nights`,
          },
        ],
        ...(instance === undefined ? {} : { instance }),
      }),
    };
  }
  if (
    parsed.value.discount_pct !== undefined &&
    parsed.value.rate_per_room_night_inr !== undefined
  ) {
    return {
      ok: false,
      problem: problem('VALIDATION_FAILED', {
        detail: '1 field failed validation',
        errors: [
          {
            path: 'discount_pct',
            code: 'INCONSISTENT',
            message: 'Give a discount or a rate, not both',
          },
        ],
        ...(instance === undefined ? {} : { instance }),
      }),
    };
  }
  return { ok: true, value: { ...v, stay: lines[0]?.stay as ResolvedStay, lines } };
}
