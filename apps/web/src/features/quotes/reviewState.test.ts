import type { Quote } from '@c32/core';
import { reviewBadge, reviewBanner, reviewState } from './reviewState';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const approval = {
  approved_by: { user_id: 'meera', role: 'ServiceManager' as const },
  approved_at: '2026-10-20T06:00:00.000Z',
  reason: 'Repeat client',
  terms_hash: HASH_A,
};

/** Only the fields reviewState reads. */
const quote = (changes: Partial<Quote>, reasons: Quote['evaluation']['reasons'] = []) =>
  ({
    status: 'OFFERED',
    terms_hash: HASH_A,
    approval: null,
    review_required: false,
    evaluation: { decision: reasons.length > 0 ? 'REVIEW' : 'OFFER', reasons },
    ...changes,
  }) as Quote;

describe('review state of a saved quote', () => {
  it('a clean offer never needed review', () => {
    expect(reviewState(quote({}))).toEqual({ kind: 'none' });
    expect(reviewBanner(quote({}))).toBeNull();
  });

  it('an approval for older terms no longer counts', () => {
    const q = quote({ approval, terms_hash: HASH_B }, ['FLOOR_BREACH']);
    expect(reviewState(q).kind).toBe('outdated');
    expect(reviewBadge(reviewState(q))?.label).toBe('Approval out of date');
    expect(reviewBanner(q)?.note).toMatch(/no longer applies/);
  });

  it('an amendment below the floor needs review again, keeping the earlier approval in view', () => {
    const q = quote({ status: 'CONFIRMED', approval, review_required: true }, ['FLOOR_BREACH']);
    expect(reviewState(q).kind).toBe('amended');
    expect(reviewBanner(q)?.title).toBe('Review required after amendment');
    expect(reviewBanner(q)?.note).toMatch(/^Approved by meera on .*before the amendment/);
  });

  it('a rejected quote says so instead of asking for review', () => {
    const q = quote({ status: 'REJECTED' }, ['FLOOR_BREACH']);
    expect(reviewBanner(q)).toMatchObject({
      tone: 'danger',
      title: 'Rejected by a Service Manager',
    });
    expect(reviewBadge(reviewState(q))).toBeNull();
  });

  it('an approval for an unknown cost is not called "below the floor"', () => {
    const q = quote({ approval }, ['UNKNOWN_COST']);
    expect(reviewBanner(q)?.title).toBe('Approved by a Service Manager');
  });
});
