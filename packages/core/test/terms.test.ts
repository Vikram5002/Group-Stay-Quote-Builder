import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  commercialTerms,
  evaluate,
  mapC32Fixture,
  validateQuoteRequest,
} from '../src/index.js';
import { readJson } from './helpers.js';

const fx = mapC32Fixture(readJson('data/fixtures/fixture.json'));
const ctx = {
  inventory: fx.inventory,
  ratePlan: fx.ratePlan,
  policy: fx.policy,
  nowMs: Date.parse('2026-10-17T10:00:00+05:30'),
};

function termsFor(over: object): string {
  const v = validateQuoteRequest({ ...fx.request, ...over });
  if (!v.ok) throw new Error('invalid');
  return commercialTerms(v.value, evaluate(v.value, ctx).evaluation);
}

describe('canonicalJson', () => {
  it('sorts keys at every level and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: null }], c: undefined } })).toBe(
      '{"a":{"d":[2,{"y":null,"z":1}]},"b":1}',
    );
  });

  it('is independent of key insertion order', () => {
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
  });

  it('handles primitives', () => {
    expect([1, 'a', true, null].map(canonicalJson)).toEqual(['1', '"a"', 'true', 'null']);
  });
});

describe('commercialTerms (BR-11)', () => {
  const base = termsFor({});

  it('is stable for the same request, including the organiser name', () => {
    expect(termsFor({})).toBe(base);
    expect(termsFor({ organiser: { name: 'Someone else' } })).toBe(base);
  });

  it.each([
    ['rate', { rate_per_room_night_inr: 1900 }],
    ['rooms', { rooms: 9 }],
    ['dates', { stay: { check_in: '2026-11-01', nights: 1 } }],
    [
      'inclusions',
      {
        inclusions: [
          {
            name: 'Breakfast',
            basis: 'per_room_night',
            unit_cost_inr: 100,
            included_in_rate: true,
          },
        ],
      },
    ],
    ['guests', { guests_per_room_units: 3 }],
  ])('changes when the %s change', (_label, over) => {
    expect(termsFor(over)).not.toBe(base);
  });
});
