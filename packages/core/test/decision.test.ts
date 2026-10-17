import { describe, expect, it } from 'vitest';
import { decide, planRooms, type Availability, type ReasonCode } from '../src/index.js';

const known = (sellable: number): Availability => ({ kind: 'known', sellable, nights: [] });
const unknown: Availability = { kind: 'unknown', unknown_dates: ['2026-11-02'] };
const missing: Availability = { kind: 'missing', missing_dates: ['2026-11-02'] };

describe('planRooms: how many rooms can be offered', () => {
  it.each([
    ['enough rooms', 10, known(10), 1, false, 10, [], null],
    ['more than enough', 10, known(25), 1, false, 10, [], null],
    ['short: partial', 12, known(10), 1, false, 10, ['PARTIAL_AVAILABILITY'], null],
    ['nothing sellable', 10, known(0), 1, false, 0, ['NO_CAPACITY'], 'DECLINE'],
    ['short and below the minimum partial', 12, known(3), 5, false, 0, ['NO_CAPACITY'], 'DECLINE'],
    ['short but at the minimum partial', 12, known(5), 5, false, 5, ['PARTIAL_AVAILABILITY'], null],
    ['small full request below the minimum partial is fine', 2, known(10), 5, false, 2, [], null],
    ['unknown availability', 10, unknown, 1, false, 10, ['UNKNOWN_AVAILABILITY'], null],
    ['a night not on sale', 10, missing, 1, false, 0, ['NO_INVENTORY_DATA'], 'DECLINE'],
    ['too late wins over everything', 10, known(10), 1, true, 0, ['TOO_LATE_TO_QUOTE'], 'DECLINE'],
  ] as const)(
    '%s',
    (_label, requested, availability, minPartial, tooLate, rooms, reasons, final) => {
      expect(planRooms(requested, availability, minPartial, tooLate)).toEqual({
        offered_rooms: rooms,
        reasons,
        final,
      });
    },
  );
});

describe('decide: the final decision (BR-05, BR-06)', () => {
  const plan = (reasons: ReasonCode[] = []) => ({ offered_rooms: 10, reasons, final: null });

  it.each([
    ['clean', [], [], 'OFFER', true],
    ['floor breach', [], ['FLOOR_BREACH'], 'REVIEW', false],
    ['unknown cost', [], ['UNKNOWN_COST'], 'REVIEW', false],
    ['unknown rate', [], ['UNKNOWN_RATE'], 'REVIEW', false],
    ['partial only', ['PARTIAL_AVAILABILITY'], [], 'PARTIAL_OFFER', false],
    ['partial and floor breach', ['PARTIAL_AVAILABILITY'], ['FLOOR_BREACH'], 'REVIEW', false],
    ['unknown availability', ['UNKNOWN_AVAILABILITY'], [], 'REVIEW', false],
  ] as const)('%s', (_label, planReasons, pricingReasons, decision, auto) => {
    const out = decide(plan([...planReasons]), pricingReasons);
    expect(out.decision).toBe(decision);
    expect(out.auto_confirm_allowed).toBe(auto);
  });

  it('keeps reasons unique and in catalogue order', () => {
    const out = decide(plan(['PARTIAL_AVAILABILITY']), [
      'UNKNOWN_RATE',
      'FLOOR_BREACH',
      'UNKNOWN_COST',
    ]);
    expect(out.reasons).toEqual([
      'FLOOR_BREACH',
      'UNKNOWN_COST',
      'UNKNOWN_RATE',
      'PARTIAL_AVAILABILITY',
    ]);
  });

  it('a final DECLINE ignores pricing reasons and never auto-confirms', () => {
    const out = decide({ offered_rooms: 0, reasons: ['NO_CAPACITY'], final: 'DECLINE' }, [
      'FLOOR_BREACH',
    ]);
    expect(out).toEqual({
      decision: 'DECLINE',
      reasons: ['NO_CAPACITY'],
      auto_confirm_allowed: false,
    });
  });
});
