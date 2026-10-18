import type { Quote, QuoteRequest, Role } from '@c32/core';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { makeMockToken } from '../../mocks/auth';
import { createTestApi } from '../../mocks/server';
import { ApiError, createApiClient, newIdempotencyKey } from '.';
import type { ApiClient } from '.';

let nowMs = Date.parse('2026-10-20T06:00:00Z');
const { server, store } = createTestApi(() => new Date(nowMs));

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

let unauthenticated = 0;

function clientFor(user: string | null, role: Role = 'Reception'): ApiClient {
  return createApiClient({
    baseUrl: 'http://api.test',
    getToken: () => (user ? makeMockToken({ user_id: user, role }) : null),
    onUnauthenticated: () => {
      unauthenticated += 1;
    },
  });
}

const fixtureRequest = (overrides: Partial<QuoteRequest> = {}): QuoteRequest => ({
  organiser: { name: 'Fictional Events Pvt Ltd' },
  stay: { check_in: '2026-11-01', nights: 2 },
  room_type: 'standard',
  rooms: 10,
  rate_per_room_night_inr: 2000,
  ...overrides,
});

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('Expected the call to fail');
}

const available = async (client: ApiClient) => {
  const res = await client.getAvailability({
    room_type: 'standard',
    from: '2026-11-01',
    to: '2026-11-02',
  });
  return res.nights.map((n) => n.available_units);
};

beforeEach(() => {
  nowMs = Date.parse('2026-10-20T06:00:00Z');
  unauthenticated = 0;
  store.quotes.clear();
  store.events.length = 0;
  store.idempotency.clear();
  for (const row of store.inventory) {
    if (row.total_units !== null) {
      row.available_units = row.total_units;
      row.held_units = 0;
      row.confirmed_units = 0;
    }
  }
});

describe('public checks from the fixture', () => {
  it('check 1: 10 rooms for 2 nights at 2000 gives revenue 40000 and contribution 24000', async () => {
    const { evaluation } = await clientFor('asha').previewQuote(fixtureRequest());
    expect(evaluation.decision).toBe('OFFER');
    expect(evaluation.totals.room_revenue_inr).toBe(40000);
    expect(evaluation.totals.contribution_inr).toBe(24000);
    expect(evaluation.totals.min_rate_per_room_night_inr).toBe(1800);
    expect(evaluation.auto_confirm_allowed).toBe(true);
  });

  it('check 2: 12 rooms when 10 are available is a partial offer, never an over-hold', async () => {
    const sales = clientFor('asha');
    const quote = await sales.createQuote(fixtureRequest({ rooms: 12 }), {
      idempotencyKey: newIdempotencyKey(),
    });
    expect(quote.evaluation.decision).toBe('PARTIAL_OFFER');
    expect(quote.evaluation.offered_rooms).toBe(10);
    expect(quote.evaluation.shortfall_rooms).toBe(2);
    expect(quote.evaluation.auto_confirm_allowed).toBe(false);
    expect(await available(sales)).toEqual([0, 0]);

    // Nothing is left, so a second request declines instead of holding rooms that are gone.
    const second = await sales.createQuote(fixtureRequest({ rooms: 1 }), {
      idempotencyKey: newIdempotencyKey(),
    });
    expect(second.status).toBe('DECLINED');
    expect(second.valid_until).toBeNull();
    expect(await available(sales)).toEqual([0, 0]);
  });

  it('check 3: a rate below the floor needs review and cannot auto-confirm', async () => {
    const { evaluation } = await clientFor('asha').previewQuote(
      fixtureRequest({ rate_per_room_night_inr: 1700 }),
    );
    expect(evaluation.decision).toBe('REVIEW');
    expect(evaluation.reasons).toContain('FLOOR_BREACH');
    expect(evaluation.auto_confirm_allowed).toBe(false);
    expect(evaluation.totals.contribution_inr).toBe(18000);
    expect(evaluation.totals.shortfall_inr).toBe(2000); // 100 under 1800 on 20 room-nights
    expect(evaluation.counter_offers[0]).toMatchObject({
      type: 'RAISE_RATE',
      rate_per_room_night_inr: 1800,
    });
  });

  it('keeps unknown cost as null and requires review', async () => {
    const { evaluation } = await clientFor('asha').previewQuote(
      fixtureRequest({ room_type: 'deluxe', rooms: 2 }),
    );
    expect(evaluation.decision).toBe('REVIEW');
    expect(evaluation.reasons).toContain('UNKNOWN_COST');
    expect(evaluation.totals.contribution_inr).toBeNull();
    expect(evaluation.totals.variable_cost_inr).toBeNull();
  });

  it('treats a night with unknown availability as review, with nothing held', async () => {
    const sales = clientFor('asha');
    const quote = await sales.createQuote(
      fixtureRequest({ stay: { check_in: '2026-11-09', nights: 2 } }),
      { idempotencyKey: newIdempotencyKey() },
    );
    expect(quote.status).toBe('PENDING_REVIEW');
    expect(quote.evaluation.reasons).toEqual(['UNKNOWN_AVAILABILITY']);
    // The engine keeps the requested rooms but no hold is taken while availability is unknown.
    expect(quote.evaluation.offered_rooms).toBe(10);
    const known = store.inventory.find(
      (r) => r.date === '2026-11-09' && r.room_type === 'standard',
    );
    expect([known?.available_units, known?.held_units]).toEqual([10, 0]);
    expect(store.events.map((e) => e.type)).not.toContain('HOLD_ACQUIRED');
  });
});

describe('quote lifecycle', () => {
  it('confirms an auto-confirmable quote and moves rooms from held to confirmed', async () => {
    const sales = clientFor('asha');
    const quote = await sales.createQuote(fixtureRequest(), {
      idempotencyKey: newIdempotencyKey(),
    });
    expect(quote.status).toBe('OFFERED');
    const confirmed = await sales.confirmQuote(quote.quote_id, {
      idempotencyKey: newIdempotencyKey(),
    });
    expect(confirmed.status).toBe('CONFIRMED');
    const nights = (
      await sales.getAvailability({ room_type: 'standard', from: '2026-11-01', to: '2026-11-02' })
    ).nights;
    expect(nights.map((n) => [n.available_units, n.held_units, n.confirmed_units])).toEqual([
      [0, 0, 10],
      [0, 0, 10],
    ]);
  });

  it('blocks confirming a below-floor quote and enforces four-eyes approval', async () => {
    const sales = clientFor('asha');
    const quote = await sales.createQuote(fixtureRequest({ rate_per_room_night_inr: 1700 }), {
      idempotencyKey: newIdempotencyKey(),
    });
    expect(quote.status).toBe('PENDING_REVIEW');

    const blocked = await failure(
      sales.confirmQuote(quote.quote_id, { idempotencyKey: newIdempotencyKey() }),
    );
    expect(blocked.code).toBe('APPROVAL_REQUIRED');

    // The creator, even as a Service Manager, cannot approve their own quote.
    const self = await failure(
      clientFor('asha', 'ServiceManager').approveQuote(
        quote.quote_id,
        { reason: 'Looks fine to me' },
        {
          idempotencyKey: newIdempotencyKey(),
        },
      ),
    );
    expect(self.code).toBe('FORBIDDEN');

    // Reception cannot approve at all.
    const wrongRole = await failure(
      clientFor('ravi', 'Reception').approveQuote(
        quote.quote_id,
        { reason: 'Looks fine to me' },
        {
          idempotencyKey: newIdempotencyKey(),
        },
      ),
    );
    expect(wrongRole.code).toBe('FORBIDDEN');

    const owner = clientFor('meera', 'ServiceManager');
    const approved = await owner.approveQuote(
      quote.quote_id,
      { reason: 'Repeat client, strategic' },
      {
        idempotencyKey: newIdempotencyKey(),
      },
    );
    expect(approved.status).toBe('OFFERED');
    expect(approved.approval?.approved_by.user_id).toBe('meera');
    expect(approved.approval?.terms_hash).toBe(approved.terms_hash);

    const confirmed = await sales.confirmQuote(quote.quote_id, {
      idempotencyKey: newIdempotencyKey(),
    });
    expect(confirmed.status).toBe('CONFIRMED');
  });

  it('expires a quote after its validity window and releases the rooms', async () => {
    const sales = clientFor('asha');
    const quote = await sales.createQuote(fixtureRequest(), {
      idempotencyKey: newIdempotencyKey(),
    });
    expect(await available(sales)).toEqual([0, 0]);

    nowMs += 73 * 3_600_000;
    const error = await failure(
      sales.confirmQuote(quote.quote_id, { idempotencyKey: newIdempotencyKey() }),
    );
    expect(error.code).toBe('QUOTE_EXPIRED');
    expect(error.status).toBe(410);
    expect(await available(sales)).toEqual([10, 10]);
    expect((await sales.getQuote(quote.quote_id)).status).toBe('EXPIRED');
  });

  it('records an audit trail, oldest first', async () => {
    const sales = clientFor('asha');
    const quote = await sales.createQuote(fixtureRequest(), {
      idempotencyKey: newIdempotencyKey(),
    });
    await sales.confirmQuote(quote.quote_id, { idempotencyKey: newIdempotencyKey() });
    const { items } = await sales.getQuoteAudit(quote.quote_id);
    expect(items.map((e) => e.type)).toEqual(['QUOTE_CREATED', 'HOLD_ACQUIRED', 'CONFIRMED']);
  });

  it('lists quotes newest first with a status filter', async () => {
    const sales = clientFor('asha');
    const a = await sales.createQuote(fixtureRequest({ rooms: 2 }), {
      idempotencyKey: newIdempotencyKey(),
    });
    nowMs += 1000;
    const b = await sales.createQuote(fixtureRequest({ rooms: 3 }), {
      idempotencyKey: newIdempotencyKey(),
    });
    await sales.cancelQuote(a.quote_id, {}, { idempotencyKey: newIdempotencyKey() });
    const all = await sales.listQuotes();
    expect(all.items.map((q: Quote) => q.quote_id)).toEqual([b.quote_id, a.quote_id]);
    const cancelled = await sales.listQuotes({ status: 'CANCELLED' });
    expect(cancelled.items.map((q: Quote) => q.quote_id)).toEqual([a.quote_id]);
  });
});

describe('idempotency (BR-17)', () => {
  it('replays the same response for the same key and takes one hold', async () => {
    const sales = clientFor('asha');
    const key = newIdempotencyKey();
    const first = await sales.createQuote(fixtureRequest({ rooms: 4 }), { idempotencyKey: key });
    const second = await sales.createQuote(fixtureRequest({ rooms: 4 }), { idempotencyKey: key });
    expect(second.quote_id).toBe(first.quote_id);
    expect(store.quotes.size).toBe(1);
    expect(await available(sales)).toEqual([6, 6]);
  });

  it('rejects a reused key with a different request', async () => {
    const sales = clientFor('asha');
    const key = newIdempotencyKey();
    await sales.createQuote(fixtureRequest({ rooms: 4 }), { idempotencyKey: key });
    const error = await failure(
      sales.createQuote(fixtureRequest({ rooms: 5 }), { idempotencyKey: key }),
    );
    expect(error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('generates distinct keys', () => {
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });
});

describe('errors', () => {
  it('reports field-level validation issues keyed by path', async () => {
    const bad = { ...fixtureRequest(), surprise: true } as unknown as QuoteRequest;
    const error = await failure(clientFor('asha').previewQuote(bad));
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.fieldErrors.surprise?.[0]?.code).toBe('UNKNOWN_FIELD');
  });

  it('signs out on 401', async () => {
    const error = await failure(clientFor(null).listQuotes());
    expect(error.code).toBe('UNAUTHENTICATED');
    expect(unauthenticated).toBe(1);
  });

  it('refuses a Viewer on a write route', async () => {
    const error = await failure(
      clientFor('vik', 'Viewer').createQuote(fixtureRequest(), {
        idempotencyKey: newIdempotencyKey(),
      }),
    );
    expect(error.code).toBe('FORBIDDEN');
    expect(error.friendly.nextStep).toMatch(/Service Manager/);
  });

  it('returns NOT_FOUND for an unknown quote', async () => {
    const error = await failure(clientFor('asha').getQuote('01ARZ3NDEKTSV4RRFFQ69G5FAV'));
    expect(error.code).toBe('NOT_FOUND');
  });

  it('turns an unreachable server into a retryable error', async () => {
    const client = createApiClient({
      baseUrl: 'http://api.test',
      getToken: () => null,
      fetchImpl: () => Promise.reject(new TypeError('offline')),
    });
    const error = await failure(client.getHealth());
    expect(error.code).toBe('INTERNAL');
    expect(error.friendly.action).toBe('retry');
  });

  it('rejects a response that does not match the contract', async () => {
    const client = createApiClient({
      baseUrl: 'http://api.test',
      getToken: () => null,
      fetchImpl: () =>
        Promise.resolve(new Response(JSON.stringify({ status: 'nope' }), { status: 200 })),
    });
    const error = await failure(client.getHealth());
    expect(error.code).toBe('INTERNAL');
  });
});

describe('policy and health', () => {
  it('reports health with the contract version', async () => {
    const health = await clientFor(null).getHealth();
    expect(health.status).toBe('ok');
    expect(health.contract_version).toBe('0.3.0');
  });

  it('is Service Manager only and uses an optimistic version check', async () => {
    const owner = clientFor('meera', 'ServiceManager');
    expect((await failure(clientFor('asha').getPolicy())).code).toBe('FORBIDDEN');

    const policy = await owner.getPolicy();
    const { property_id: _property, ...fields } = policy;
    const updated = await owner.updatePolicy({ ...fields, validity_hours: 48 });
    expect(updated.version).toBe(policy.version + 1);
    expect(updated.validity_hours).toBe(48);

    const stale = await failure(owner.updatePolicy({ ...fields, validity_hours: 24 }));
    expect(stale.code).toBe('VERSION_CONFLICT');
  });
});

describe('how the caller is identified', () => {
  const health = JSON.stringify({
    status: 'ok',
    service: 'c32-api',
    version: 'dev',
    contract_version: '0.3.0',
  });

  async function headersSentWith(options: Partial<Parameters<typeof createApiClient>[0]>) {
    let sent: Headers | undefined;
    const client = createApiClient({
      baseUrl: 'http://api.test',
      getToken: () => 'token-123',
      fetchImpl: (_url, init) => {
        sent = new Headers(init?.headers);
        return Promise.resolve(new Response(health, { status: 200 }));
      },
      ...options,
    });
    await client.getHealth();
    return sent as Headers;
  }

  it('sends a bearer token by default, as Cognito expects', async () => {
    const headers = await headersSentWith({});
    expect(headers.get('authorization')).toBe('Bearer token-123');
    expect(headers.get('x-dev-user')).toBeNull();
  });

  it('sends only x-dev-user in dev style, as the local API expects', async () => {
    const headers = await headersSentWith({
      authStyle: 'dev',
      getDevUser: () => ({ user_id: 'asha', role: 'Reception' }),
    });
    expect(headers.get('x-dev-user')).toBe('asha:Reception');
    expect(headers.get('authorization')).toBeNull();
  });

  it('sends no identity in dev style when nobody is signed in', async () => {
    const headers = await headersSentWith({ authStyle: 'dev', getDevUser: () => null });
    expect(headers.get('x-dev-user')).toBeNull();
    expect(headers.get('authorization')).toBeNull();
  });
});
