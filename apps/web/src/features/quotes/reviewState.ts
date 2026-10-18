import type { Approval, Quote } from '@c32/core';
import type { Tone } from '../../components';
import { formatIst } from '../../lib/format';

/**
 * Where a saved quote stands on Owner review, from its current status, approval and
 * review_required flag. The evaluation's decision only says what the engine found when the quote
 * was issued, so it cannot say whether review is still needed.
 */
export type ReviewState =
  /** The engine found nothing that needs an Owner. */
  | { kind: 'none' }
  /** Waiting for an Owner (PENDING_REVIEW). */
  | { kind: 'pending' }
  /** Approved, and the approval still matches the terms (BR-11). */
  | { kind: 'approved'; approval: Approval }
  /** Approved for terms that have since changed, so the approval no longer applies. */
  | { kind: 'outdated'; approval: Approval }
  /** A confirmed booking was amended below the floor (BR-16). */
  | { kind: 'amended' }
  | { kind: 'rejected' }
  /** Needed review, but was cancelled or expired before anyone decided. */
  | { kind: 'closed' };

export function reviewState(quote: Quote): ReviewState {
  if (quote.review_required) return { kind: 'amended' };
  if (quote.status === 'PENDING_REVIEW') return { kind: 'pending' };
  if (quote.approval) {
    return quote.approval.terms_hash === quote.terms_hash
      ? { kind: 'approved', approval: quote.approval }
      : { kind: 'outdated', approval: quote.approval };
  }
  if (quote.status === 'REJECTED') return { kind: 'rejected' };
  if (quote.evaluation.decision === 'REVIEW') return { kind: 'closed' };
  return { kind: 'none' };
}

/** Header badge for the review state, or null when the status badge already says it all. */
export function reviewBadge(state: ReviewState): { tone: Tone; label: string } | null {
  switch (state.kind) {
    case 'pending':
      return { tone: 'warning', label: 'Needs review' };
    case 'approved':
      return { tone: 'success', label: 'Approved' };
    case 'outdated':
      return { tone: 'warning', label: 'Approval out of date' };
    case 'amended':
      return { tone: 'warning', label: 'Review required after amendment' };
    default:
      return null;
  }
}

export interface ReviewBanner {
  tone: 'success' | 'info' | 'warning' | 'danger';
  title: string;
  /** A line under the reasons: the approval in words, or who must approve. */
  note?: string;
}

/** Banner for a quote that needed review, in place of the evaluation's own title. */
export function reviewBanner(quote: Quote, state = reviewState(quote)): ReviewBanner | null {
  switch (state.kind) {
    case 'pending':
      return {
        tone: 'warning',
        title: 'Owner review required',
        note: 'An Owner who did not create this quote must approve it before it can be confirmed.',
      };
    case 'approved':
      return {
        tone: 'success',
        title: quote.evaluation.reasons.includes('FLOOR_BREACH')
          ? 'Approved below the floor'
          : 'Approved by an Owner',
        note: approvalLine(state.approval),
      };
    case 'outdated':
      return {
        tone: 'warning',
        title: 'The terms changed after approval',
        note: `${approvalLine(state.approval)}. That approval no longer applies to these terms.`,
      };
    case 'amended':
      return {
        tone: 'warning',
        title: 'Review required after amendment',
        ...(quote.approval
          ? { note: `${approvalLine(quote.approval)} (before the amendment).` }
          : {}),
      };
    case 'rejected':
      return { tone: 'danger', title: 'Rejected by an Owner' };
    case 'closed':
      return { tone: 'info', title: 'Closed before an Owner decided' };
    default:
      return null;
  }
}

/** "Approved by meera on 20 Oct 2026, 11:30 IST: Repeat client" */
export function approvalLine(approval: Approval): string {
  return `Approved by ${approval.approved_by.user_id} on ${formatIst(approval.approved_at)}: ${approval.reason}`;
}
