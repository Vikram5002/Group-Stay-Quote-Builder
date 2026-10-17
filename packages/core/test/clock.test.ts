import { describe, expect, it } from 'vitest';
import { ManualClock, fixedClock, systemClock } from '../src/index.js';

const ISSUED = '2026-10-17T10:00:00+05:30';
const ISSUED_MS = Date.parse('2026-10-17T04:30:00Z');

describe('clock', () => {
  it('systemClock follows real time', () => {
    const before = Date.now();
    const now = systemClock.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  it('fixedClock never moves and accepts an ISO instant or epoch ms', () => {
    expect(fixedClock(ISSUED).now()).toBe(ISSUED_MS);
    expect(fixedClock(ISSUED_MS).now()).toBe(ISSUED_MS);
  });

  it('ManualClock advances and jumps', () => {
    const clock = new ManualClock(ISSUED);
    clock.advance({ hours: 72 });
    expect(new Date(clock.now()).toISOString()).toBe('2026-10-20T04:30:00.000Z');
    clock.advance({ minutes: 1, seconds: 2, ms: 3 });
    expect(clock.now()).toBe(ISSUED_MS + 72 * 3_600_000 + 62_003);
    clock.set('2026-11-01T00:00:00Z');
    expect(new Date(clock.now()).toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('rejects invalid instants and backward moves', () => {
    expect(() => fixedClock('not a date')).toThrow(RangeError);
    expect(() => new ManualClock(Number.NaN)).toThrow(RangeError);
    expect(() => new ManualClock(ISSUED).advance({ hours: -1 })).toThrow(RangeError);
  });
});
