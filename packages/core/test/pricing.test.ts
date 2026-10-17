import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POLICY,
  flatNights,
  price,
  type FloorPolicy,
  type PricingInput,
} from '../src/index.js';

const perRoomNight: FloorPolicy = { ...DEFAULT_POLICY, floor_mode: 'per_room_night' };

const pkg = (rooms: number, rate = 2000, floor: FloorPolicy = DEFAULT_POLICY): PricingInput => ({
  rooms,
  nights: flatNights('2026-11-01', 2, rate, 800),
  floor,
});

describe('floor modes (decision G1, blueprint 5.8)', () => {
  it('absolute: 7 rooms after a partial cancellation earn 16800 and breach 20000', () => {
    const r = price(pkg(7));
    expect(r.totals).toMatchObject({
      room_nights: 14,
      room_revenue_inr: 28000,
      variable_cost_inr: 11200,
      contribution_inr: 16800,
      contribution_floor_inr: 20000,
      shortfall_inr: 3200,
    });
    expect(r.floor_ok).toBe(false);
  });

  it('per room-night: the same 7 rooms pass against a 14000 floor', () => {
    const r = price(pkg(7, 2000, perRoomNight));
    expect(r.totals).toMatchObject({
      contribution_inr: 16800,
      contribution_floor_inr: 14000,
      floor_headroom_inr: 2800,
    });
    expect(r.floor_ok).toBe(true);
  });

  it('per room-night: the minimum safe rate is volume independent', () => {
    for (const rooms of [1, 7, 10, 50]) {
      expect(price(pkg(rooms, 2000, perRoomNight)).totals.min_rate_per_room_night_inr).toBe(1800);
    }
  });

  it('absolute: the minimum safe rate falls as volume grows', () => {
    expect(price(pkg(5)).totals.min_rate_per_room_night_inr).toBe(2800); // (20000 + 8000) / 10
    expect(price(pkg(10)).totals.min_rate_per_room_night_inr).toBe(1800);
    expect(price(pkg(20)).totals.min_rate_per_room_night_inr).toBe(1300); // (20000 + 32000) / 40
  });
});
