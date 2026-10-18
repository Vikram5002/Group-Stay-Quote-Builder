import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POLICY,
  amountOffRate,
  discountedRate,
  floorFor,
  floorPasses,
  floorRate,
  minimumRate,
} from '../src/index.js';

describe('floorRate (D-056: package floor / total rooms, cost included)', () => {
  it('fixture: 20000 / 10 rooms = 2000 per room-night', () => {
    expect(floorRate(DEFAULT_POLICY)).toBe(2000);
  });

  it('follows the owner-set number of rooms', () => {
    expect(floorRate({ ...DEFAULT_POLICY, total_rooms_units: 20 })).toBe(1000);
    expect(floorRate({ ...DEFAULT_POLICY, total_rooms_units: 1 })).toBe(20000);
  });

  it('rounds up, so it never lands under the floor', () => {
    expect(floorRate({ ...DEFAULT_POLICY, total_rooms_units: 3 })).toBe(6667);
  });

  it('rejects zero rooms', () => {
    expect(() => floorRate({ ...DEFAULT_POLICY, total_rooms_units: 0 })).toThrow(RangeError);
  });
});

describe('Reception discount (D-057)', () => {
  it('discountedRate: whole-percent off the floor rate, rounded up', () => {
    expect(discountedRate(DEFAULT_POLICY, 0)).toBe(2000);
    expect(discountedRate(DEFAULT_POLICY, 5)).toBe(1900);
    expect(discountedRate({ ...DEFAULT_POLICY, total_rooms_units: 3 }, 10)).toBe(6001);
    expect(() => discountedRate(DEFAULT_POLICY, 101)).toThrow(RangeError);
  });

  it('minimumRate: the floor rate less the owner limit (10% by default)', () => {
    expect(minimumRate(DEFAULT_POLICY)).toBe(1800);
    expect(minimumRate({ ...DEFAULT_POLICY, max_sales_discount_pct: 0 })).toBe(2000);
    expect(minimumRate({ ...DEFAULT_POLICY, max_sales_discount_pct: 25 })).toBe(1500);
  });
});

describe('floorFor (the floor as contribution for a package)', () => {
  it('lowest Reception rate x room-nights - variable cost', () => {
    expect(floorFor(DEFAULT_POLICY, 20, 16000)).toBe(20000); // fixture: 20 x 1800 - 16000
    expect(floorFor(DEFAULT_POLICY, 2, 1600)).toBe(2000); // 1 room x 2 nights
    expect(floorFor(DEFAULT_POLICY, 0, 0)).toBe(0);
  });

  it('is unknown when the variable cost is unknown (never treated as 0)', () => {
    expect(floorFor(DEFAULT_POLICY, 20, null)).toBeNull();
  });

  it('rejects a bad volume', () => {
    expect(() => floorFor(DEFAULT_POLICY, -1, 0)).toThrow(RangeError);
    expect(() => floorFor(DEFAULT_POLICY, 2.5, 0)).toThrow(RangeError);
  });
});

describe('floorPasses (BR-06)', () => {
  it('passes at exactly the floor and fails one rupee below', () => {
    expect(floorPasses(24000, 24000)).toBe(true);
    expect(floorPasses(23999, 24000)).toBe(false);
  });
});

describe('Reception discount in rupees off the full price', () => {
  it('amountOffRate: rupees off the floor rate, never below 0', () => {
    expect(amountOffRate(DEFAULT_POLICY, 0)).toBe(2000);
    expect(amountOffRate(DEFAULT_POLICY, 200)).toBe(1800);
    expect(amountOffRate(DEFAULT_POLICY, 2500)).toBe(0);
    expect(() => amountOffRate(DEFAULT_POLICY, -1)).toThrow(RangeError);
  });
});
