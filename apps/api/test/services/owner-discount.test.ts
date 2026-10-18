import { afterEach, describe, expect, it } from 'vitest';
import { getEvents } from '../../src/data/quotes.js';
import { confirmQuote } from '../../src/services/confirm-quote.js';
import { createQuote } from '../../src/services/create-quote.js';
import { ServiceError } from '../../src/services/errors.js';
import { approveQuote, ownerDiscount } from '../../src/services/review.js';
import { hasDb } from '../data/local-db.js';
import { owner as manager, request, sales as reception, serviceHarness } from './harness.js';

const boss = { user_id: 'boss-1', role: 'Owner' as const };
const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => (e instanceof ServiceError ? e.code : String(e)),
  );

describe.skipIf(!hasDb)('send to the Owner for a discount (DynamoDB Local, D-062)', () => {
  let drop: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await drop?.();
    drop = undefined;
  });
  async function setup() {
    const h = await serviceHarness();
    drop = h.drop;
    return h;
  }

  it('the Service Manager sends it, the Owner gives 30%, then it can be confirmed', async () => {
    const { deps, ctx } = await setup();
    const q = await createQuote(deps, request({ send_to_owner: true }), manager);
    expect(q).toMatchObject({ status: 'PENDING_REVIEW', awaiting_owner: true });
    expect(q.request).not.toHaveProperty('send_to_owner');
    expect(
      await codeOf(
        approveQuote(
          deps,
          q.quote_id,
          { user_id: 'manager-2', role: 'ServiceManager' },
          'not mine to approve',
        ),
      ),
    ).toBe('INVALID_STATE');

    // 20 room-nights at the 2000 full price less 30% = 1400 a night.
    const d = await ownerDiscount(deps, q.quote_id, boss, 30, null);
    expect(d).toMatchObject({
      status: 'OFFERED',
      request: { discount_pct: 30 },
      approval: { approved_by: boss, reason: 'Owner discount 30%' },
    });
    expect(d).not.toHaveProperty('awaiting_owner');
    expect(d.evaluation.totals.room_revenue_inr).toBe(28_000);
    expect(d.approval?.terms_hash).toBe(d.terms_hash);

    expect((await confirmQuote(deps, q.quote_id, reception)).status).toBe('CONFIRMED');
    expect((await getEvents(ctx, q.quote_id)).map((e) => e.type)).toEqual([
      'QUOTE_CREATED',
      'OWNER_DISCOUNTED',
      'CONFIRMED',
    ]);
  });

  it('only the Service Manager sends, only the Owner discounts, only sent quotes', async () => {
    const { deps } = await setup();
    expect(await codeOf(createQuote(deps, request({ send_to_owner: true }), reception))).toBe(
      'FORBIDDEN',
    );
    const sent = await createQuote(deps, request({ send_to_owner: true }), manager);
    expect(await codeOf(ownerDiscount(deps, sent.quote_id, manager, 5, null))).toBe('FORBIDDEN');
    const normal = await createQuote(deps, request(), manager);
    expect(await codeOf(ownerDiscount(deps, normal.quote_id, boss, 5, null))).toBe('INVALID_STATE');
  });
});
