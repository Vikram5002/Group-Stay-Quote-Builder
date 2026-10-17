import { describe, expect, it } from 'vitest';
import { sellableRooms, type InventoryNight } from '../src/index.js';

const night = (date: string, available: number | null, roomType = 'standard'): InventoryNight =>
  available === null
    ? {
        date,
        room_type: roomType,
        total_units: null,
        available_units: null,
        held_units: 0,
        confirmed_units: 0,
      }
    : {
        date,
        room_type: roomType,
        total_units: available,
        available_units: available,
        held_units: 0,
        confirmed_units: 0,
      };

const STAY = ['2026-11-01', '2026-11-02'];

describe('sellable rooms (BR-04)', () => {
  it('is the minimum over the nights of the stay', () => {
    expect(
      sellableRooms([night('2026-11-01', 10), night('2026-11-02', 8)], 'standard', STAY),
    ).toEqual({
      kind: 'known',
      sellable: 8,
      nights: [
        { date: '2026-11-01', available_units: 10 },
        { date: '2026-11-02', available_units: 8 },
      ],
    });
  });

  it('counts held and confirmed rooms as not available', () => {
    const busy: InventoryNight = {
      date: '2026-11-01',
      room_type: 'standard',
      total_units: 10,
      available_units: 3,
      held_units: 5,
      confirmed_units: 2,
    };
    const r = sellableRooms([busy], 'standard', ['2026-11-01']);
    expect(r.kind === 'known' && r.sellable).toBe(3);
  });

  it('zero on any night means nothing is sellable', () => {
    const r = sellableRooms([night('2026-11-01', 10), night('2026-11-02', 0)], 'standard', STAY);
    expect(r.kind === 'known' && r.sellable).toBe(0);
  });

  it('only looks at the requested room type and the stay nights', () => {
    const inv = [
      night('2026-10-31', 0),
      night('2026-11-01', 10),
      night('2026-11-01', 0, 'deluxe'),
      night('2026-11-02', 10),
      night('2026-11-03', 0),
    ];
    const r = sellableRooms(inv, 'standard', STAY);
    expect(r.kind === 'known' && r.sellable).toBe(10);
  });

  it('a night with no row is missing (not on sale), never treated as available', () => {
    expect(sellableRooms([night('2026-11-01', 10)], 'standard', STAY)).toEqual({
      kind: 'missing',
      missing_dates: ['2026-11-02'],
    });
    expect(sellableRooms([night('2026-11-01', 10, 'deluxe')], 'standard', ['2026-11-01'])).toEqual({
      kind: 'missing',
      missing_dates: ['2026-11-01'],
    });
  });

  it('a null night is unknown, never 0 or unlimited', () => {
    expect(
      sellableRooms([night('2026-11-01', 10), night('2026-11-02', null)], 'standard', STAY),
    ).toEqual({
      kind: 'unknown',
      unknown_dates: ['2026-11-02'],
    });
  });

  it('missing outranks unknown', () => {
    const r = sellableRooms([night('2026-11-01', null)], 'standard', STAY);
    expect(r).toEqual({ kind: 'missing', missing_dates: ['2026-11-02'] });
  });

  it('rejects duplicate rows and an empty stay', () => {
    expect(() =>
      sellableRooms([night('2026-11-01', 10), night('2026-11-01', 5)], 'standard', STAY),
    ).toThrow(RangeError);
    expect(() => sellableRooms([], 'standard', [])).toThrow(RangeError);
  });
});
