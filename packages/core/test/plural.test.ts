import { describe, expect, it } from 'vitest';
import {
  counted,
  evaluate,
  mapC32Fixture,
  plural,
  validateQuoteRequest,
  type EvaluationContext,
} from '../src/index.js';
import { readJson } from './helpers.js';

describe('plural', () => {
  it('uses the singular for exactly one, the plural otherwise', () => {
    expect(counted(1, 'quote')).toBe('1 quote');
    expect(counted(0, 'quote')).toBe('0 quotes');
    expect(counted(2, 'quote')).toBe('2 quotes');
  });

  it('takes an irregular plural, and the bare word for verbs and pronouns', () => {
    expect(counted(3, 'entry', 'entries')).toBe('3 entries');
    expect(plural(1, 'is', 'are')).toBe('is');
    expect(plural(4, 'has', 'have')).toBe('have');
    expect(plural(1, 'it', 'them')).toBe('it');
  });
});

describe("the engine's explanations count in words", () => {
  const fx = mapC32Fixture(readJson('data/fixtures/fixture.json'));
  const ctx = (rooms: number): EvaluationContext => ({
    inventory: fx.inventory.map((n) => ({ ...n, total_units: rooms, available_units: rooms })),
    ratePlan: fx.ratePlan,
    policy: fx.policy,
    nowMs: Date.parse('2026-10-17T10:00:00+05:30'),
  });
  const run = (request: object, rooms: number) => {
    const v = validateQuoteRequest({ ...fx.request, ...request });
    if (!v.ok) throw new Error('invalid request');
    return evaluate(v.value, ctx(rooms)).evaluation;
  };

  it('one room for one night', () => {
    const e = run({ rooms: 1, stay: { check_in: '2026-11-01', nights: 1 } }, 1);
    expect(e.trail).toContain('1 room x 1 night = 1 room-night');
    expect(e.trail.join('\n')).toMatch(/^1 room sellable on every night/m);
  });

  it('a partial offer of one room', () => {
    const e = run({ rooms: 2 }, 1);
    expect(e.counter_offers.map((o) => o.summary).join('\n')).not.toMatch(/\b1 rooms\b/);
    expect(e.trail.join('\n')).not.toMatch(/\b1 rooms\b/);
  });

  it('per-guest inclusions for one room and one guest', () => {
    const e = run(
      {
        rooms: 1,
        stay: { check_in: '2026-11-01', nights: 1 },
        guests_per_room_units: 1,
        inclusions: [
          {
            name: 'Breakfast',
            basis: 'per_guest_night',
            unit_cost_inr: 150,
            included_in_rate: true,
          },
        ],
      },
      1,
    );
    expect(e.trail.join('\n')).toMatch(/1 room x 1 guest x 1 night/);
  });
});
