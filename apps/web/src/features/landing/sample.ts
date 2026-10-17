import { flatNights, price } from '@c32/core';

/**
 * The case fixture (data/fixtures/fixture.json): 10 standard rooms, variable cost 800 a room-night
 * and a package floor of 20000, which makes the floor rate 20000 / 10 rooms = 2000 a room-night
 * (D-056). The sample is offered at 2500, so there is real room to negotiate. All landing-page
 * figures come from the product's own pricing function, never from typed-in numbers.
 */
export const SAMPLE_COST = 800;
export const SAMPLE_FLOOR = 20000;
export const SAMPLE_ROOMS = 10;
export const SAMPLE_RATE = 2500;
export const SAMPLE_CHECK_IN = '2026-11-01';

export function priceSample(rooms: number, nights: number, rate: number) {
  return price({
    rooms,
    nights: flatNights(SAMPLE_CHECK_IN, nights, rate, SAMPLE_COST),
    floor: { contribution_floor_inr: SAMPLE_FLOOR, total_rooms_units: SAMPLE_ROOMS },
  });
}

export const SAMPLE = priceSample(SAMPLE_ROOMS, 2, SAMPLE_RATE);

/** The contribution the sample booking (10 rooms, 2 nights) must reach: floor rate x room-nights - cost. */
export const SAMPLE_MIN_CONTRIBUTION = SAMPLE.totals.contribution_floor_inr ?? 0;

/** Contribution of the sample booking at a given rate per room-night. */
export function contributionAt(rate: number): number | null {
  return priceSample(10, 2, rate).totals.contribution_inr;
}

export const rupees = (n: number | null): string =>
  n === null ? 'Unknown' : `₹${n.toLocaleString('en-IN')}`;
