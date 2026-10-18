import type { Evaluation, QuoteTotals, ReasonCode } from '@c32/core';
import type { Tone } from '../../components';
import { counted } from '../../lib/plural';

export interface MeterStatus {
  tone: Tone;
  label: string;
}

/** Why nothing can be offered, for each reason the engine declines with. */
const DECLINE_LABEL: Partial<Record<ReasonCode, string>> = {
  NO_CAPACITY: 'Cannot offer: no rooms available',
  NO_INVENTORY_DATA: 'Cannot offer: not on sale on these dates',
  TOO_LATE_TO_QUOTE: 'Cannot offer: too late to quote',
};

/**
 * The meter's label for a decision. Room-related reasons (decline, unknown availability, partial)
 * come from the evaluation; the floor comes from `totals`, which may be a browser estimate for a
 * new rate. A contribution of 0 because nothing can be offered is never called "over the limit".
 */
export function meterStatus(evaluation: Evaluation, totals: QuoteTotals): MeterStatus {
  if (evaluation.decision === 'DECLINE') {
    const reason = evaluation.reasons.find((r) => DECLINE_LABEL[r]);
    return { tone: 'danger', label: (reason && DECLINE_LABEL[reason]) ?? 'Cannot offer' };
  }
  if (evaluation.reasons.includes('UNKNOWN_AVAILABILITY')) {
    return { tone: 'unknown', label: 'Availability unknown: review required' };
  }
  const contribution = totals.contribution_inr;
  if (contribution === null || totals.contribution_floor_inr === null) {
    return { tone: 'unknown', label: 'Unknown: review required' };
  }
  if (contribution < totals.contribution_floor_inr) {
    return { tone: 'danger', label: 'Over the limit: owner review' };
  }
  if (evaluation.offered_rooms < evaluation.requested_rooms) {
    return {
      tone: 'info',
      label: `Within the Reception limit: partial offer of ${counted(evaluation.offered_rooms, 'room')}`,
    };
  }
  return { tone: 'success', label: 'Within the Reception limit' };
}
