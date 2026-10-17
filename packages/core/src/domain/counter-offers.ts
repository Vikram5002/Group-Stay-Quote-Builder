import type { ReasonCode } from '../contract/codes.js';
import type { CounterOffer, Evaluation, InclusionInput } from '../contract/quote.js';
import type { ResolvedQuoteRequest } from './request.js';

/**
 * Counter-offer generator (blueprint 6.4, FR-12). When a quote breaches the floor or is short of
 * rooms, the sales manager gets ranked next moves instead of a red flag. Every candidate is run
 * through the same engine and kept only if it comes back a clean OFFER, so each one is
 * guaranteed floor-safe and within capacity.
 *
 * Ranked in this order:
 * 1. PARTIAL_ROOMS     offer the sellable rooms (when short)
 * 2. RAISE_RATE        charge the minimum safe rate
 * 3. REPRICE_INCLUSION charge a bundled inclusion separately, at its unit cost
 *
 * CHANGE_VOLUME is no longer generated (D-056): the floor is a rate per room-night, so more rooms
 * raise the floor as fast as the contribution and never fix a breach.
 * No counter-offers when a value is unknown (it cannot be proven safe) or for a DECLINE.
 * ALT_DATES is a COULD item and is not generated.
 */

/** Re-evaluates a modified request with the same inventory, rates, policy and clock. */
export type Reassess = (request: ResolvedQuoteRequest) => Evaluation;

const FIXABLE: ReadonlySet<ReasonCode> = new Set(['FLOOR_BREACH', 'PARTIAL_AVAILABILITY']);

function isClean(e: Evaluation): boolean {
  return e.decision === 'OFFER' && e.reasons.length === 0;
}

function offer(
  type: CounterOffer['type'],
  summary: string,
  e: Evaluation,
  extra: Partial<Pick<CounterOffer, 'rooms' | 'rate_per_room_night_inr' | 'inclusions'>>,
): CounterOffer {
  // A clean OFFER always has a known contribution and headroom.
  return {
    type,
    summary,
    ...extra,
    contribution_inr: e.totals.contribution_inr as number,
    floor_headroom_inr: e.totals.floor_headroom_inr as number,
  };
}

function unitLabel(inc: InclusionInput): string {
  return inc.basis === 'per_guest_night' ? 'guest-night' : 'room-night';
}

export function counterOffers(
  request: ResolvedQuoteRequest,
  evaluation: Evaluation,
  reassess: Reassess,
): CounterOffer[] {
  const { reasons } = evaluation;
  const eligible =
    evaluation.decision !== 'DECLINE' &&
    evaluation.offered_rooms > 0 &&
    reasons.length > 0 &&
    reasons.every((r) => FIXABLE.has(r));
  if (!eligible) return [];

  const out: CounterOffer[] = [];
  // Work from the rooms that can actually be offered, so every option fits inventory.
  const base: ResolvedQuoteRequest =
    evaluation.offered_rooms < request.rooms
      ? { ...request, rooms: evaluation.offered_rooms }
      : request;
  const baseEval = base === request ? evaluation : reassess(base);

  if (reasons.includes('PARTIAL_AVAILABILITY') && isClean(baseEval)) {
    out.push(
      offer('PARTIAL_ROOMS', `Offer ${base.rooms} rooms instead of ${request.rooms}`, baseEval, {
        rooms: base.rooms,
      }),
    );
  }

  if (!baseEval.reasons.includes('FLOOR_BREACH')) return out;

  const minRate = baseEval.totals.min_rate_per_room_night_inr;
  if (minRate !== null) {
    const e = reassess({ ...base, rate_per_room_night_inr: minRate });
    if (isClean(e)) {
      out.push(
        offer('RAISE_RATE', `Raise the rate to ${minRate} per room-night (minimum safe rate)`, e, {
          rate_per_room_night_inr: minRate,
          rooms: base.rooms,
        }),
      );
    }
  }

  const inclusions = base.inclusions ?? [];
  inclusions.forEach((inc, i) => {
    if (!inc.included_in_rate || inc.unit_cost_inr === null) return;
    const repriced: InclusionInput[] = inclusions.map((x, j) =>
      j === i ? { ...x, included_in_rate: false, price_inr: x.unit_cost_inr as number } : x,
    );
    const e = reassess({ ...base, inclusions: repriced });
    if (isClean(e)) {
      out.push(
        offer(
          'REPRICE_INCLUSION',
          `Charge ${inc.name} separately at ${inc.unit_cost_inr} per ${unitLabel(inc)}`,
          e,
          { inclusions: repriced, rooms: base.rooms },
        ),
      );
    }
  });

  return out;
}
