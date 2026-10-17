import { problem, type ProblemDetails } from '../contract/problem.js';
import { QuoteRequest, type Stay } from '../contract/quote.js';
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

export type ResolvedQuoteRequest = Omit<QuoteRequest, 'stay'> & { stay: ResolvedStay };

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
  return { ok: true, value: { ...parsed.value, stay: resolveStay(parsed.value.stay) } };
}
