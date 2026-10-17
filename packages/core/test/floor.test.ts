import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, floorFor, floorPasses, floorRate } from '../src/index.js';

describe('floorRate (D-056: package floor / total rooms, cost included)', () => {
  it('fixture: 20000 / 10 rooms = 2000 per room-night', () => {
    expect(floorRate(DEFAULT_POLICY)).toBe(2000);
  });

  it('follows the owner-set number of rooms', () => {
    expect(floorRate({ contribution_floor_inr: 20000, total_rooms_units: 20 })).toBe(1000);
    expect(floorRate({ contribution_floor_inr: 20000, total_rooms_units: 1 })).toBe(20000);
  });

  it('rounds up, so it never lands under the floor', () => {
    expect(floorRate({ contribution_floor_inr: 20000, total_rooms_units: 3 })).toBe(6667);
  });

  it('rejects zero rooms', () => {
    expect(() => floorRate({ contribution_floor_inr: 20000, total_rooms_units: 0 })).toThrow(
      RangeError,
    );
  });
});

describe('floorFor (the floor as contribution for a package)', () => {
  it('floor rate x room-nights - variable cost', () => {
    expect(floorFor(DEFAULT_POLICY, 20, 16000)).toBe(24000); // fixture: 20 x 2000 - 16000
    expect(floorFor(DEFAULT_POLICY, 2, 1600)).toBe(2400); // 1 room x 2 nights
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
