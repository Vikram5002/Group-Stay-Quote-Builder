import { describe, expect, it } from 'vitest';
import {
  DECISIONS,
  ERROR_CODES,
  ERROR_HTTP_STATUS,
  ERROR_TITLES,
  INITIAL_STATUS,
  QUOTE_STATUSES,
  QUOTE_TRANSITIONS,
  REASON_CODES,
  REASON_DESCRIPTIONS,
  canTransition,
  isTerminalStatus,
  problem,
  problemSlug,
} from '../src/index.js';

describe('quote lifecycle table', () => {
  it('only allows the documented transitions', () => {
    expect(canTransition('PENDING_REVIEW', 'OFFERED')).toBe(true); // approval
    expect(canTransition('OFFERED', 'CONFIRMED')).toBe(true);
    expect(canTransition('PENDING_REVIEW', 'CONFIRMED')).toBe(false); // BR-10: needs approval first
    expect(canTransition('EXPIRED', 'CONFIRMED')).toBe(false);
    expect(canTransition('CONFIRMED', 'OFFERED')).toBe(false);
  });

  it('marks exactly the end states as terminal', () => {
    const terminal = QUOTE_STATUSES.filter(isTerminalStatus);
    expect(terminal).toEqual(['DECLINED', 'REJECTED', 'EXPIRED', 'CANCELLED']);
  });

  it('never targets an unknown status', () => {
    for (const targets of Object.values(QUOTE_TRANSITIONS)) {
      for (const t of targets) expect(QUOTE_STATUSES).toContain(t);
    }
  });

  it('maps every decision to an initial status', () => {
    expect(Object.keys(INITIAL_STATUS).sort()).toEqual([...DECISIONS].sort());
    expect(INITIAL_STATUS.REVIEW).toBe('PENDING_REVIEW');
    expect(INITIAL_STATUS.DECLINE).toBe('DECLINED');
  });
});

describe('codes catalogue', () => {
  it('describes every reason code', () => {
    for (const code of REASON_CODES) expect(REASON_DESCRIPTIONS[code]).toMatch(/\w/);
  });

  it('gives every error code a status and a title', () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_HTTP_STATUS[code]).toBeGreaterThanOrEqual(400);
      expect(ERROR_TITLES[code]).toMatch(/\w/);
    }
  });

  it('uses the blueprint statuses for the key conflicts', () => {
    expect(ERROR_HTTP_STATUS.APPROVAL_REQUIRED).toBe(409);
    expect(ERROR_HTTP_STATUS.QUOTE_EXPIRED).toBe(410);
    expect(ERROR_HTTP_STATUS.VALIDATION_FAILED).toBe(422);
  });
});

describe('problem+json builder', () => {
  it('builds an RFC 9457 body with a stable type URI', () => {
    expect(problemSlug('APPROVAL_REQUIRED')).toBe('approval-required');
    expect(problem('APPROVAL_REQUIRED')).toEqual({
      type: 'https://c32.example/problems/approval-required',
      title: 'Service Manager approval required',
      status: 409,
      code: 'APPROVAL_REQUIRED',
    });
  });

  it('includes optional fields only when given', () => {
    const p = problem('VALIDATION_FAILED', {
      detail: 'bad',
      instance: '/v1/quotes',
      requestId: 'r1',
      errors: [{ path: 'rooms', code: 'OUT_OF_RANGE', message: 'Too small' }],
    });
    expect(p).toMatchObject({
      status: 422,
      detail: 'bad',
      instance: '/v1/quotes',
      request_id: 'r1',
    });
    expect(p.errors).toHaveLength(1);
  });
});
