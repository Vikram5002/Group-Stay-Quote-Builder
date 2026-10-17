import { stayNights, checkOutDate, daysBetween } from '@c32/core';
import type {
  CounterOffer,
  Decision,
  Evaluation,
  InventoryNight,
  Policy,
  QuoteRequest,
  QuoteTotals,
  RatePlanNight,
  ReasonCode,
} from '@c32/core';

/**
 * Stand-in for the rules engine so the UI can be built and tested against the contract.
 * It is deliberately small and is replaced by the real engine from @c32/core when
 * T1-02 to T1-04 land. It is only ever used by the mock server.
 */
export interface EvaluateInput {
  request: QuoteRequest;
  policy: Policy;
  inventory: readonly InventoryNight[];
  ratePlan: readonly RatePlanNight[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function evaluate({ request, policy, inventory, ratePlan }: EvaluateInput): Evaluation {
  const nights =
    request.stay.nights ??
    (request.stay.check_out ? daysBetween(request.stay.check_in, request.stay.check_out) : 1);
  const dates = stayNights(request.stay.check_in, nights);
  const checkOut = checkOutDate(request.stay.check_in, nights);

  const invRows = dates.map((d) =>
    inventory.find((r) => r.date === d && r.room_type === request.room_type),
  );
  const planRows = dates.map((d) =>
    ratePlan.find((r) => r.date === d && r.room_type === request.room_type),
  );

  const base = {
    check_in: request.stay.check_in,
    check_out: checkOut,
    nights,
    requested_rooms: request.rooms,
    counter_offers: [] as CounterOffer[],
  };

  const emptyTotals = (floor: number): QuoteTotals => ({
    room_nights: 0,
    room_revenue_inr: 0,
    inclusions_revenue_inr: 0,
    variable_cost_inr: 0,
    inclusions_cost_inr: 0,
    contribution_inr: 0,
    contribution_margin_pct: null,
    contribution_floor_inr: floor,
    floor_headroom_inr: -floor,
    shortfall_inr: floor,
    min_rate_per_room_night_inr: null,
  });
  const floorFor = (roomNights: number) =>
    policy.floor_mode === 'per_room_night'
      ? (policy.floor_per_room_night_inr ?? 0) * roomNights
      : policy.contribution_floor_inr;

  if (invRows.some((r) => r === undefined)) {
    return {
      ...base,
      decision: 'DECLINE',
      reasons: ['NO_INVENTORY_DATA'],
      offered_rooms: 0,
      shortfall_rooms: request.rooms,
      auto_confirm_allowed: false,
      totals: emptyTotals(floorFor(0)),
      trail: ['At least one night is not on sale (no inventory row).'],
    };
  }
  const known = invRows as InventoryNight[];
  if (known.some((r) => r.available_units === null)) {
    return {
      ...base,
      decision: 'REVIEW',
      reasons: ['UNKNOWN_AVAILABILITY'],
      offered_rooms: 0,
      shortfall_rooms: request.rooms,
      auto_confirm_allowed: false,
      totals: {
        ...emptyTotals(floorFor(0)),
        room_revenue_inr: null,
        inclusions_revenue_inr: null,
        variable_cost_inr: null,
        inclusions_cost_inr: null,
        contribution_inr: null,
        floor_headroom_inr: null,
        shortfall_inr: null,
      },
      trail: ['Availability is unknown for at least one night, so no rooms can be held.'],
    };
  }

  const sellable = Math.min(...known.map((r) => r.available_units ?? 0));
  const offered = Math.min(request.rooms, sellable);
  if (offered < Math.max(1, policy.min_partial_rooms_units) && offered < request.rooms) {
    return {
      ...base,
      decision: 'DECLINE',
      reasons: ['NO_CAPACITY'],
      offered_rooms: 0,
      shortfall_rooms: request.rooms,
      auto_confirm_allowed: false,
      totals: emptyTotals(floorFor(0)),
      trail: [`Only ${sellable} room(s) are sellable on every night; none can be offered.`],
    };
  }

  const roomNights = offered * nights;
  const floor = floorFor(roomNights);
  const reasons: ReasonCode[] = [];
  const trail: string[] = [];

  const rates = planRows.map(
    (p) => request.rate_per_room_night_inr ?? p?.rate_per_room_night_inr ?? null,
  );
  const costs = planRows.map((p) => p?.variable_cost_per_room_night_inr ?? null);
  const rateKnown = rates.every((r) => r !== null);
  const costKnown = costs.every((c) => c !== null);

  const revenue = rateKnown ? rates.reduce<number>((s, r) => s + (r ?? 0), 0) * offered : null;
  const variableCost = costKnown ? costs.reduce<number>((s, c) => s + (c ?? 0), 0) * offered : null;

  const guests = request.guests_per_room_units ?? policy.guests_per_room_units;
  let inclRevenue: number | null = 0;
  let inclCost: number | null = 0;
  for (const inc of request.inclusions ?? []) {
    const units =
      inc.basis === 'per_guest_night'
        ? guests === null
          ? null
          : offered * guests * nights
        : roomNights;
    inclCost =
      inclCost === null || inc.unit_cost_inr === null || units === null
        ? null
        : inclCost + units * inc.unit_cost_inr;
    if (!inc.included_in_rate && inc.price_inr !== undefined) {
      inclRevenue =
        inclRevenue === null || units === null ? null : inclRevenue + units * inc.price_inr;
    }
  }

  if (!rateKnown) reasons.push('UNKNOWN_RATE');
  if (!costKnown || inclCost === null) reasons.push('UNKNOWN_COST');

  const contribution =
    revenue !== null && variableCost !== null && inclCost !== null && inclRevenue !== null
      ? revenue + inclRevenue - variableCost - inclCost
      : null;

  if (revenue !== null) trail.push(`Room revenue: ${roomNights} room-nights, total ${revenue}.`);
  if (variableCost !== null) trail.push(`Variable cost: ${variableCost}.`);
  if (contribution !== null) trail.push(`Contribution: ${contribution} against floor ${floor}.`);

  let minRate: number | null = null;
  if (variableCost !== null && inclCost !== null && inclRevenue !== null && roomNights > 0) {
    minRate = Math.ceil((floor + variableCost + inclCost - inclRevenue) / roomNights);
  }

  const counterOffers: CounterOffer[] = [];
  if (contribution !== null && contribution < floor) {
    reasons.push('FLOOR_BREACH');
    if (minRate !== null && variableCost !== null && inclCost !== null && inclRevenue !== null) {
      const fixedContribution = minRate * roomNights + inclRevenue - variableCost - inclCost;
      counterOffers.push({
        type: 'RAISE_RATE',
        summary: `Raise the rate to ${minRate} per room-night to meet the floor.`,
        rate_per_room_night_inr: minRate,
        contribution_inr: fixedContribution,
        floor_headroom_inr: fixedContribution - floor,
      });
    }
  }
  if (offered < request.rooms) {
    reasons.push('PARTIAL_AVAILABILITY');
    trail.push(`Only ${offered} of ${request.rooms} rooms are sellable on every night.`);
  }

  const review = reasons.some((r) => r !== 'PARTIAL_AVAILABILITY');
  const decision: Decision = review
    ? 'REVIEW'
    : offered < request.rooms
      ? 'PARTIAL_OFFER'
      : 'OFFER';

  return {
    ...base,
    decision,
    reasons,
    offered_rooms: offered,
    shortfall_rooms: request.rooms - offered,
    auto_confirm_allowed: decision === 'OFFER' && reasons.length === 0,
    totals: {
      room_nights: roomNights,
      room_revenue_inr: revenue,
      inclusions_revenue_inr: inclRevenue,
      variable_cost_inr: variableCost,
      inclusions_cost_inr: inclCost,
      contribution_inr: contribution,
      contribution_margin_pct:
        contribution !== null && revenue !== null && revenue > 0
          ? round1((contribution / revenue) * 100)
          : null,
      contribution_floor_inr: floor,
      floor_headroom_inr: contribution === null ? null : contribution - floor,
      shortfall_inr: contribution === null ? null : Math.max(0, floor - contribution),
      min_rate_per_room_night_inr: minRate,
    },
    counter_offers: counterOffers,
    trail,
  };
}
