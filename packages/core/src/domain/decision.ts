import type { Decision, ReasonCode } from '../contract/codes.js';
import type { Availability } from './availability.js';
import { orderReasons } from './unknowns.js';

/**
 * Decision rules (blueprint 5.7, 6.2, 6.5; BR-05). Checked in this order, first match wins:
 *
 * 1. TOO_LATE_TO_QUOTE                       -> DECLINE
 * 2. a night has no inventory row            -> DECLINE  (NO_INVENTORY_DATA)
 * 3. sellable is 0 or below min_partial_rooms -> DECLINE  (NO_CAPACITY)
 * 4. availability unknown                    -> REVIEW   (UNKNOWN_AVAILABILITY, no hold)
 * 5. otherwise price the offered rooms (requested, capped at sellable) and collect
 *    FLOOR_BREACH / UNKNOWN_COST / UNKNOWN_RATE:
 *    - any of those                          -> REVIEW   (plus PARTIAL_AVAILABILITY if short)
 *    - short of rooms only                   -> PARTIAL_OFFER (PARTIAL_AVAILABILITY)
 *    - nothing                               -> OFFER
 *
 * A partial offer that also breaches the floor is REVIEW, not PARTIAL_OFFER, so it lands in the
 * owner's queue instead of looking like a clean offer. Requested rooms above sellable can never
 * produce an over-hold: offered rooms are capped at sellable.
 */

export interface RoomPlan {
  /** Rooms the engine prices and would hold. 0 for DECLINE. */
  offered_rooms: number;
  /** Decline causes and availability reasons decided before pricing. */
  reasons: ReasonCode[];
  /** Set when the outcome is already final (DECLINE), so pricing reasons do not apply. */
  final: Decision | null;
}

/** Steps 1 to 4: decide how many rooms can be offered, before any money is computed. */
export function planRooms(
  requestedRooms: number,
  availability: Availability,
  minPartialRooms: number,
  tooLate: boolean,
): RoomPlan {
  if (tooLate) return { offered_rooms: 0, reasons: ['TOO_LATE_TO_QUOTE'], final: 'DECLINE' };
  if (availability.kind === 'missing') {
    return { offered_rooms: 0, reasons: ['NO_INVENTORY_DATA'], final: 'DECLINE' };
  }
  if (availability.kind === 'unknown') {
    return { offered_rooms: requestedRooms, reasons: ['UNKNOWN_AVAILABILITY'], final: null };
  }
  const { sellable } = availability;
  if (sellable === 0 || (sellable < requestedRooms && sellable < minPartialRooms)) {
    return { offered_rooms: 0, reasons: ['NO_CAPACITY'], final: 'DECLINE' };
  }
  if (sellable < requestedRooms) {
    return { offered_rooms: sellable, reasons: ['PARTIAL_AVAILABILITY'], final: null };
  }
  return { offered_rooms: requestedRooms, reasons: [], final: null };
}

export interface DecisionOutcome {
  decision: Decision;
  reasons: ReasonCode[];
  auto_confirm_allowed: boolean;
}

/** Step 5: combine the room plan with the pricing reasons into the final decision. */
export function decide(plan: RoomPlan, pricingReasons: readonly ReasonCode[]): DecisionOutcome {
  if (plan.final !== null) {
    return {
      decision: plan.final,
      reasons: orderReasons(plan.reasons),
      auto_confirm_allowed: false,
    };
  }
  const reasons = orderReasons([...plan.reasons, ...pricingReasons]);
  const needsReview = reasons.some((r) => r !== 'PARTIAL_AVAILABILITY');
  const decision: Decision = needsReview
    ? 'REVIEW'
    : reasons.includes('PARTIAL_AVAILABILITY')
      ? 'PARTIAL_OFFER'
      : 'OFFER';
  return { decision, reasons, auto_confirm_allowed: decision === 'OFFER' && reasons.length === 0 };
}
