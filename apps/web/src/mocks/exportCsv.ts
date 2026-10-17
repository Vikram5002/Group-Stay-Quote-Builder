import type { Quote } from '@c32/core';
import { toCsv } from '../lib/csv';

const COLUMNS = [
  'quote_id',
  'organiser',
  'status',
  'decision',
  'check_in',
  'check_out',
  'nights',
  'room_type',
  'rooms_requested',
  'rooms_offered',
  'contribution_inr',
  'valid_until',
] as const;

/** One row per quote. An unknown contribution is an empty cell, never 0. */
export function quotesCsv(quotes: readonly Quote[]): string {
  return toCsv([
    [...COLUMNS],
    ...quotes.map((q) => [
      q.quote_id,
      q.request.organiser.name,
      q.status,
      q.evaluation.decision,
      q.evaluation.check_in,
      q.evaluation.check_out,
      q.evaluation.nights,
      q.request.room_type,
      q.evaluation.requested_rooms,
      q.evaluation.offered_rooms,
      q.evaluation.totals.contribution_inr,
      q.valid_until,
    ]),
  ]);
}
