import {
  AmendmentRequest,
  ApproveRequest,
  CancelRequest,
  CONTRACT_VERSION,
  ExtendRequest,
  ImportKind,
  ImportUploadRequest,
  INITIAL_STATUS,
  parseWith,
  PolicyUpdateRequest,
  problem,
  QuoteRequest,
  RejectRequest,
  stayNights,
} from '@c32/core';
import type {
  Actor,
  ErrorCode,
  ImportReport,
  ProblemOptions,
  Quote,
  QuoteEventType,
  QuoteStatus,
  Role,
} from '@c32/core';
import { http, HttpResponse } from 'msw';
import type { z } from 'zod';
import { parseMockToken } from './auth';
import { evaluate } from './evaluate';
import { mockHash } from './store';
import type { MockStore } from './store';

const PROBLEM_HEADERS = { 'Content-Type': 'application/problem+json' };

function problemResponse(code: ErrorCode, opts?: ProblemOptions) {
  const body = problem(code, opts);
  return HttpResponse.json(body, { status: body.status, headers: PROBLEM_HEADERS });
}

const SALES_OWNER: readonly Role[] = ['Sales', 'Owner'];
const OWNER: readonly Role[] = ['Owner'];
const ALL: readonly Role[] = ['Sales', 'Owner', 'Viewer'];

const OPEN: readonly QuoteStatus[] = ['OFFERED', 'PENDING_REVIEW'];

/**
 * In-memory API that follows the contract in @c32/core: same paths, roles, status codes,
 * problem+json errors and idempotency rules. Responses are validated against the contract
 * schemas in the test suite, so the mocks cannot drift from it.
 */
export function createHandlers(store: MockStore) {
  const iso = () => store.now().toISOString();

  // --- helpers -------------------------------------------------------------

  function authorise(request: Request, roles: readonly Role[]): Actor | Response {
    const actor = parseMockToken(request.headers.get('Authorization'));
    if (!actor) return problemResponse('UNAUTHENTICATED');
    if (!roles.includes(actor.role)) {
      return problemResponse('FORBIDDEN', { detail: `Role ${actor.role} cannot use this route.` });
    }
    return actor;
  }

  async function readBody<S extends z.ZodType>(request: Request, schema: S) {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return {
        error: problemResponse('VALIDATION_FAILED', {
          errors: [{ path: '', code: 'INVALID_JSON', message: 'Body is not valid JSON' }],
        }),
      };
    }
    const result = parseWith(schema, raw);
    if (!result.ok) {
      return { error: problemResponse('VALIDATION_FAILED', { errors: result.issues }) };
    }
    return { value: result.value as z.infer<S>, raw };
  }

  /** Replays a stored response for the same key and request, or rejects a reused key (BR-17). */
  async function idempotent(
    request: Request,
    actor: Actor,
    run: () => Promise<Response> | Response,
  ): Promise<Response> {
    const key = request.headers.get('Idempotency-Key');
    if (!key) {
      return problemResponse('VALIDATION_FAILED', {
        errors: [{ path: 'Idempotency-Key', code: 'REQUIRED', message: 'Header is required' }],
      });
    }
    const body = await request.clone().text();
    const fingerprint = `${request.method} ${new URL(request.url).pathname} ${body}`;
    const storeKey = `${actor.user_id}:${key}`;
    const previous = store.idempotency.get(storeKey);
    if (previous) {
      if (previous.fingerprint !== fingerprint) return problemResponse('IDEMPOTENCY_CONFLICT');
      return HttpResponse.json(previous.body as Parameters<typeof HttpResponse.json>[0], {
        status: previous.status,
      });
    }
    const response = await run();
    if (response.ok) {
      store.idempotency.set(storeKey, {
        fingerprint,
        status: response.status,
        body: await response.clone().json(),
      });
    }
    return response;
  }

  function nightsOf(quote: Quote) {
    return stayNights(quote.evaluation.check_in, quote.evaluation.nights);
  }

  /** Move rooms between the held, confirmed and available columns, keeping the ledger balanced. */
  function moveRooms(
    quote: Quote,
    rooms: number,
    from: 'held' | 'confirmed' | 'available',
    to: 'held' | 'confirmed' | 'available',
  ) {
    const column = {
      held: 'held_units',
      confirmed: 'confirmed_units',
      available: 'available_units',
    } as const;
    for (const date of nightsOf(quote)) {
      const row = store.inventory.find(
        (r) => r.date === date && r.room_type === quote.request.room_type,
      );
      if (!row || row.available_units === null) continue;
      row[column[from]] -= rooms;
      row[column[to]] += rooms;
    }
  }

  /** No hold is ever taken while availability is unknown (the engine reports that reason). */
  function heldRooms(quote: Quote) {
    return quote.evaluation.reasons.includes('UNKNOWN_AVAILABILITY')
      ? 0
      : quote.evaluation.offered_rooms;
  }

  function save(quote: Quote, changes: Partial<Quote>): Quote {
    const next: Quote = { ...quote, ...changes, updated_at: iso() };
    store.quotes.set(next.quote_id, next);
    return next;
  }

  /** Quotes expire lazily on read in the mock; the real system uses a scheduled worker. */
  function refresh(quote: Quote): Quote {
    if (
      OPEN.includes(quote.status) &&
      quote.valid_until !== null &&
      new Date(quote.valid_until).getTime() <= store.now().getTime()
    ) {
      moveRooms(quote, heldRooms(quote), 'held', 'available');
      const expired = save(quote, { status: 'EXPIRED', version: quote.version + 1 });
      store.addEvent(expired, 'EXPIRED', { user_id: 'system', role: 'Owner' });
      return expired;
    }
    return quote;
  }

  function find(id: string): Quote | undefined {
    const quote = store.quotes.get(id);
    return quote ? refresh(quote) : undefined;
  }

  function transition(
    quote: Quote,
    status: QuoteStatus,
    event: QuoteEventType,
    actor: Actor,
    reason?: string,
    extra: Partial<Quote> = {},
  ): Quote {
    const next = save(quote, { status, version: quote.version + 1, ...extra });
    store.addEvent(next, event, actor, reason, { status: quote.status }, { status });
    return next;
  }

  const termsHash = (request: QuoteRequest, rooms: number, rate: number | null) =>
    mockHash(JSON.stringify({ request, rooms, rate }));

  // --- handlers --------------------------------------------------------------

  const notFound = (id: string) =>
    problemResponse('NOT_FOUND', { detail: `Quote ${id} was not found.` });

  return [
    http.get('*/health', () =>
      HttpResponse.json({
        status: 'ok',
        service: 'c32-api-mock',
        version: '0.0.0-mock',
        contract_version: CONTRACT_VERSION,
      }),
    ),

    http.post('*/v1/quotes/preview', async ({ request }) => {
      const actor = authorise(request, SALES_OWNER);
      if (actor instanceof Response) return actor;
      const body = await readBody(request, QuoteRequest);
      if (body.error) return body.error;
      const { evaluation, validity } = evaluate({
        request: body.value,
        policy: store.policy,
        inventory: store.inventory,
        ratePlan: store.ratePlan,
        nowMs: store.now().getTime(),
      });
      return HttpResponse.json({
        evaluation,
        valid_until: evaluation.decision === 'DECLINE' ? null : validity.valid_until,
        terms_hash: termsHash(
          body.value,
          evaluation.offered_rooms,
          body.value.rate_per_room_night_inr ?? null,
        ),
      });
    }),

    http.post('*/v1/quotes', async ({ request }) => {
      const actor = authorise(request, SALES_OWNER);
      if (actor instanceof Response) return actor;
      return idempotent(request, actor, async () => {
        const body = await readBody(request.clone(), QuoteRequest);
        if (body.error) return body.error;
        const { evaluation, validity } = evaluate({
          request: body.value,
          policy: store.policy,
          inventory: store.inventory,
          ratePlan: store.ratePlan,
          nowMs: store.now().getTime(),
        });
        const status = INITIAL_STATUS[evaluation.decision];
        const now = iso();
        const quote: Quote = {
          quote_id: store.nextId(),
          property_id: store.policy.property_id,
          status,
          version: 1,
          request: body.value,
          evaluation,
          terms_hash: termsHash(
            body.value,
            evaluation.offered_rooms,
            body.value.rate_per_room_night_inr ?? null,
          ),
          issued_at: now,
          valid_until: status === 'DECLINED' ? null : validity.valid_until,
          created_by: actor,
          created_at: now,
          updated_at: now,
          approval: null,
          review_required: false,
        };
        store.quotes.set(quote.quote_id, quote);
        store.addEvent(quote, status === 'DECLINED' ? 'QUOTE_DECLINED' : 'QUOTE_CREATED', actor);
        if (status !== 'DECLINED' && heldRooms(quote) > 0) {
          moveRooms(quote, heldRooms(quote), 'available', 'held');
          store.addEvent(quote, 'HOLD_ACQUIRED', actor);
        }
        return HttpResponse.json(quote, { status: status === 'DECLINED' ? 200 : 201 });
      });
    }),

    http.get('*/v1/quotes', ({ request }) => {
      const actor = authorise(request, ALL);
      if (actor instanceof Response) return actor;
      const params = new URL(request.url).searchParams;
      const limit = Number(params.get('limit') ?? 25);
      const offset = Number(params.get('cursor') ?? 0);
      const items = [...store.quotes.values()]
        .map(refresh)
        .filter((q) => !params.get('status') || q.status === params.get('status'))
        .filter((q) => !params.get('from') || q.evaluation.check_in >= (params.get('from') ?? ''))
        .filter((q) => !params.get('to') || q.evaluation.check_in <= (params.get('to') ?? ''))
        .sort(
          (a, b) =>
            b.created_at.localeCompare(a.created_at) || b.quote_id.localeCompare(a.quote_id),
        );
      const page = items.slice(offset, offset + limit);
      const next = offset + limit < items.length ? String(offset + limit) : null;
      return HttpResponse.json({ items: page, next_cursor: next });
    }),

    http.get('*/v1/quotes/:id', ({ request, params }) => {
      const actor = authorise(request, ALL);
      if (actor instanceof Response) return actor;
      const quote = find(String(params.id));
      return quote ? HttpResponse.json(quote) : notFound(String(params.id));
    }),

    http.get('*/v1/quotes/:id/audit', ({ request, params }) => {
      const actor = authorise(request, ALL);
      if (actor instanceof Response) return actor;
      const id = String(params.id);
      if (!find(id)) return notFound(id);
      return HttpResponse.json({ items: store.events.filter((e) => e.quote_id === id) });
    }),

    http.post('*/v1/quotes/:id/confirm', async ({ request, params }) => {
      const actor = authorise(request, SALES_OWNER);
      if (actor instanceof Response) return actor;
      return idempotent(request, actor, () => {
        const quote = find(String(params.id));
        if (!quote) return notFound(String(params.id));
        if (quote.status === 'EXPIRED') return problemResponse('QUOTE_EXPIRED');
        if (quote.status === 'PENDING_REVIEW') return problemResponse('APPROVAL_REQUIRED');
        if (quote.status !== 'OFFERED') return problemResponse('INVALID_STATE');
        if (
          !quote.evaluation.auto_confirm_allowed &&
          quote.evaluation.decision !== 'PARTIAL_OFFER' &&
          !quote.approval
        ) {
          return problemResponse('APPROVAL_REQUIRED');
        }
        moveRooms(quote, heldRooms(quote), 'held', 'confirmed');
        return HttpResponse.json(transition(quote, 'CONFIRMED', 'CONFIRMED', actor));
      });
    }),

    http.post('*/v1/quotes/:id/approve', async ({ request, params }) => {
      const actor = authorise(request, OWNER);
      if (actor instanceof Response) return actor;
      return idempotent(request, actor, async () => {
        const body = await readBody(request.clone(), ApproveRequest);
        if (body.error) return body.error;
        const quote = find(String(params.id));
        if (!quote) return notFound(String(params.id));
        if (quote.status !== 'PENDING_REVIEW') return problemResponse('INVALID_STATE');
        if (quote.created_by.user_id === actor.user_id) {
          return problemResponse('FORBIDDEN', {
            detail: 'You cannot approve your own quote (four-eyes rule).',
          });
        }
        return HttpResponse.json(
          transition(quote, 'OFFERED', 'APPROVED', actor, body.value.reason, {
            approval: {
              approved_by: actor,
              approved_at: iso(),
              reason: body.value.reason,
              terms_hash: quote.terms_hash,
            },
          }),
        );
      });
    }),

    http.post('*/v1/quotes/:id/reject', async ({ request, params }) => {
      const actor = authorise(request, OWNER);
      if (actor instanceof Response) return actor;
      return idempotent(request, actor, async () => {
        const body = await readBody(request.clone(), RejectRequest);
        if (body.error) return body.error;
        const quote = find(String(params.id));
        if (!quote) return notFound(String(params.id));
        if (quote.status !== 'PENDING_REVIEW') return problemResponse('INVALID_STATE');
        moveRooms(quote, heldRooms(quote), 'held', 'available');
        store.addEvent(quote, 'HOLD_RELEASED', actor);
        return HttpResponse.json(
          transition(quote, 'REJECTED', 'REJECTED', actor, body.value.reason),
        );
      });
    }),

    http.post('*/v1/quotes/:id/extend', async ({ request, params }) => {
      const actor = authorise(request, SALES_OWNER);
      if (actor instanceof Response) return actor;
      return idempotent(request, actor, async () => {
        const body = await readBody(request.clone(), ExtendRequest);
        if (body.error) return body.error;
        const quote = find(String(params.id));
        if (!quote) return notFound(String(params.id));
        if (quote.status === 'EXPIRED') return problemResponse('QUOTE_EXPIRED');
        if (!OPEN.includes(quote.status) || quote.valid_until === null)
          return problemResponse('INVALID_STATE');
        const until = new Date(
          new Date(quote.valid_until).getTime() + body.value.hours * 3_600_000,
        ).toISOString();
        const next = save(quote, { valid_until: until, version: quote.version + 1 });
        store.addEvent(next, 'EXTENDED', actor);
        return HttpResponse.json(next);
      });
    }),

    http.post('*/v1/quotes/:id/amendments', async ({ request, params }) => {
      const actor = authorise(request, SALES_OWNER);
      if (actor instanceof Response) return actor;
      return idempotent(request, actor, async () => {
        const body = await readBody(request.clone(), AmendmentRequest);
        if (body.error) return body.error;
        const quote = find(String(params.id));
        if (!quote) return notFound(String(params.id));
        if (quote.status !== 'CONFIRMED') return problemResponse('INVALID_STATE');
        const current = heldRooms(quote);
        if (body.value.rooms >= current) {
          return problemResponse('VALIDATION_FAILED', {
            errors: [
              { path: 'rooms', code: 'OUT_OF_RANGE', message: `Must be fewer than ${current}` },
            ],
          });
        }
        // Release rooms first, then re-check the floor (BR-16).
        moveRooms(quote, current - body.value.rooms, 'confirmed', 'available');
        const request2 = { ...quote.request, rooms: body.value.rooms };
        const { evaluation } = evaluate({
          request: request2,
          policy: store.policy,
          inventory: store.inventory,
          ratePlan: store.ratePlan,
          nowMs: store.now().getTime(),
        });
        const next = save(quote, {
          request: request2,
          evaluation: {
            ...evaluation,
            requested_rooms: body.value.rooms,
            offered_rooms: body.value.rooms,
          },
          version: quote.version + 1,
          review_required: evaluation.reasons.includes('FLOOR_BREACH'),
        });
        store.addEvent(next, 'AMENDED', actor, body.value.reason);
        return HttpResponse.json(next);
      });
    }),

    http.post('*/v1/quotes/:id/cancel', async ({ request, params }) => {
      const actor = authorise(request, SALES_OWNER);
      if (actor instanceof Response) return actor;
      return idempotent(request, actor, async () => {
        const body = await readBody(request.clone(), CancelRequest);
        if (body.error) return body.error;
        const quote = find(String(params.id));
        if (!quote) return notFound(String(params.id));
        if (quote.status !== 'CONFIRMED' && !OPEN.includes(quote.status))
          return problemResponse('INVALID_STATE');
        moveRooms(
          quote,
          heldRooms(quote),
          quote.status === 'CONFIRMED' ? 'confirmed' : 'held',
          'available',
        );
        store.addEvent(quote, 'HOLD_RELEASED', actor);
        return HttpResponse.json(
          transition(quote, 'CANCELLED', 'CANCELLED', actor, body.value.reason),
        );
      });
    }),

    http.get('*/v1/availability', ({ request }) => {
      const actor = authorise(request, ALL);
      if (actor instanceof Response) return actor;
      const params = new URL(request.url).searchParams;
      const missing = ['room_type', 'from', 'to'].filter((n) => !params.get(n));
      if (missing.length > 0) {
        return problemResponse('VALIDATION_FAILED', {
          errors: missing.map((path) => ({ path, code: 'REQUIRED' as const, message: 'Required' })),
        });
      }
      const [roomType, from, to] = [
        params.get('room_type'),
        params.get('from'),
        params.get('to'),
      ] as string[];
      return HttpResponse.json({
        room_type: roomType,
        from,
        to,
        nights: store.inventory.filter(
          (r) => r.room_type === roomType && r.date >= (from ?? '') && r.date <= (to ?? ''),
        ),
      });
    }),

    http.post('*/v1/imports/:kind/uploads', async ({ request, params }) => {
      const actor = authorise(request, OWNER);
      if (actor instanceof Response) return actor;
      return idempotent(request, actor, async () => {
        const kind = ImportKind.safeParse(params.kind);
        if (!kind.success) return problemResponse('NOT_FOUND');
        const body = await readBody(request.clone(), ImportUploadRequest);
        if (body.error) return body.error;
        return HttpResponse.json({
          import_id: store.nextId(),
          upload_url: 'https://uploads.c32.example/presigned',
          expires_at: new Date(store.now().getTime() + 15 * 60_000).toISOString(),
        });
      });
    }),

    ...(['validate', 'commit'] as const).map((step) =>
      http.post(`*/v1/imports/:kind/:importId/${step}`, async ({ request, params }) => {
        const actor = authorise(request, OWNER);
        if (actor instanceof Response) return actor;
        return idempotent(request, actor, () => {
          const kind = ImportKind.safeParse(params.kind);
          if (!kind.success) return problemResponse('NOT_FOUND');
          const report: ImportReport = {
            import_id: String(params.importId),
            kind: kind.data,
            content_sha256: mockHash(String(params.importId)),
            status: step === 'validate' ? 'VALIDATED' : 'COMMITTED',
            rows_total: 3,
            rows_accepted: 2,
            rows_rejected: 1,
            issues: [
              {
                row: 3,
                field: 'rooms',
                code: 'INVALID_TYPE',
                message: 'rooms must be a whole number',
                severity: 'error',
              },
            ],
          };
          return HttpResponse.json(report);
        });
      }),
    ),

    http.get('*/v1/exports/quotes', ({ request }) => {
      const actor = authorise(request, ALL);
      if (actor instanceof Response) return actor;
      const format = new URL(request.url).searchParams.get('format');
      if (format !== 'csv' && format !== 'json') {
        return problemResponse('VALIDATION_FAILED', {
          errors: [{ path: 'format', code: 'INVALID_ENUM', message: 'Must be csv or json' }],
        });
      }
      return HttpResponse.json({
        download_url: `https://downloads.c32.example/exports/quotes.${format}`,
        format,
        expires_at: new Date(store.now().getTime() + 15 * 60_000).toISOString(),
      });
    }),

    http.get('*/v1/exports/evidence', ({ request }) => {
      const actor = authorise(request, ALL);
      if (actor instanceof Response) return actor;
      return HttpResponse.json({
        download_url: 'https://downloads.c32.example/exports/evidence.zip',
        format: 'zip',
        expires_at: new Date(store.now().getTime() + 15 * 60_000).toISOString(),
      });
    }),

    http.get('*/v1/policy', ({ request }) => {
      const actor = authorise(request, OWNER);
      if (actor instanceof Response) return actor;
      return HttpResponse.json(store.policy);
    }),

    http.put('*/v1/policy', async ({ request }) => {
      const actor = authorise(request, OWNER);
      if (actor instanceof Response) return actor;
      const body = await readBody(request, PolicyUpdateRequest);
      if (body.error) return body.error;
      if (body.value.version !== store.policy.version) return problemResponse('VERSION_CONFLICT');
      store.policy = { ...store.policy, ...body.value, version: store.policy.version + 1 };
      return HttpResponse.json(store.policy);
    }),
  ];
}
