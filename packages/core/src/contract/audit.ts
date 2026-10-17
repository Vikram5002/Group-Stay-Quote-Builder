import { z } from 'zod';
import { QuoteEventType } from './codes.js';
import { Instant, Ulid } from './primitives.js';
import { Actor } from './quote.js';

/** Immutable audit record; every state change appends one (BR-19). */
export const QuoteEvent = z.strictObject({
  event_id: Ulid,
  quote_id: Ulid,
  type: QuoteEventType,
  actor: Actor,
  at: Instant,
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  reason: z.string().nullable(),
});
export type QuoteEvent = z.infer<typeof QuoteEvent>;

export const QuoteEventList = z.strictObject({
  items: z.array(QuoteEvent),
});
export type QuoteEventList = z.infer<typeof QuoteEventList>;
