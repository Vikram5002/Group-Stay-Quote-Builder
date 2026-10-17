import { describe, expect, it } from 'vitest';
import { inclusionExtras, type InclusionInput } from '../src/index.js';

const breakfast = (over: Partial<InclusionInput> = {}): InclusionInput => ({
  name: 'Breakfast',
  basis: 'per_guest_night',
  unit_cost_inr: 150,
  included_in_rate: true,
  ...over,
});

describe('inclusions model (blueprint 5.6)', () => {
  it('bundled breakfast: 10 rooms x 2 guests x 2 nights = 40 guest-nights x 150 = 6000 cost', () => {
    const x = inclusionExtras([breakfast()], 10, 2, 2);
    expect(x).toMatchObject({ cost_inr: 6000, revenue_inr: 0 });
    expect(x.lines[0]).toEqual({
      name: 'Breakfast',
      units: 40,
      cost_inr: 6000,
      revenue_inr: 0,
      explain:
        'Breakfast: 10 rooms x 2 guests x 2 nights = 40 guest-nights x 150 = 6000 cost, included in the rate',
    });
  });

  it('charged separately at 200: revenue 8000 on top of the 6000 cost', () => {
    const x = inclusionExtras([breakfast({ included_in_rate: false, price_inr: 200 })], 10, 2, 2);
    expect(x).toMatchObject({ cost_inr: 6000, revenue_inr: 8000 });
    expect(x.lines[0]!.explain).toBe(
      'Breakfast: 10 rooms x 2 guests x 2 nights = 40 guest-nights x 150 = 6000 cost, charged separately 40 x 200 = 8000 revenue',
    );
  });

  it('per room-night inclusions ignore guest count', () => {
    const parking: InclusionInput = {
      name: 'Parking',
      basis: 'per_room_night',
      unit_cost_inr: 50,
      included_in_rate: true,
    };
    const x = inclusionExtras([parking], 10, 2, null);
    expect(x).toMatchObject({ cost_inr: 1000, revenue_inr: 0 });
    expect(x.lines[0]!.units).toBe(20);
  });

  it('sums several inclusions', () => {
    const x = inclusionExtras(
      [
        breakfast(),
        {
          name: 'Welcome drink',
          basis: 'per_guest_night',
          unit_cost_inr: 50,
          included_in_rate: false,
          price_inr: 80,
        },
      ],
      10,
      2,
      2,
    );
    expect(x).toMatchObject({ cost_inr: 8000, revenue_inr: 3200 });
  });

  it('not bundled but with no price: a cost the hotel absorbs, no revenue', () => {
    const x = inclusionExtras([breakfast({ included_in_rate: false })], 10, 2, 2);
    expect(x).toMatchObject({ cost_inr: 6000, revenue_inr: 0 });
    // The explanation says what was entered, never "included in the rate".
    expect(x.lines[0]!.explain).toBe(
      'Breakfast: 10 rooms x 2 guests x 2 nights = 40 guest-nights x 150 = 6000 cost, not included in the rate and no extra price given, so no revenue',
    );
  });

  it('charged separately at an explicit 0: the text says so', () => {
    const x = inclusionExtras([breakfast({ included_in_rate: false, price_inr: 0 })], 1, 1, 1);
    expect(x.lines[0]!.explain).toBe(
      'Breakfast: 1 room x 1 guest x 1 night = 1 guest-night x 150 = 150 cost, charged separately 1 x 0 = 0 revenue',
    );
  });

  it('no inclusions: zero extras', () => {
    expect(inclusionExtras([], 10, 2, 2)).toEqual({ lines: [], cost_inr: 0, revenue_inr: 0 });
  });
});

describe('unknowns never become 0 or one guest', () => {
  it('unknown guests per room makes a per-guest inclusion cost unknown', () => {
    const x = inclusionExtras([breakfast()], 10, 2, null);
    expect(x).toMatchObject({ cost_inr: null, revenue_inr: null });
    expect(x.lines[0]!.explain).toBe('Breakfast: guests per room unknown, cost unknown');
  });

  it('a null unit cost makes the cost unknown', () => {
    const x = inclusionExtras([breakfast({ unit_cost_inr: null })], 10, 2, 2);
    expect(x).toMatchObject({ cost_inr: null, revenue_inr: null });
    expect(x.lines[0]!.explain).toBe(
      'Breakfast: 10 rooms x 2 guests x 2 nights = 40 guest-nights, unit cost unknown',
    );
  });

  it('one unknown inclusion makes the package extras unknown', () => {
    const x = inclusionExtras(
      [breakfast(), breakfast({ name: 'Dinner', unit_cost_inr: null })],
      10,
      2,
      2,
    );
    expect(x.cost_inr).toBeNull();
    expect(x.lines[0]!.cost_inr).toBe(6000);
  });
});

describe('guards', () => {
  it.each([
    ['fractional rooms', 2.5, 2, 2],
    ['negative nights', 10, -1, 2],
    ['zero guests', 10, 2, 0],
  ])('rejects %s', (_label, rooms, nights, guests) => {
    expect(() => inclusionExtras([breakfast()], rooms, nights, guests)).toThrow(RangeError);
  });
});
