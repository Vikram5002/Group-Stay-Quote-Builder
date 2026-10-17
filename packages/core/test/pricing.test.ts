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

describe('unknown values propagate (BR-07, null means unknown, never zero)', () => {
  const withNight2 = (rate: number | null, cost: number | null): PricingInput => ({
    rooms: 10,
    nights: [
      { date: '2026-11-01', rate_inr: 2000, variable_cost_inr: 800 },
      { date: '2026-11-02', rate_inr: rate, variable_cost_inr: cost },
    ],
    floor: DEFAULT_POLICY,
  });

  it('T06 unknown cost on one night: contribution, margin and floor are unknown, not 0', () => {
    const r = price(withNight2(2000, null));
    expect(r.totals).toMatchObject({
      room_revenue_inr: 40000,
      variable_cost_inr: null,
      contribution_inr: null,
      contribution_margin_pct: null,
      floor_headroom_inr: null,
      shortfall_inr: null,
      min_rate_per_room_night_inr: null,
    });
    expect(r.floor_ok).toBeNull();
  });

  it('unknown rate: revenue and contribution are unknown, but the minimum safe rate is still known', () => {
    const r = price(withNight2(null, 800));
    expect(r.totals).toMatchObject({
      room_revenue_inr: null,
      variable_cost_inr: 16000,
      contribution_inr: null,
      min_rate_per_room_night_inr: 1800,
    });
    expect(r.floor_ok).toBeNull();
  });

  it('unknown inclusion cost makes contribution unknown', () => {
    const r = price({ ...withNight2(2000, 800), extras: { revenue_inr: 0, cost_inr: null } });
    expect(r.totals.inclusions_cost_inr).toBeNull();
    expect(r.totals.contribution_inr).toBeNull();
    expect(r.totals.min_rate_per_room_night_inr).toBeNull();
  });

  it('unknown inclusion revenue makes contribution and minimum rate unknown', () => {
    const r = price({ ...withNight2(2000, 800), extras: { revenue_inr: null, cost_inr: 0 } });
    expect(r.totals.contribution_inr).toBeNull();
    expect(r.totals.min_rate_per_room_night_inr).toBeNull();
  });
});
