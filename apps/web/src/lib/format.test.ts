import { formatCount, formatCountdown, formatInr, formatIst, UNKNOWN_LABEL } from './format';

describe('formatters', () => {
  it('formats rupees with Indian grouping', () => {
    expect(formatInr(40000)).toMatch(/40,000/);
    expect(formatInr(1234567)).toMatch(/12,34,567/);
  });

  it('never renders null or undefined as zero', () => {
    expect(formatInr(null)).toBe(UNKNOWN_LABEL);
    expect(formatInr(undefined)).toBe(UNKNOWN_LABEL);
    expect(formatCount(null)).toBe(UNKNOWN_LABEL);
    expect(formatIst(null)).toBe(UNKNOWN_LABEL);
    expect(formatIst('not a date')).toBe(UNKNOWN_LABEL);
  });

  it('keeps a real zero as zero', () => {
    expect(formatInr(0)).toMatch(/0/);
    expect(formatInr(0)).not.toBe(UNKNOWN_LABEL);
    expect(formatCount(0)).toBe('0');
  });

  it('shows UTC instants in IST', () => {
    expect(formatIst('2026-11-01T09:00:00Z')).toContain('14:30');
    expect(formatIst('2026-11-01T09:00:00Z')).toMatch(/IST$/);
  });

  it('counts down from an injected clock', () => {
    const now = new Date('2026-11-01T00:00:00Z');
    expect(formatCountdown('2026-11-01T02:05:00Z', now)).toBe('2h 05m left');
    expect(formatCountdown('2026-11-03T05:00:00Z', now)).toBe('2d 5h left');
    expect(formatCountdown('2026-10-31T23:59:00Z', now)).toBe('Expired');
  });
});
