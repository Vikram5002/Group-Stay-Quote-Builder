import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, amendTotals, flatNights, price } from '../src/index.js';

const fixtureTotals = price({
  rooms: 10,
  nights: flatNights('2026-11-01', 2, 2000, 800),
  floor: DEFAULT_POLICY,
}).totals;
const perRoomNight = { ...DEFAULT_POLICY, floor_mode: 'per_room_night' as const };

describe('T20 partial cancellation 10 to 7 rooms (blueprint 5.8)', () => {
  it('releases 6 room-nights; contribution 28000 - 11200 = 16800', () => {
    const r = amendTotals(fixtureTotals, 10, 7, DEFAULT_POLICY);
    expect(r.totals).toMatchObject({
      room_nights: 14,
      room_revenue_inr: 28000,
      variable_cost_inr: 11200,
      contribution_inr: 16800,
    });
    expect(r.trail[0]).toBe('amended 10 to 7 rooms: 6 room-nights released');
  });

  it('absolute floor 20000: fails, owner review', () => {
    const r = amendTotals(fixtureTotals, 10, 7, DEFAULT_POLICY);
    expect(r.floor_ok).toBe(false);
    expect(r.totals.shortfall_inr).toBe(3200);
    expect(r.trail[1]).toBe(
      'remaining contribution 16800 < 20000 floor, shortfall 3200: owner review',
    );
  });

  it('per-room-night floor (14 x 1000 = 14000): passes', () => {
    const r = amendTotals(fixtureTotals, 10, 7, perRoomNight);
    expect(r.floor_ok).toBe(true);
    expect(r.totals.contribution_floor_inr).toBe(14000);
    expect(r.totals.floor_headroom_inr).toBe(2800);
  });
});

describe('amendTotals', () => {
  it('matches pricing the smaller package from scratch', () => {
    const direct = price({
      rooms: 7,
      nights: flatNights('2026-11-01', 2, 2000, 800),
      floor: DEFAULT_POLICY,
    }).totals;
    expect(amendTotals(fixtureTotals, 10, 7, DEFAULT_POLICY).totals).toEqual(direct);
  });

  it('scales inclusions too', () => {
    const withBreakfast = price({
      rooms: 10,
      nights: flatNights('2026-11-01', 2, 2000, 800),
      floor: DEFAULT_POLICY,
      extras: { revenue_inr: 8000, cost_inr: 6000 },
    }).totals;
    expect(amendTotals(withBreakfast, 10, 5, DEFAULT_POLICY).totals).toMatchObject({
      inclusions_revenue_inr: 4000,
      inclusions_cost_inr: 3000,
      contribution_inr: 13000,
    });
  });

  it('keeps unknown values unknown', () => {
    const unknownCost = price({
      rooms: 10,
      nights: flatNights('2026-11-01', 2, 2000, null),
      floor: DEFAULT_POLICY,
    }).totals;
    const r = amendTotals(unknownCost, 10, 7, DEFAULT_POLICY);
    expect(r.totals.contribution_inr).toBeNull();
    expect(r.floor_ok).toBeNull();
    expect(r.trail[1]).toBe('contribution unknown, so the floor cannot be checked');
  });

  it.each([
    ['no reduction', 10, 10],
    ['an increase', 10, 11],
    ['zero rooms', 10, 0],
    ['fractional rooms', 10, 6.5],
  ])('rejects %s', (_label, from, to) => {
    expect(() => amendTotals(fixtureTotals, from, to, DEFAULT_POLICY)).toThrow(RangeError);
  });

  it('rejects totals that are not a whole multiple of the rooms', () => {
    expect(() =>
      amendTotals({ ...fixtureTotals, room_revenue_inr: 40001 }, 10, 7, DEFAULT_POLICY),
    ).toThrow(/not a multiple/);
    expect(() => amendTotals(fixtureTotals, 3, 2, DEFAULT_POLICY)).toThrow(/room_nights/);
  });
});
