import { describe, expect, it } from 'vitest';
import {
  Evaluation,
  evaluate,
  mapC32Fixture,
  validateQuoteRequest,
  type CounterOffer,
  type EvaluationContext,
  type InclusionInput,
  type InventoryNight,
} from '../src/index.js';
import { readJson } from './helpers.js';

const fx = mapC32Fixture(readJson('data/fixtures/fixture.json'));
const ISSUED = Date.parse('2026-10-17T10:00:00+05:30');

const withRooms = (n: number): InventoryNight[] =>
  fx.inventory.map((r) => ({ ...r, total_units: n, available_units: n }));

const ctx = (over: Partial<EvaluationContext> = {}): EvaluationContext => ({
  inventory: fx.inventory,
  ratePlan: fx.ratePlan,
  policy: fx.policy,
  nowMs: ISSUED,
  ...over,
});

const breakfast: InclusionInput = {
  name: 'Breakfast',
  basis: 'per_guest_night',
  unit_cost_inr: 150,
  included_in_rate: true,
};

function offersFor(request: object, context: EvaluationContext = ctx()): CounterOffer[] {
  const v = validateQuoteRequest({ ...fx.request, ...request });
  if (!v.ok) throw new Error(JSON.stringify(v.problem.errors));
  const { evaluation } = evaluate(v.value, context);
  expect(Evaluation.safeParse(evaluation).success).toBe(true);
  return evaluation.counter_offers;
}

const types = (offers: CounterOffer[]) => offers.map((o) => o.type);

describe('RAISE_RATE (blueprint 9.3 example)', () => {
  it('rate 1500 breaches the floor: raise to the lowest Reception rate 1800', () => {
    expect(offersFor({ rate_per_room_night_inr: 1500 })).toEqual([
      {
        type: 'RAISE_RATE',
        summary: 'Raise the rate to 1800 per room-night (minimum safe rate)',
        rate_per_room_night_inr: 1800,
        rooms: 10,
        contribution_inr: 20000,
        floor_headroom_inr: 0,
      },
    ]);
  });
});

describe('REPRICE_INCLUSION (blueprint 6.4)', () => {
  const offers = offersFor({ inclusions: [breakfast] });

  it('bundled breakfast: raise to 2100 (lowest rate + breakfast), or charge breakfast separately', () => {
    expect(types(offers)).toEqual(['RAISE_RATE', 'REPRICE_INCLUSION']);
    expect(offers[0]).toMatchObject({ rate_per_room_night_inr: 2100, contribution_inr: 20000 });
  });

  it('charging at unit cost makes breakfast cost-neutral: contribution back to 24000', () => {
    expect(offers[1]).toEqual({
      type: 'REPRICE_INCLUSION',
      summary: 'Charge Breakfast separately at 150 per guest-night',
      inclusions: [{ ...breakfast, included_in_rate: false, price_inr: 150 }],
      rooms: 10,
      contribution_inr: 24000,
      floor_headroom_inr: 4000,
    });
  });

  it('skips inclusions already charged separately or with unknown cost', () => {
    const charged = { ...breakfast, name: 'Dinner', included_in_rate: false, price_inr: 100 };
    const offers2 = offersFor({ rate_per_room_night_inr: 1500, inclusions: [charged] });
    expect(types(offers2)).not.toContain('REPRICE_INCLUSION');
  });
});

describe('PARTIAL_ROOMS', () => {
  it('12 requested, 10 sellable: offer 10 rooms, contribution 24000', () => {
    expect(offersFor({ rooms: 12 })).toEqual([
      {
        type: 'PARTIAL_ROOMS',
        summary: 'Offer 10 rooms instead of 12',
        rooms: 10,
        contribution_inr: 24000,
        floor_headroom_inr: 4000,
      },
    ]);
  });

  it('a partial that also breaches the floor gets fixes priced for the sellable rooms', () => {
    // night 2 has 8 rooms; 1700 is over the 10% Reception limit on all 16 room-nights
    const inventory = [withRooms(10)[0]!, { ...withRooms(8)[1]! }];
    const offers = offersFor({ rooms: 12, rate_per_room_night_inr: 1700 }, ctx({ inventory }));
    expect(types(offers)).toEqual(['RAISE_RATE']);
    expect(offers[0]).toMatchObject({ rooms: 8, rate_per_room_night_inr: 1800 });
  });
});

describe('CHANGE_VOLUME (D-056)', () => {
  it('is never offered: more rooms raise the floor as fast as the contribution', () => {
    const offers = offersFor({ rate_per_room_night_inr: 1500 }, ctx({ inventory: withRooms(30) }));
    expect(types(offers)).not.toContain('CHANGE_VOLUME');
  });
});

describe('no counter-offers', () => {
  it('for a clean OFFER', () => {
    expect(offersFor({})).toEqual([]);
  });

  it('when a value is unknown, because safety cannot be proven', () => {
    const ratePlan = fx.ratePlan.map((r) => ({ ...r, variable_cost_per_room_night_inr: null }));
    expect(offersFor({ rate_per_room_night_inr: 1500 }, ctx({ ratePlan }))).toEqual([]);
  });

  it('for a DECLINE', () => {
    expect(offersFor({}, ctx({ inventory: withRooms(0) }))).toEqual([]);
  });
});

describe('every counter-offer is floor-safe when re-run (FR-12)', () => {
  it.each([
    ['rate 1500', { rate_per_room_night_inr: 1500 }, ctx({ inventory: withRooms(30) })],
    ['bundled breakfast', { inclusions: [breakfast] }, ctx()],
    ['12 rooms', { rooms: 12 }, ctx()],
    [
      'partial over the Reception limit',
      { rooms: 12, rate_per_room_night_inr: 1700 },
      ctx({ inventory: [withRooms(10)[0]!, withRooms(8)[1]!] }),
    ],
  ])('%s', (_label, request, context) => {
    const offers = offersFor(request, context);
    expect(offers.length).toBeGreaterThan(0);
    for (const o of offers) {
      const changed = {
        ...request,
        ...(o.rooms === undefined ? {} : { rooms: o.rooms }),
        ...(o.rate_per_room_night_inr === undefined
          ? {}
          : { rate_per_room_night_inr: o.rate_per_room_night_inr }),
        ...(o.inclusions === undefined ? {} : { inclusions: o.inclusions }),
      };
      const v = validateQuoteRequest({ ...fx.request, ...changed });
      if (!v.ok) throw new Error('counter-offer must be a valid request');
      const { evaluation } = evaluate(v.value, context);
      expect(evaluation).toMatchObject({ decision: 'OFFER', reasons: [] });
      expect(evaluation.totals.contribution_inr).toBe(o.contribution_inr);
      expect(o.floor_headroom_inr).toBeGreaterThanOrEqual(0);
    }
  });
});
