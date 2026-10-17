import { flatNights, price } from '@c32/core';

/**
 * The case fixture (data/fixtures/fixture.json): 10 standard rooms, variable cost 800 a room-night
 * and a contribution floor of 20000 for the package. All landing-page figures come from the
 * product's own pricing function, never from typed-in numbers.
 */
export const SAMPLE_COST = 800;
export const SAMPLE_FLOOR = 20000;
export const SAMPLE_ROOMS = 10;
export const SAMPLE_CHECK_IN = '2026-11-01';

export function priceSample(rooms: number, nights: number, rate: number) {
  return price({
    rooms,
    nights: flatNights(SAMPLE_CHECK_IN, nights, rate, SAMPLE_COST),
    floor: {
      floor_mode: 'absolute',
      contribution_floor_inr: SAMPLE_FLOOR,
      floor_per_room_night_inr: null,
    },
  });
}

export const SAMPLE = priceSample(10, 2, 2000);

/** Contribution of the sample booking at a given rate per room-night. */
export function contributionAt(rate: number): number | null {
  return priceSample(10, 2, rate).totals.contribution_inr;
}

export const rupees = (n: number | null): string =>
  n === null ? 'Unknown' : `₹${n.toLocaleString('en-IN')}`;
