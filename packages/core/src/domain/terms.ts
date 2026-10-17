import type { Evaluation } from '../contract/quote.js';
import type { ResolvedQuoteRequest } from './request.js';

/**
 * Canonical commercial terms (BR-11). An owner's approval is bound to a hash of this string, so
 * any change to rooms, dates, rate, costs or inclusions invalidates it. The API hashes it with
 * SHA-256; core only builds the string, so it stays free of crypto and I/O.
 */

/** JSON with object keys sorted at every level, so equal terms always give equal strings. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** The terms the organiser is offered: what the approval is about. */
export function commercialTerms(request: ResolvedQuoteRequest, evaluation: Evaluation): string {
  const t = evaluation.totals;
  return canonicalJson({
    v: 1,
    room_type: request.room_type,
    check_in: request.stay.check_in,
    nights: request.stay.nights,
    rooms: evaluation.offered_rooms,
    rate_per_room_night_inr: request.rate_per_room_night_inr ?? null,
    discount_pct: request.discount_pct ?? null,
    // Absent (not null) when not given, so terms without one keep their earlier hash.
    discount_inr: request.discount_inr,
    guests_per_room_units: request.guests_per_room_units ?? null,
    inclusions: request.inclusions ?? [],
    room_revenue_inr: t.room_revenue_inr,
    variable_cost_inr: t.variable_cost_inr,
    inclusions_revenue_inr: t.inclusions_revenue_inr,
    inclusions_cost_inr: t.inclusions_cost_inr,
  });
}
