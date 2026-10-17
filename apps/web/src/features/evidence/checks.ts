import { flatNights, mapC32Fixture, price } from '@c32/core';
import type { QuoteRequest } from '@c32/core';
import fixtureJson from '../../../../../data/fixtures/fixture.json';
import type { ApiClient } from '../../lib/api';

const fixture = mapC32Fixture(fixtureJson);

export interface CheckResult {
  id: string;
  /** The public check from the case fixture, in its own words. */
  statement: string;
  expected: string;
  actual: string;
  passed: boolean;
}

export interface CheckRun {
  ranAt: string;
  results: CheckResult[];
}

const SAMPLE = fixture.request;

/**
 * The three public checks from data/fixtures/fixture.json, run against the connected API with
 * stateless previews (no hold is taken, nothing is saved). The expected numbers come from the
 * fixture, not from this file.
 */
export async function runPublicChecks(api: ApiClient, now: Date = new Date()): Promise<CheckRun> {
  const [one, two, three] = fixture.publicChecks;
  const results: CheckResult[] = [];

  const base: QuoteRequest = { ...SAMPLE, rate_per_room_night_inr: 2000 };
  const check1 = (await api.previewQuote(base)).evaluation;
  const expected1 = fixture.expected;
  results.push({
    id: 'check-1',
    statement: one ?? 'Ten rooms for two nights at 2000 per room-night gives 40000 room revenue.',
    expected: `Revenue ${expected1.room_revenue_inr}, contribution ${expected1.contribution_inr}, auto-confirm allowed`,
    actual: `Revenue ${check1.totals.room_revenue_inr ?? 'unknown'}, contribution ${check1.totals.contribution_inr ?? 'unknown'}, auto-confirm ${check1.auto_confirm_allowed ? 'allowed' : 'not allowed'}`,
    passed:
      check1.totals.room_revenue_inr === expected1.room_revenue_inr &&
      check1.totals.contribution_inr === expected1.contribution_inr &&
      check1.auto_confirm_allowed,
  });

  const check2 = (await api.previewQuote({ ...base, rooms: SAMPLE.rooms + 2 })).evaluation;
  const sellable = SAMPLE.rooms;
  results.push({
    id: 'check-2',
    statement:
      two ??
      'A request for 12 rooms when only 10 are available must offer a partial alternative or decline.',
    expected: `A partial offer or a decline, with the shortage flagged. Never more than ${sellable} rooms.`,
    actual: `${check2.decision}, ${check2.offered_rooms} rooms offered`,
    // A partial offer that also breaches the floor goes to review; that still counts, as long as
    // the shortage is flagged and no more than the available rooms are offered.
    passed:
      check2.decision !== 'OFFER' &&
      check2.offered_rooms <= sellable &&
      check2.reasons.some((r) => r === 'PARTIAL_AVAILABILITY' || r === 'NO_CAPACITY'),
  });

  const check3 = (await api.previewQuote({ ...base, rate_per_room_night_inr: 1700 })).evaluation;
  results.push({
    id: 'check-3',
    statement:
      three ?? 'Discounts below the contribution floor require review and cannot auto-confirm.',
    expected: 'Review required, floor breach, auto-confirm not allowed',
    actual: `${check3.decision}, reasons ${check3.reasons.join(', ') || 'none'}, auto-confirm ${check3.auto_confirm_allowed ? 'allowed' : 'not allowed'}`,
    passed:
      check3.decision === 'REVIEW' &&
      check3.reasons.includes('FLOOR_BREACH') &&
      !check3.auto_confirm_allowed,
  });

  return { ranAt: now.toISOString(), results };
}

export interface ClaimCheck {
  id: string;
  recomputed: string;
  matches: boolean;
}

/** Derived ledger claims that can be recomputed in the browser from the fixture. */
export function verifyDerivedClaims(): ClaimCheck[] {
  const quote = fixtureJson.records.quote;
  const { totals } = price({
    rooms: quote.rooms,
    nights: flatNights(
      SAMPLE.stay.check_in,
      quote.nights,
      quote.rate_per_room_night_inr,
      quote.variable_cost_per_room_night_inr,
    ),
    floor: {
      contribution_floor_inr: quote.contribution_floor_inr,
      total_rooms_units: Math.max(...fixtureJson.records.inventory.map((r) => r.rooms ?? 0)),
    },
  });
  return [
    {
      id: 'E01',
      recomputed: `Revenue ${totals.room_revenue_inr}, contribution ${totals.contribution_inr}`,
      matches: totals.room_revenue_inr === 40000 && totals.contribution_inr === 24000,
    },
    {
      id: 'E02',
      recomputed: `Minimum safe rate ${totals.min_rate_per_room_night_inr}`,
      matches: totals.min_rate_per_room_night_inr === 2000,
    },
  ];
}
