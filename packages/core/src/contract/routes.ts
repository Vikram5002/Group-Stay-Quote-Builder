import type { z } from 'zod';
import { QuoteEventList } from './audit.js';
import type { Role } from './codes.js';
import { HealthResponse } from './health.js';
import { ExportLink, ImportReport, ImportUploadRequest, ImportUploadResponse } from './imports.js';
import { AvailabilityResponse } from './inventory.js';
import { Policy, PolicyUpdateRequest } from './policy.js';
import {
  AmendmentRequest,
  ApproveRequest,
  OwnerDiscountRequest,
  CancelRequest,
  EmailRequest,
  ExtendRequest,
  Quote,
  QuoteList,
  QuotePreviewResponse,
  QuoteRequest,
  RecordPaymentRequest,
  RejectRequest,
} from './quote.js';

export type HttpMethod = 'get' | 'post' | 'put';

export interface RouteResponse {
  description: string;
  schema?: z.ZodType;
}

export interface QueryParam {
  name: string;
  required: boolean;
  description: string;
  schema: { type: 'string'; enum?: readonly string[]; format?: string; pattern?: string };
}

export interface RouteSpec {
  operationId: string;
  method: HttpMethod;
  /** OpenAPI-style path, for example /v1/quotes/{id}. */
  path: string;
  summary: string;
  /** 'public' means no JWT (only /health). */
  roles: readonly Role[] | 'public';
  /** Mutating routes that honour the Idempotency-Key header (BR-17). */
  idempotent: boolean;
  request?: z.ZodType;
  query?: readonly QueryParam[];
  responses: Readonly<Record<number, RouteResponse>>;
}

const ALL: readonly Role[] = ['Reception', 'ServiceManager', 'Owner', 'Viewer'];
/** Build quotes: Reception and the Service Manager (the Owner does not build quotes, D-062). */
const BUILDERS: readonly Role[] = ['Reception', 'ServiceManager'];
/** Work on an existing quote or booking: the builders and the Owner. */
const BOOKING: readonly Role[] = ['Reception', 'ServiceManager', 'Owner'];
/** Approve or reject reviews: the Service Manager only. */
const REVIEWER: readonly Role[] = ['ServiceManager'];
/** Imports and policy: the Service Manager and the Owner. */
const ADMIN: readonly Role[] = ['ServiceManager', 'Owner'];
/** The Owner's own discount on quotes sent to them (D-062). */
const OWNER: readonly Role[] = ['Owner'];

const ok = (description: string, schema?: z.ZodType): RouteResponse =>
  schema ? { description, schema } : { description };

/** API surface v1 (blueprint section 9). The Express router and the OpenAPI file derive from it. */
export const ROUTES: readonly RouteSpec[] = [
  {
    operationId: 'getHealth',
    method: 'get',
    path: '/health',
    summary: 'Liveness and version.',
    roles: 'public',
    idempotent: false,
    responses: { 200: ok('Service is up.', HealthResponse) },
  },
  {
    operationId: 'previewQuote',
    method: 'post',
    path: '/v1/quotes/preview',
    summary: 'Stateless evaluation: no hold, no save.',
    roles: BUILDERS,
    idempotent: false,
    request: QuoteRequest,
    responses: { 200: ok('Evaluation.', QuotePreviewResponse) },
  },
  {
    operationId: 'createQuote',
    method: 'post',
    path: '/v1/quotes',
    summary: 'Evaluate, acquire holds, save the quote and schedule expiry.',
    roles: BUILDERS,
    idempotent: true,
    request: QuoteRequest,
    responses: {
      201: ok('Quote saved as OFFERED or PENDING_REVIEW.', Quote),
      200: ok('Quote saved as DECLINED (no hold taken).', Quote),
      409: ok('HOLD_CONFLICT or IDEMPOTENCY_CONFLICT.'),
    },
  },
  {
    operationId: 'listQuotes',
    method: 'get',
    path: '/v1/quotes',
    summary: 'List quotes with status and date filters, paged.',
    roles: ALL,
    idempotent: false,
    query: [
      {
        name: 'status',
        required: false,
        description: 'Filter by status.',
        schema: {
          type: 'string',
          enum: [
            'OFFERED',
            'PENDING_REVIEW',
            'CONFIRMED',
            'DECLINED',
            'REJECTED',
            'EXPIRED',
            'CANCELLED',
          ],
        },
      },
      {
        name: 'from',
        required: false,
        description: 'Check-in on or after.',
        schema: { type: 'string', format: 'date' },
      },
      {
        name: 'to',
        required: false,
        description: 'Check-in on or before.',
        schema: { type: 'string', format: 'date' },
      },
      {
        name: 'cursor',
        required: false,
        description: 'Opaque page cursor.',
        schema: { type: 'string' },
      },
      {
        name: 'limit',
        required: false,
        description: 'Page size 1 to 100.',
        schema: { type: 'string', pattern: '^(?:[1-9]|[1-9]\\d|100)$' },
      },
    ],
    responses: { 200: ok('A page of quotes.', QuoteList) },
  },
  {
    operationId: 'getQuote',
    method: 'get',
    path: '/v1/quotes/{id}',
    summary: 'Quote with totals, reasons and countdown.',
    roles: ALL,
    idempotent: false,
    responses: { 200: ok('The quote.', Quote), 404: ok('NOT_FOUND.') },
  },
  {
    operationId: 'confirmQuote',
    method: 'post',
    path: '/v1/quotes/{id}/confirm',
    summary: 'Confirm if allowed (BR-10).',
    roles: BOOKING,
    idempotent: true,
    responses: {
      200: ok('Confirmed.', Quote),
      404: ok('NOT_FOUND.'),
      409: ok('APPROVAL_REQUIRED or INVALID_STATE.'),
      410: ok('QUOTE_EXPIRED; holds released.'),
    },
  },
  {
    operationId: 'approveQuote',
    method: 'post',
    path: '/v1/quotes/{id}/approve',
    summary: 'Service Manager approves a floor breach with a reason; four-eyes enforced (BR-12).',
    roles: REVIEWER,
    idempotent: true,
    request: ApproveRequest,
    responses: {
      200: ok('Approved; status OFFERED.', Quote),
      403: ok('FORBIDDEN, including self-approval.'),
      404: ok('NOT_FOUND.'),
      409: ok('INVALID_STATE.'),
    },
  },
  {
    operationId: 'ownerDiscount',
    method: 'post',
    path: '/v1/quotes/{id}/owner-discount',
    summary: 'Owner sets any discount on a quote sent to them and issues it (D-062).',
    roles: OWNER,
    idempotent: true,
    request: OwnerDiscountRequest,
    responses: {
      200: ok('Discount applied; status OFFERED.', Quote),
      404: ok('NOT_FOUND.'),
      409: ok('INVALID_STATE.'),
      410: ok('QUOTE_EXPIRED; holds released.'),
    },
  },
  {
    operationId: 'rejectQuote',
    method: 'post',
    path: '/v1/quotes/{id}/reject',
    summary: 'Service Manager rejects and releases holds.',
    roles: REVIEWER,
    idempotent: true,
    request: RejectRequest,
    responses: { 200: ok('Rejected.', Quote), 404: ok('NOT_FOUND.'), 409: ok('INVALID_STATE.') },
  },
  {
    operationId: 'extendQuote',
    method: 'post',
    path: '/v1/quotes/{id}/extend',
    summary: 'Extend validity within policy; re-checks holds.',
    roles: BOOKING,
    idempotent: true,
    request: ExtendRequest,
    responses: {
      200: ok('Extended.', Quote),
      404: ok('NOT_FOUND.'),
      409: ok('INVALID_STATE or HOLD_CONFLICT.'),
      410: ok('QUOTE_EXPIRED.'),
    },
  },
  {
    operationId: 'amendQuote',
    method: 'post',
    path: '/v1/quotes/{id}/amendments',
    summary: 'Partial cancellation: release rooms first, then re-check the floor (BR-16).',
    roles: BOOKING,
    idempotent: true,
    request: AmendmentRequest,
    responses: { 200: ok('Amended.', Quote), 404: ok('NOT_FOUND.'), 409: ok('INVALID_STATE.') },
  },
  {
    operationId: 'cancelQuote',
    method: 'post',
    path: '/v1/quotes/{id}/cancel',
    summary: 'Full cancellation and release.',
    roles: BOOKING,
    idempotent: true,
    request: CancelRequest,
    responses: { 200: ok('Cancelled.', Quote), 404: ok('NOT_FOUND.'), 409: ok('INVALID_STATE.') },
  },
  {
    operationId: 'emailQuote',
    method: 'post',
    path: '/v1/quotes/{id}/email-quote',
    summary: 'Email the quote PDF to the organiser (D-059).',
    roles: BOOKING,
    idempotent: true,
    request: EmailRequest,
    responses: {
      200: ok('Sent; the quote lists the email.', Quote),
      404: ok('NOT_FOUND.'),
      409: ok('INVALID_STATE: declined, or no email address.'),
      422: ok('VALIDATION_FAILED.'),
    },
  },
  {
    operationId: 'recordPayment',
    method: 'post',
    path: '/v1/quotes/{id}/payment',
    summary: 'Record that the organiser has paid a confirmed booking.',
    roles: BOOKING,
    idempotent: true,
    request: RecordPaymentRequest,
    responses: { 200: ok('Recorded.', Quote), 404: ok('NOT_FOUND.'), 409: ok('INVALID_STATE.') },
  },
  {
    operationId: 'emailInvoice',
    method: 'post',
    path: '/v1/quotes/{id}/email-invoice',
    summary: 'Email the invoice PDF; only after payment is recorded.',
    roles: BOOKING,
    idempotent: true,
    request: EmailRequest,
    responses: {
      200: ok('Sent; the quote lists the email.', Quote),
      404: ok('NOT_FOUND.'),
      409: ok('INVALID_STATE: not paid yet, or no email address.'),
      422: ok('VALIDATION_FAILED.'),
    },
  },
  {
    operationId: 'getQuoteAudit',
    method: 'get',
    path: '/v1/quotes/{id}/audit',
    summary: 'Immutable event stream of a quote.',
    roles: ALL,
    idempotent: false,
    responses: { 200: ok('Events, oldest first.', QuoteEventList), 404: ok('NOT_FOUND.') },
  },
  {
    operationId: 'getAvailability',
    method: 'get',
    path: '/v1/availability',
    summary: 'Availability by room type and date range.',
    roles: ALL,
    idempotent: false,
    query: [
      {
        name: 'room_type',
        required: true,
        description: 'Room type code.',
        schema: { type: 'string' },
      },
      {
        name: 'from',
        required: true,
        description: 'First night.',
        schema: { type: 'string', format: 'date' },
      },
      {
        name: 'to',
        required: true,
        description: 'Last night (inclusive).',
        schema: { type: 'string', format: 'date' },
      },
    ],
    responses: { 200: ok('Inventory nights.', AvailabilityResponse) },
  },
  {
    operationId: 'createImportUpload',
    method: 'post',
    path: '/v1/imports/{kind}/uploads',
    summary: 'Get a presigned S3 URL for an inventory or rates file.',
    roles: ADMIN,
    idempotent: true,
    request: ImportUploadRequest,
    responses: { 200: ok('Upload URL.', ImportUploadResponse) },
  },
  {
    operationId: 'validateImport',
    method: 'post',
    path: '/v1/imports/{kind}/{importId}/validate',
    summary: 'Dry run: row-level report, nothing written.',
    roles: ADMIN,
    idempotent: true,
    responses: { 200: ok('Validation report.', ImportReport), 404: ok('NOT_FOUND.') },
  },
  {
    operationId: 'commitImport',
    method: 'post',
    path: '/v1/imports/{kind}/{importId}/commit',
    summary: 'Commit a validated import. Identical content is a no-op.',
    roles: ADMIN,
    idempotent: true,
    responses: {
      200: ok('Commit report.', ImportReport),
      404: ok('NOT_FOUND.'),
      409: ok('INVALID_STATE.'),
    },
  },
  {
    operationId: 'exportQuotes',
    method: 'get',
    path: '/v1/exports/quotes',
    summary: 'Quotes as JSON or CSV download link.',
    roles: ALL,
    idempotent: false,
    query: [
      {
        name: 'format',
        required: true,
        description: 'csv or json.',
        schema: { type: 'string', enum: ['csv', 'json'] },
      },
    ],
    responses: { 200: ok('Download link.', ExportLink) },
  },
  {
    operationId: 'exportEvidence',
    method: 'get',
    path: '/v1/exports/evidence',
    summary: 'Evidence bundle (baseline, scope, results, ledger) download link.',
    roles: ALL,
    idempotent: false,
    responses: { 200: ok('Download link.', ExportLink) },
  },
  {
    operationId: 'getPolicy',
    method: 'get',
    path: '/v1/policy',
    summary: 'Read the property policy.',
    roles: ADMIN,
    idempotent: false,
    responses: { 200: ok('Policy.', Policy) },
  },
  {
    operationId: 'updatePolicy',
    method: 'put',
    path: '/v1/policy',
    summary: 'Update the policy with an optimistic version check.',
    roles: ADMIN,
    idempotent: false,
    request: PolicyUpdateRequest,
    responses: { 200: ok('Updated policy.', Policy), 409: ok('VERSION_CONFLICT.') },
  },
];
