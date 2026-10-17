import { describe, expect, it } from 'vitest';
import {
  formatInZone,
  localDate,
  startOfDayUtc,
  toUtcIso,
  zoneOffsetMinutes,
} from '../src/index.js';

const IST = 'Asia/Kolkata';
const at = (iso: string) => Date.parse(iso);

describe('time zone helpers', () => {
  it('IST is a fixed +05:30', () => {
    expect(zoneOffsetMinutes(at('2026-01-15T00:00:00Z'), IST)).toBe(330);
    expect(zoneOffsetMinutes(at('2026-07-15T00:00:00Z'), IST)).toBe(330);
    expect(zoneOffsetMinutes(at('2026-07-15T00:00:00Z'), 'UTC')).toBe(0);
  });

  it('a check-in day starts at 18:30 UTC the evening before in IST', () => {
    expect(toUtcIso(startOfDayUtc('2026-11-01', IST))).toBe('2026-10-31T18:30:00.000Z');
    expect(toUtcIso(startOfDayUtc('2026-11-01', 'UTC'))).toBe('2026-11-01T00:00:00.000Z');
  });

  it('handles a DST zone on its change days', () => {
    // London: clocks go forward 2026-03-29 01:00 UTC, back 2026-10-25 01:00 UTC.
    expect(zoneOffsetMinutes(at('2026-03-28T12:00:00Z'), 'Europe/London')).toBe(0);
    expect(zoneOffsetMinutes(at('2026-03-29T12:00:00Z'), 'Europe/London')).toBe(60);
    expect(toUtcIso(startOfDayUtc('2026-07-01', 'Europe/London'))).toBe('2026-06-30T23:00:00.000Z');
    expect(toUtcIso(startOfDayUtc('2026-10-26', 'Europe/London'))).toBe('2026-10-26T00:00:00.000Z');
    // New York is behind UTC, so local midnight is a positive UTC hour.
    expect(toUtcIso(startOfDayUtc('2026-11-01', 'America/New_York'))).toBe(
      '2026-11-01T04:00:00.000Z',
    );
  });

  it('formats an instant with the zone offset for display', () => {
    expect(formatInZone(at('2026-10-20T04:30:00Z'), IST)).toBe('2026-10-20T10:00:00+05:30');
    expect(formatInZone(at('2026-11-01T04:00:00Z'), 'America/New_York')).toBe(
      '2026-11-01T00:00:00-04:00',
    );
    expect(formatInZone(at('2026-10-20T04:30:00Z'), 'UTC')).toBe('2026-10-20T04:30:00+00:00');
  });

  it('round-trips: the formatted instant parses back to the same moment', () => {
    const ms = at('2026-10-17T04:30:15Z');
    expect(Date.parse(formatInZone(ms, IST))).toBe(ms);
  });

  it('gives the local calendar date of an instant', () => {
    expect(localDate(at('2026-10-31T18:29:59Z'), IST)).toBe('2026-10-31');
    expect(localDate(at('2026-10-31T18:30:00Z'), IST)).toBe('2026-11-01');
  });

  it('rejects an unknown time zone', () => {
    expect(() => startOfDayUtc('2026-11-01', 'Mars/Olympus')).toThrow(RangeError);
  });
});
