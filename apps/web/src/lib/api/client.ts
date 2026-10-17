import {
  AvailabilityResponse,
  ExportLink,
  HealthResponse,
  ImportReport,
  ImportUploadResponse,
  Policy,
  ProblemDetails,
  Quote,
  QuoteEventList,
  QuoteList,
  QuotePreviewResponse,
} from '@c32/core';
import type {
  AmendmentRequest,
  ApproveRequest,
  CancelRequest,
  ExtendRequest,
  ImportKind,
  ImportUploadRequest,
  ListQuotesQuery,
  PolicyUpdateRequest,
  QuoteRequest,
  RejectRequest,
} from '@c32/core';
import type { z } from 'zod';
import { ApiError, localProblem } from './errors';

export interface ApiClientOptions {
  /** Empty string means same origin. */
  baseUrl?: string;
  /** Returns the current access token, or null when signed out. */
  getToken: () => string | null;
  /** Called on a 401 so the app can send the person back to sign-in. */
  onUnauthenticated?: () => void;
  fetchImpl?: typeof fetch;
}

/** Every mutating call needs a key (BR-17). Create one per user intent and reuse it on retry. */
export interface MutationOptions {
  idempotencyKey: string;
}

type Query = Record<string, string | number | undefined>;

interface CallSpec<T> {
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  schema: z.ZodType<T>;
  query?: Query | undefined;
  body?: unknown;
  idempotencyKey?: string | undefined;
}

const enc = encodeURIComponent;

export function createApiClient(options: ApiClientOptions) {
  const baseUrl = options.baseUrl ?? '';

  async function call<T>(spec: CallSpec<T>): Promise<T> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(spec.query ?? {})) {
      if (value !== undefined) search.set(key, String(value));
    }
    const qs = search.toString();
    const url = `${baseUrl}${spec.path}${qs ? `?${qs}` : ''}`;

    const headers: Record<string, string> = { Accept: 'application/json' };
    const token = options.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (spec.body !== undefined) headers['Content-Type'] = 'application/json';
    if (spec.idempotencyKey) headers['Idempotency-Key'] = spec.idempotencyKey;

    const doFetch = options.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await doFetch(url, {
        method: spec.method,
        headers,
        ...(spec.body !== undefined ? { body: JSON.stringify(spec.body) } : {}),
      });
    } catch {
      throw new ApiError(localProblem('INTERNAL', 'The server could not be reached.'));
    }

    const text = await response.text();
    let json: unknown = undefined;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    }

    if (!response.ok) {
      const parsed = ProblemDetails.safeParse(json);
      const problem = parsed.success
        ? parsed.data
        : localProblem(
            response.status === 401 ? 'UNAUTHENTICATED' : 'INTERNAL',
            'Unexpected error response.',
          );
      if (problem.code === 'UNAUTHENTICATED') options.onUnauthenticated?.();
      throw new ApiError(problem);
    }

    const parsed = spec.schema.safeParse(json);
    if (!parsed.success) {
      throw new ApiError(
        localProblem('INTERNAL', 'The server sent a response in an unexpected shape.'),
      );
    }
    return parsed.data;
  }

  const quote = (id: string) => `/v1/quotes/${enc(id)}`;
  const action = <B>(id: string, verb: string, body: B | undefined, o: MutationOptions) =>
    call({
      method: 'POST',
      path: `${quote(id)}/${verb}`,
      schema: Quote,
      body,
      idempotencyKey: o.idempotencyKey,
    });

  return {
    getHealth: () => call({ method: 'GET', path: '/health', schema: HealthResponse }),

    previewQuote: (body: QuoteRequest) =>
      call({ method: 'POST', path: '/v1/quotes/preview', schema: QuotePreviewResponse, body }),
    createQuote: (body: QuoteRequest, o: MutationOptions) =>
      call({
        method: 'POST',
        path: '/v1/quotes',
        schema: Quote,
        body,
        idempotencyKey: o.idempotencyKey,
      }),
    listQuotes: (query: ListQuotesQuery = {}) =>
      call({ method: 'GET', path: '/v1/quotes', schema: QuoteList, query }),
    getQuote: (id: string) => call({ method: 'GET', path: quote(id), schema: Quote }),
    getQuoteAudit: (id: string) =>
      call({ method: 'GET', path: `${quote(id)}/audit`, schema: QuoteEventList }),

    confirmQuote: (id: string, o: MutationOptions) => action(id, 'confirm', undefined, o),
    approveQuote: (id: string, body: ApproveRequest, o: MutationOptions) =>
      action(id, 'approve', body, o),
    rejectQuote: (id: string, body: RejectRequest, o: MutationOptions) =>
      action(id, 'reject', body, o),
    extendQuote: (id: string, body: ExtendRequest, o: MutationOptions) =>
      action(id, 'extend', body, o),
    amendQuote: (id: string, body: AmendmentRequest, o: MutationOptions) =>
      action(id, 'amendments', body, o),
    cancelQuote: (id: string, body: CancelRequest, o: MutationOptions) =>
      action(id, 'cancel', body, o),

    getAvailability: (query: { room_type: string; from: string; to: string }) =>
      call({ method: 'GET', path: '/v1/availability', schema: AvailabilityResponse, query }),

    createImportUpload: (kind: ImportKind, body: ImportUploadRequest, o: MutationOptions) =>
      call({
        method: 'POST',
        path: `/v1/imports/${enc(kind)}/uploads`,
        schema: ImportUploadResponse,
        body,
        idempotencyKey: o.idempotencyKey,
      }),
    validateImport: (kind: ImportKind, importId: string, o: MutationOptions) =>
      call({
        method: 'POST',
        path: `/v1/imports/${enc(kind)}/${enc(importId)}/validate`,
        schema: ImportReport,
        idempotencyKey: o.idempotencyKey,
      }),
    commitImport: (kind: ImportKind, importId: string, o: MutationOptions) =>
      call({
        method: 'POST',
        path: `/v1/imports/${enc(kind)}/${enc(importId)}/commit`,
        schema: ImportReport,
        idempotencyKey: o.idempotencyKey,
      }),

    exportQuotes: (format: 'csv' | 'json') =>
      call({ method: 'GET', path: '/v1/exports/quotes', schema: ExportLink, query: { format } }),
    exportEvidence: () => call({ method: 'GET', path: '/v1/exports/evidence', schema: ExportLink }),

    getPolicy: () => call({ method: 'GET', path: '/v1/policy', schema: Policy }),
    updatePolicy: (body: PolicyUpdateRequest) =>
      call({ method: 'PUT', path: '/v1/policy', schema: Policy, body }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
