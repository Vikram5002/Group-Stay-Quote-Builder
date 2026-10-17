import type { ReasonCode } from '../contract/codes.js';
import type { InventoryNight, RatePlanNight } from '../contract/inventory.js';
import type { Policy } from '../contract/policy.js';
import type { Evaluation } from '../contract/quote.js';
import { sellableRooms, type Availability } from './availability.js';
import { counterOffers } from './counter-offers.js';
import { decide, planRooms, type DecisionOutcome, type RoomPlan } from './decision.js';
import { inclusionExtras } from './inclusions.js';
import { NO_EXTRAS, nightsFromRatePlan, price, type PricingExtras } from './pricing.js';
import type { ResolvedQuoteRequest } from './request.js';
import { discountedRate } from './floor.js';
import { formatInZone } from './timezone.js';
import { unknownPricingReasons } from './unknowns.js';
import { computeValidity, type Validity } from './validity.js';

/**
 * The evaluation pipeline (blueprint 6.2), steps 2 to 7, for one validated request:
 * validity -> availability -> room plan -> nightly prices -> pricing -> decision -> trail
 * -> counter-offers.
 * Pure: everything it needs is passed in, including "now". The terms hash and the hold commit
 * belong to the service layer.
 */

export interface EvaluationContext {
  inventory: readonly InventoryNight[];
  ratePlan: readonly RatePlanNight[];
  policy: Policy;
  /** The issue instant, read from the injected clock. */
  nowMs: number;
}

export interface EvaluationResult {
  evaluation: Evaluation;
  validity: Validity;
}

/**
 * Package extras from the request's inclusions, priced for the offered rooms (blueprint 5.6).
 * Guests per room come from the request, else the policy default; unknown stays unknown.
 */
function extrasFor(request: ResolvedQuoteRequest, rooms: number, policy: Policy): PricingExtras {
  const inclusions = request.inclusions ?? [];
  if (inclusions.length === 0) return NO_EXTRAS;
  const guests = request.guests_per_room_units ?? policy.guests_per_room_units;
  const x = inclusionExtras(inclusions, rooms, request.stay.nights, guests);
  return {
    revenue_inr: x.revenue_inr,
    cost_inr: x.cost_inr,
    detail: x.lines.map((l) => l.explain),
  };
}

function availabilityLine(
  request: ResolvedQuoteRequest,
  availability: Availability,
  plan: RoomPlan,
): string {
  switch (availability.kind) {
    case 'missing':
      return `no inventory for ${request.room_type} on ${availability.missing_dates.join(', ')}: not on sale`;
    case 'unknown':
      return `availability unknown on ${availability.unknown_dates.join(', ')}: no hold can be taken`;
    case 'known': {
      const { sellable } = availability;
      const over = request.stay.night_dates.join(', ');
      if (plan.offered_rooms === 0)
        return `${sellable} rooms sellable on every night (${over}): nothing to offer`;
      if (plan.offered_rooms < request.rooms) {
        return `${request.rooms} requested, ${sellable} sellable on every night (${over}): offering ${plan.offered_rooms}`;
      }
      return `${sellable} rooms sellable on every night (${over}): ${request.rooms} requested fit`;
    }
  }
}

function decisionLine(outcome: DecisionOutcome): string {
  const why = outcome.reasons.length > 0 ? `: ${outcome.reasons.join(', ')}` : '';
  const auto = outcome.auto_confirm_allowed ? ', auto-confirm allowed' : ', no auto-confirm';
  return `decision ${outcome.decision}${why}${auto}`;
}

/** Steps 2 to 6 without counter-offers; also what the counter-offer generator re-runs. */
function assess(request: ResolvedQuoteRequest, ctx: EvaluationContext): EvaluationResult {
  const { policy } = ctx;
  const { stay } = request;

  const validity = computeValidity(ctx.nowMs, stay.check_in, policy);
  const availability = sellableRooms(ctx.inventory, request.room_type, stay.night_dates);
  const plan = planRooms(
    request.rooms,
    availability,
    policy.min_partial_rooms_units,
    validity.too_late,
  );

  const nights = nightsFromRatePlan(
    stay.check_in,
    stay.nights,
    request.room_type,
    ctx.ratePlan,
    // Sales gives a discount off the floor rate (D-057); otherwise an explicit rate or the plan.
    request.discount_pct === undefined
      ? request.rate_per_room_night_inr
      : discountedRate(policy, request.discount_pct),
  );
  const extras = plan.final === null ? extrasFor(request, plan.offered_rooms, policy) : NO_EXTRAS;
  const pricing = price({ rooms: plan.offered_rooms, nights, floor: policy, extras });

  const pricingReasons: ReasonCode[] =
    plan.final === null
      ? [
          ...unknownPricingReasons(nights, extras),
          ...(pricing.floor_ok === false ? (['FLOOR_BREACH'] as const) : []),
        ]
      : [];
  const outcome = decide(plan, pricingReasons);

  const trail: string[] = [];
  if (validity.too_late) {
    trail.push(
      `cutoff ${formatInZone(validity.valid_until_ms, policy.timezone)} leaves less than ${policy.min_validity_hours}h to respond: too late to quote`,
    );
  } else {
    trail.push(availabilityLine(request, availability, plan));
  }
  if (plan.final === null) trail.push(...pricing.trail);
  trail.push(decisionLine(outcome));

  return {
    validity,
    evaluation: {
      decision: outcome.decision,
      reasons: outcome.reasons,
      check_in: stay.check_in,
      check_out: stay.check_out,
      nights: stay.nights,
      requested_rooms: request.rooms,
      offered_rooms: plan.offered_rooms,
      shortfall_rooms: request.rooms - plan.offered_rooms,
      auto_confirm_allowed: outcome.auto_confirm_allowed,
      totals: pricing.totals,
      counter_offers: [],
      trail,
    },
  };
}

/** Evaluate a validated request: decision, totals, trail and floor-safe counter-offers. */
export function evaluate(request: ResolvedQuoteRequest, ctx: EvaluationContext): EvaluationResult {
  const { evaluation, validity } = assess(request, ctx);
  const reassess = (r: ResolvedQuoteRequest) => assess(r, ctx).evaluation;
  return {
    validity,
    evaluation: {
      ...evaluation,
      counter_offers: counterOffers(request, evaluation, reassess),
    },
  };
}
