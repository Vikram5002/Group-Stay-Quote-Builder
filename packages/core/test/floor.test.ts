import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, floorFor, floorPasses, type FloorPolicy } from '../src/index.js';

const absolute: FloorPolicy = DEFAULT_POLICY;
const perRoomNight: FloorPolicy = { ...DEFAULT_POLICY, floor_mode: 'per_room_night' };

describe('floorFor (decision G1)', () => {
  it('absolute mode returns the package floor whatever the volume', () => {
    expect(floorFor(absolute, 20)).toBe(20000);
    expect(floorFor(absolute, 14)).toBe(20000);
    expect(floorFor(absolute, 0)).toBe(20000);
  });

  it('per-room-night mode scales with volume (1000 per room-night)', () => {
    expect(floorFor(perRoomNight, 20)).toBe(20000); // fixture: 10 rooms x 2 nights
    expect(floorFor(perRoomNight, 14)).toBe(14000); // 7 rooms x 2 nights (blueprint 5.8)
    expect(floorFor(perRoomNight, 0)).toBe(0);
  });

  it('rejects a missing per-room-night floor and a bad volume', () => {
    expect(() => floorFor({ ...perRoomNight, floor_per_room_night_inr: null }, 20)).toThrow(
      /required in per_room_night mode/,
    );
    expect(() => floorFor(absolute, -1)).toThrow(RangeError);
    expect(() => floorFor(absolute, 2.5)).toThrow(RangeError);
  });
});

describe('floorPasses (BR-06)', () => {
  it('passes at exactly the floor and fails one rupee below', () => {
    expect(floorPasses(20000, 20000)).toBe(true);
    expect(floorPasses(19999, 20000)).toBe(false);
    expect(floorPasses(24000, 20000)).toBe(true);
  });
});
