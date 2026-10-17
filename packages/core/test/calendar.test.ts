import { describe, expect, it } from 'vitest';
import {
  addDays,
  checkOutDate,
  daysBetween,
  fromEpochDay,
  stayNights,
  toEpochDay,
} from '../src/index.js';

describe('calendar (blueprint 5.2)', () => {
  it('identifies a night by its start date: fixture stay occupies 11-01 and 11-02', () => {
    expect(stayNights('2026-11-01', 2)).toEqual(['2026-11-01', '2026-11-02']);
    expect(checkOutDate('2026-11-01', 2)).toBe('2026-11-03');
  });

  it('crosses month, year and leap-day boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
  });

  it('counts days between dates, including negative spans', () => {
    expect(daysBetween('2026-11-01', '2026-11-03')).toBe(2);
    expect(daysBetween('2026-11-03', '2026-11-01')).toBe(-2);
  });

  it('round-trips epoch days', () => {
    expect(toEpochDay('1970-01-01')).toBe(0);
    expect(fromEpochDay(toEpochDay('2026-11-01'))).toBe('2026-11-01');
  });

  it('rejects malformed and impossible dates', () => {
    expect(() => toEpochDay('2026-11-1')).toThrow(RangeError);
    expect(() => toEpochDay('2026-02-30')).toThrow(RangeError);
    expect(() => toEpochDay('2026-13-01')).toThrow(RangeError);
    expect(() => fromEpochDay(1.5)).toThrow(RangeError);
    expect(() => stayNights('2026-11-01', -1)).toThrow(RangeError);
    expect(() => stayNights('2026-11-01', 1.5)).toThrow(RangeError);
  });

  it('returns no nights for a zero-night span', () => {
    expect(stayNights('2026-11-01', 0)).toEqual([]);
  });
});
