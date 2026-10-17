import type { ReasonCode } from '../contract/codes.js';
import type { InventoryNight, RatePlanNight } from '../contract/inventory.js';
import type { Policy } from '../contract/policy.js';
import type { Evaluation } from '../contract/quote.js';
import { sellableRooms, type Availability } from './availability.js';
import { counterOffers } from './counter-offers.js';
import { decide, planRooms, type DecisionOutcome, type RoomPlan } from './decision.js';
import { inclusionExtras } from './inclusions.js';
import { floorPasses } from './floor.js';
import { sumKnown } from './money.js';
import {
  NO_EXTRAS,
  completeTotals,
  explainFloor,
  nightsFromRatePlan,
  price,
  priceTotals,
  type NightPrice,
  type PricingExtras,
  type TotalsBase,
} from './pricing.js';
import { roomsByNight, spanDates, type ResolvedQuoteRequest } from './request.js';
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
function extrasFor(
  request: ResolvedQuoteRequest,
  rooms: number,
  policy: Policy,
  nights = request.stay.nights,
): PricingExtras {
  const inclusions = request.inclusions ?? [];
  if (inclusions.length === 0) return NO_EXTRAS;
  const guests = request.guests_per_room_units ?? policy.guests_per_room_units;
  const x = inclusionExtras(inclusions, rooms, nights, guests);
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
  if (request.lines.length > 1) return assessLines(request, ctx);
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
    overrideRate(request, policy),
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
      lines: [
        {
          check_in: stay.check_in,
          check_out: stay.check_out,
          nights: stay.nights,
          rooms: request.rooms,
        },
      ],
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

/** The rate every night is priced at: a Sales discount, an explicit rate, or the plan. */
function overrideRate(request: ResolvedQuoteRequest, policy: Policy): number | undefined {
  return request.discount_pct === undefined
    ? request.rate_per_room_night_inr
    : discountedRate(policy, request.discount_pct);
}

/**
 * A multi-line quote (D-058): several blocks of rooms, for example 5 rooms for 3 nights plus 3
 * rooms for 4 nights. Each night needs the sum of the lines that cover it; the quote is held all
 * together or not at all, so a shortage on any night declines it (no partial offers). Each line
 * is priced on its own nights and the totals are judged together against the floor.
 */
function assessLines(request: ResolvedQuoteRequest, ctx: EvaluationContext): EvaluationResult {
  const { policy } = ctx;
  const lines = request.lines;
  const totalRooms = lines.reduce((n, l) => n + l.rooms, 0);
  const first = lines.map((l) => l.stay.check_in).sort()[0] as string;
  const last = lines
    .map((l) => l.stay.check_out)
    .sort()
    .at(-1) as string;
  const demand = roomsByNight(lines);
  const dates = [...demand.keys()].sort();

  const validity = computeValidity(ctx.nowMs, first, policy);
  const availability = sellableRooms(ctx.inventory, request.room_type, dates);
  const trail: string[] = [];
  let plan: RoomPlan;
  if (validity.too_late) {
    plan = { offered_rooms: 0, reasons: ['TOO_LATE_TO_QUOTE'], final: 'DECLINE' };
    trail.push(
      `cutoff ${formatInZone(validity.valid_until_ms, policy.timezone)} leaves less than ${policy.min_validity_hours}h to respond: too late to quote`,
    );
  } else if (availability.kind === 'missing') {
    plan = { offered_rooms: 0, reasons: ['NO_INVENTORY_DATA'], final: 'DECLINE' };
    trail.push(
      `no inventory for ${request.room_type} on ${availability.missing_dates.join(', ')}: not on sale`,
    );
  } else if (availability.kind === 'unknown') {
    plan = { offered_rooms: totalRooms, reasons: ['UNKNOWN_AVAILABILITY'], final: null };
    trail.push(
      `availability unknown on ${availability.unknown_dates.join(', ')}: no hold can be taken`,
    );
  } else {
    const free = new Map(availability.nights.map((n) => [n.date, n.available_units] as const));
    const short = dates.filter((d) => (demand.get(d) ?? 0) > (free.get(d) ?? 0));
    for (const d of dates) trail.push(`${d}: ${demand.get(d)} rooms needed, ${free.get(d)} free`);
    if (short.length > 0) {
      plan = { offered_rooms: 0, reasons: ['NO_CAPACITY'], final: 'DECLINE' };
      trail.push(
        `not enough rooms on ${short.join(', ')}: the lines are held together or not at all`,
      );
    } else {
      plan = { offered_rooms: totalRooms, reasons: [], final: null };
    }
  }

  const rate = overrideRate(request, policy);
  const allNights: NightPrice[] = [];
  const parts: TotalsBase[] = [];
  if (plan.final === null) {
    lines.forEach((line, i) => {
      const nights = nightsFromRatePlan(
        line.stay.check_in,
        line.stay.nights,
        request.room_type,
        ctx.ratePlan,
        rate,
      );
      const extras = extrasFor(request, line.rooms, policy, line.stay.nights);
      const t = priceTotals({ rooms: line.rooms, nights, floor: policy, extras });
      allNights.push(...nights);
      parts.push(t);
      trail.push(
        `line ${i + 1}: ${line.rooms} rooms x ${line.stay.nights} nights from ${line.stay.check_in} = ${t.room_nights} room-nights, room revenue ${t.room_revenue_inr ?? 'unknown'}, variable cost ${t.variable_cost_inr ?? 'unknown'}`,
      );
      for (const d of extras.detail ?? []) trail.push(`line ${i + 1}: ${d}`);
    });
  }
  const sum = (key: keyof Omit<TotalsBase, 'room_nights'>) =>
    parts.length === 0 ? 0 : sumKnown(parts.map((t) => t[key]));
  const base: TotalsBase = {
    room_nights: parts.reduce((n, t) => n + t.room_nights, 0),
    room_revenue_inr: sum('room_revenue_inr'),
    inclusions_revenue_inr: sum('inclusions_revenue_inr'),
    variable_cost_inr: sum('variable_cost_inr'),
    inclusions_cost_inr: sum('inclusions_cost_inr'),
  };
  const totals = completeTotals(base, policy);
  const floorOk =
    totals.contribution_inr === null || totals.contribution_floor_inr === null
      ? null
      : floorPasses(totals.contribution_inr, totals.contribution_floor_inr);

  const pricingReasons: ReasonCode[] =
    plan.final === null
      ? [
          ...unknownPricingReasons(allNights, {
            revenue_inr: base.inclusions_revenue_inr,
            cost_inr: base.inclusions_cost_inr,
          }),
          ...(floorOk === false ? (['FLOOR_BREACH'] as const) : []),
        ]
      : [];
  const outcome = decide(plan, pricingReasons);

  if (plan.final === null) {
    const hasExtras = base.inclusions_revenue_inr !== 0 || base.inclusions_cost_inr !== 0;
    trail.push(
      `all lines: ${totals.room_nights} room-nights, room revenue ${totals.room_revenue_inr ?? 'unknown'}, variable cost ${totals.variable_cost_inr ?? 'unknown'}`,
    );
    trail.push(...explainFloor(policy, totals, hasExtras));
  }
  trail.push(decisionLine(outcome));

  return {
    validity,
    evaluation: {
      decision: outcome.decision,
      reasons: outcome.reasons,
      check_in: first,
      check_out: last,
      nights: spanDates(lines).length,
      requested_rooms: totalRooms,
      offered_rooms: plan.offered_rooms,
      shortfall_rooms: totalRooms - plan.offered_rooms,
      auto_confirm_allowed: outcome.auto_confirm_allowed,
      totals,
      counter_offers: [],
      trail,
      lines: lines.map((l) => ({
        check_in: l.stay.check_in,
        check_out: l.stay.check_out,
        nights: l.stay.nights,
        rooms: l.rooms,
      })),
    },
  };
}
