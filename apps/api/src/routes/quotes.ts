import {
  AmendmentRequest,
  ApproveRequest,
  CancelRequest,
  EmailRequest,
  ExtendRequest,
  ListQuotesQuery,
  RecordPaymentRequest,
  RejectRequest,
  Ulid,
  parseWith,
  validateQuoteRequest,
  type QuoteEventList,
  type QuoteList,
} from '@c32/core';
import type { Request } from 'express';
import { getEvents, getQuote, listQuotes } from '../data/quotes.js';
import { ValidationFailure } from '../errors.js';
import { amendQuote, cancelQuote, extendQuote } from '../services/changes.js';
import { confirmQuote } from '../services/confirm-quote.js';
import { emailDocument, recordPayment } from '../services/documents.js';
import { createQuote } from '../services/create-quote.js';
import { ServiceError } from '../services/errors.js';
import { previewQuote } from '../services/preview-quote.js';
import { approveQuote, rejectQuote } from '../services/review.js';
import type { Handlers } from './operations.js';

/** Quote operations (blueprint section 9). Each handler validates, calls one service, returns. */

function reasonBody(req: Request, schema: typeof ApproveRequest | typeof RejectRequest) {
  const b = parseWith(schema, req.body);
  if (!b.ok) throw new ValidationFailure(b.issues);
  return b.value.reason;
}

function body<
  S extends
    | typeof AmendmentRequest
    | typeof CancelRequest
    | typeof EmailRequest
    | typeof ExtendRequest
    | typeof RecordPaymentRequest,
>(req: Request, schema: S) {
  const b = parseWith(schema, req.body ?? {});
  if (!b.ok) throw new ValidationFailure(b.issues);
  return b.value as ReturnType<S['parse']>;
}

function bodyRequest(req: Request) {
  const v = validateQuoteRequest(req.body, req.path);
  if (!v.ok) throw new ValidationFailure(v.problem.errors ?? []);
  return v.value;
}

/** An id that is not a ULID cannot exist, so it is a plain 404. */
function quoteId(req: Request): string {
  const id = req.params['id'];
  if (!Ulid.safeParse(id).success)
    throw new ServiceError('NOT_FOUND', `Quote ${String(id)} not found`);
  return id as string;
}

export const quoteHandlers: Handlers = {
  previewQuote: async ({ req, deps }) => ({
    status: 200,
    body: await previewQuote(deps, bodyRequest(req)),
  }),

  createQuote: async ({ req, deps, actor }) => {
    const quote = await createQuote(deps, bodyRequest(req), actor);
    // 201 for a saved offer or review; 200 when the quote was saved as declined (blueprint 9).
    return { status: quote.status === 'DECLINED' ? 200 : 201, body: quote };
  },

  listQuotes: async ({ req, deps }) => {
    const q = parseWith(ListQuotesQuery, req.query);
    if (!q.ok) throw new ValidationFailure(q.issues);
    const page = await listQuotes(deps.data, {
      ...(q.value.status ? { status: q.value.status } : {}),
      ...(q.value.from ? { from: q.value.from } : {}),
      ...(q.value.to ? { to: q.value.to } : {}),
      ...(q.value.cursor ? { cursor: q.value.cursor } : {}),
      limit: q.value.limit ? Number(q.value.limit) : 25,
    });
    const body: QuoteList = page;
    return { status: 200, body };
  },

  getQuote: async ({ req, deps }) => {
    const quote = await getQuote(deps.data, quoteId(req));
    if (!quote) throw new ServiceError('NOT_FOUND', `Quote ${req.params['id']} not found`);
    return { status: 200, body: quote };
  },

  confirmQuote: async ({ req, deps, actor }) => ({
    status: 200,
    body: await confirmQuote(deps, quoteId(req), actor),
  }),

  getQuoteAudit: async ({ req, deps }) => {
    const id = quoteId(req);
    if (!(await getQuote(deps.data, id)))
      throw new ServiceError('NOT_FOUND', `Quote ${id} not found`);
    const body: QuoteEventList = { items: await getEvents(deps.data, id) };
    return { status: 200, body };
  },

  approveQuote: async ({ req, deps, actor }) => ({
    status: 200,
    body: await approveQuote(deps, quoteId(req), actor, reasonBody(req, ApproveRequest)),
  }),

  rejectQuote: async ({ req, deps, actor }) => ({
    status: 200,
    body: await rejectQuote(deps, quoteId(req), actor, reasonBody(req, RejectRequest)),
  }),

  extendQuote: async ({ req, deps, actor }) => ({
    status: 200,
    body: await extendQuote(deps, quoteId(req), actor, body(req, ExtendRequest).hours),
  }),

  amendQuote: async ({ req, deps, actor }) => {
    const b = body(req, AmendmentRequest);
    return {
      status: 200,
      body: await amendQuote(deps, quoteId(req), actor, b.rooms, b.reason ?? null),
    };
  },

  cancelQuote: async ({ req, deps, actor }) => ({
    status: 200,
    body: await cancelQuote(deps, quoteId(req), actor, body(req, CancelRequest).reason ?? null),
  }),

  emailQuote: async ({ req, deps, actor }) => ({
    status: 200,
    body: await emailDocument(
      deps,
      quoteId(req),
      actor,
      'quote',
      body(req, EmailRequest).to ?? null,
    ),
  }),

  recordPayment: async ({ req, deps, actor }) => ({
    status: 200,
    body: await recordPayment(
      deps,
      quoteId(req),
      actor,
      body(req, RecordPaymentRequest).reference ?? null,
    ),
  }),

  emailInvoice: async ({ req, deps, actor }) => ({
    status: 200,
    body: await emailDocument(
      deps,
      quoteId(req),
      actor,
      'invoice',
      body(req, EmailRequest).to ?? null,
    ),
  }),
};
