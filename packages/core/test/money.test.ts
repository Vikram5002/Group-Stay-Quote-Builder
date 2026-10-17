import { describe, expect, it } from 'vitest';
import { assertInt, ceilDiv, percentOneDecimal, sumKnown } from '../src/index.js';

describe('ceilDiv', () => {
  it('rounds up, never down (BR-20)', () => {
    expect(ceilDiv(36800, 21)).toBe(1753); // T18: 1752.38 -> 1753
    expect(ceilDiv(36000, 20)).toBe(1800); // exact division stays exact
    expect(ceilDiv(1, 3)).toBe(1);
    expect(ceilDiv(0, 7)).toBe(0);
  });

  it('handles negative dividends', () => {
    expect(ceilDiv(-7, 2)).toBe(-3);
    expect(ceilDiv(-6, 2)).toBe(-3);
  });

  it('is exact for large values near the safe-integer range', () => {
    const b = 9_999_991;
    const q = 900_000_007;
    expect(ceilDiv(q * b, b)).toBe(q);
    expect(ceilDiv(q * b + 1, b)).toBe(q + 1);
  });

  it('rejects a non-positive divisor and fractional inputs', () => {
    expect(() => ceilDiv(10, 0)).toThrow(RangeError);
    expect(() => ceilDiv(10, -2)).toThrow(RangeError);
    expect(() => ceilDiv(1.5, 2)).toThrow(RangeError);
  });
});

describe('percentOneDecimal', () => {
  it('matches the blueprint rate sweep margins', () => {
    expect(percentOneDecimal(24000, 40000)).toBe(60);
    expect(percentOneDecimal(20000, 36000)).toBe(55.6);
    expect(percentOneDecimal(19980, 35980)).toBe(55.5);
    expect(percentOneDecimal(14000, 30000)).toBe(46.7);
  });

  it('rounds half away from zero', () => {
    expect(percentOneDecimal(1, 2000)).toBe(0.1); // 0.05 -> 0.1
    expect(percentOneDecimal(-1, 2000)).toBe(-0.1);
    expect(percentOneDecimal(-1, 3)).toBe(-33.3);
  });

  it('is null when the whole is not positive', () => {
    expect(percentOneDecimal(0, 0)).toBeNull();
    expect(percentOneDecimal(5, -10)).toBeNull();
  });
});

describe('sumKnown', () => {
  it('adds known values and propagates unknown', () => {
    expect(sumKnown([1, 2, 3])).toBe(6);
    expect(sumKnown([])).toBe(0);
    expect(sumKnown([1, null, 3])).toBeNull();
  });
});

describe('assertInt', () => {
  it('accepts in-range integers and rejects everything else', () => {
    expect(() => assertInt('x', 5, 0, 10)).not.toThrow();
    expect(() => assertInt('x', 11, 0, 10)).toThrow(/x must be an integer/);
    expect(() => assertInt('x', -1)).toThrow(RangeError);
    expect(() => assertInt('x', Number.NaN)).toThrow(RangeError);
  });
});
