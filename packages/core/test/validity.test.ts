import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POLICY,
  ManualClock,
  computeValidity,
  formatInZone,
  isExpired,
  pastCheckInIssue,
  secondsRemaining,
} from '../src/index.js';

const IST = 'Asia/Kolkata';
const ist = (local: string) => Date.parse(`${local}+05:30`);
const H = 3_600_000;

describe('T25 quote validity (BR-09)', () => {
  it('issued 2026-10-17 10:00 IST with 72h validity: valid until 2026-10-20 10:00 IST', () => {
    const v = computeValidity(ist('2026-10-17T10:00:00'), '2026-11-01', DEFAULT_POLICY);
    expect(formatInZone(v.valid_until_ms, IST)).toBe('2026-10-20T10:00:00+05:30');
    expect(v.valid_until).toBe('2026-10-20T04:30:00.000Z'); // stored in UTC
    expect(v.issued_at).toBe('2026-10-17T04:30:00.000Z');
    expect(v.limited_by).toBe('validity_window');
    expect(v.window_ms).toBe(72 * H);
    expect(v.too_late).toBe(false);
  });

  it('issued 2026-10-31 12:00 IST for a 2026-11-01 check-in with 24h cutoff: too late', () => {
    const v = computeValidity(ist('2026-10-31T12:00:00'), '2026-11-01', DEFAULT_POLICY);
    // cutoff = 2026-11-01 00:00 IST - 24h = 2026-10-31 00:00 IST, already 12 hours past
    expect(formatInZone(v.valid_until_ms, IST)).toBe('2026-10-31T00:00:00+05:30');
    expect(v.limited_by).toBe('stay_cutoff');
    expect(v.window_ms).toBe(-12 * H);
    expect(v.too_late).toBe(true);
  });
});

describe('validity bounds', () => {
  it('the stay cutoff shortens the window when check-in is near', () => {
    // check-in 2026-10-20: cutoff 2026-10-19 00:00 IST, 38h after 10:00 on the 17th
    const v = computeValidity(ist('2026-10-17T10:00:00'), '2026-10-20', DEFAULT_POLICY);
    expect(formatInZone(v.valid_until_ms, IST)).toBe('2026-10-19T00:00:00+05:30');
    expect(v.limited_by).toBe('stay_cutoff');
    expect(v.window_ms).toBe(38 * H);
    expect(v.too_late).toBe(false);
  });

  it('a window exactly equal to min_validity_hours is allowed, one ms less is too late', () => {
    // cutoff 2026-10-31 00:00 IST; min validity 2h
    expect(computeValidity(ist('2026-10-30T22:00:00'), '2026-11-01', DEFAULT_POLICY).too_late).toBe(
      false,
    );
    expect(
      computeValidity(ist('2026-10-30T22:00:00') + 1, '2026-11-01', DEFAULT_POLICY).too_late,
    ).toBe(true);
  });

  it('when both bounds are equal, the validity window is reported', () => {
    const policy = { ...DEFAULT_POLICY, validity_hours: 24, stay_cutoff_hours: 0 };
    const v = computeValidity(ist('2026-10-31T00:00:00'), '2026-11-01', policy);
    expect(v.limited_by).toBe('validity_window');
    expect(v.window_ms).toBe(24 * H);
  });

  it('uses the property time zone for the check-in day', () => {
    const utcPolicy = { ...DEFAULT_POLICY, timezone: 'UTC' };
    const v = computeValidity(Date.parse('2026-10-31T12:00:00Z'), '2026-11-01', utcPolicy);
    expect(v.valid_until).toBe('2026-10-31T00:00:00.000Z');
  });

  it('rejects a non-finite issue instant', () => {
    expect(() => computeValidity(Number.NaN, '2026-11-01', DEFAULT_POLICY)).toThrow(RangeError);
  });
});

describe('expiry with an injected clock', () => {
  const v = computeValidity(ist('2026-10-17T10:00:00'), '2026-11-01', DEFAULT_POLICY);

  it('is live before valid_until and expired from it onward', () => {
    const clock = new ManualClock(ist('2026-10-17T10:00:00'));
    expect(isExpired(v.valid_until, clock.now())).toBe(false);
    expect(secondsRemaining(v.valid_until, clock.now())).toBe(72 * 3600);

    clock.advance({ hours: 71, minutes: 59, seconds: 59 });
    expect(isExpired(v.valid_until, clock.now())).toBe(false);
    expect(secondsRemaining(v.valid_until, clock.now())).toBe(1);

    clock.advance({ seconds: 1 });
    expect(isExpired(v.valid_until, clock.now())).toBe(true);
    expect(secondsRemaining(v.valid_until, clock.now())).toBe(0);

    clock.advance({ hours: 5 });
    expect(secondsRemaining(v.valid_until_ms, clock.now())).toBe(0);
  });

  it('accepts the IST display form as well as the UTC storage form', () => {
    const display = formatInZone(v.valid_until_ms, IST);
    expect(isExpired(display, v.valid_until_ms)).toBe(true);
    expect(isExpired(display, v.valid_until_ms - 1)).toBe(false);
  });

  it('rejects an invalid valid_until', () => {
    expect(() => isExpired('soon', 0)).toThrow(RangeError);
  });
});

describe('a check-in in the past is an input error, not a late enquiry', () => {
  const now = ist('2026-10-18T23:30:00');

  it('today and later are accepted, in the property time zone', () => {
    expect(pastCheckInIssue('2026-10-18', now, IST)).toBeNull();
    expect(pastCheckInIssue('2026-11-01', now, IST)).toBeNull();
  });

  it('yesterday is refused on stay.check_in with the date it must be on or after', () => {
    expect(pastCheckInIssue('2026-10-17', now, IST)).toEqual({
      path: 'stay.check_in',
      code: 'OUT_OF_RANGE',
      message: 'Check-in must be today (2026-10-18) or later',
    });
  });

  it('uses the property day, not the UTC day', () => {
    // 01:00 IST on 19 Oct is still 18 Oct in UTC.
    const early = ist('2026-10-19T01:00:00');
    expect(new Date(early).toISOString().slice(0, 10)).toBe('2026-10-18');
    expect(pastCheckInIssue('2026-10-18', early, IST)).not.toBeNull();
    expect(pastCheckInIssue('2026-10-18', early, 'UTC')).toBeNull();
  });
});
