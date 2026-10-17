import type { Evaluation, QuoteTotals } from '@c32/core';
import { meterStatus } from './meterStatus';

const totals = (contribution: number | null): QuoteTotals => ({
  room_nights: 20,
  room_revenue_inr: 40000,
  inclusions_revenue_inr: 0,
  variable_cost_inr: 16000,
  inclusions_cost_inr: 0,
  contribution_inr: contribution,
  contribution_margin_pct: null,
  contribution_floor_inr: 20000,
  floor_headroom_inr: null,
  shortfall_inr: null,
  min_rate_per_room_night_inr: 1800,
});

const evaluation = (
  decision: Evaluation['decision'],
  reasons: Evaluation['reasons'],
  offered = 10,
): Evaluation => ({ decision, reasons, requested_rooms: 10, offered_rooms: offered }) as Evaluation;

describe('meter status for each decision', () => {
  it.each([
    ['NO_CAPACITY', 'Cannot offer: no rooms available'],
    ['NO_INVENTORY_DATA', 'Cannot offer: not on sale on these dates'],
    ['TOO_LATE_TO_QUOTE', 'Cannot offer: too late to quote'],
  ] as const)('DECLINE with %s', (reason, label) => {
    // Nothing offered means a contribution of 0, which is not "below the floor".
    expect(meterStatus(evaluation('DECLINE', [reason], 0), totals(0))).toEqual({
      tone: 'danger',
      label,
    });
  });

  it('REVIEW below the floor', () => {
    expect(meterStatus(evaluation('REVIEW', ['FLOOR_BREACH']), totals(14000)).label).toBe(
      'Below floor: review required',
    );
  });

  it('REVIEW with an unknown cost or availability stays unknown, never zero', () => {
    expect(meterStatus(evaluation('REVIEW', ['UNKNOWN_COST']), totals(null))).toEqual({
      tone: 'unknown',
      label: 'Unknown: review required',
    });
    expect(meterStatus(evaluation('REVIEW', ['UNKNOWN_AVAILABILITY']), totals(24000)).label).toBe(
      'Availability unknown: review required',
    );
  });

  it('PARTIAL_OFFER and OFFER', () => {
    expect(
      meterStatus(evaluation('PARTIAL_OFFER', ['PARTIAL_AVAILABILITY'], 8), totals(24000)).label,
    ).toBe('Meets floor: partial offer of 8 rooms');
    expect(meterStatus(evaluation('OFFER', []), totals(24000))).toEqual({
      tone: 'success',
      label: 'Meets floor',
    });
  });

  it('follows an estimated rate across the floor in either direction', () => {
    expect(meterStatus(evaluation('REVIEW', ['FLOOR_BREACH']), totals(24000)).label).toBe(
      'Meets floor',
    );
    expect(meterStatus(evaluation('OFFER', []), totals(14000)).label).toBe(
      'Below floor: review required',
    );
  });
});
