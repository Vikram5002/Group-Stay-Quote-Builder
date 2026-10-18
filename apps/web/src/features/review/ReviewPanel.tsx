import { useState } from 'react';
import { ApproveRequest, REASON_DESCRIPTIONS, RejectRequest, parseWith } from '@c32/core';
import type { Quote } from '@c32/core';
import { useApi } from '../../app/ApiProvider';
import { Alert, Badge, Button, Card, Dialog, ProblemAlert, TextAreaField } from '../../components';
import { ApiError } from '../../lib/api';
import { formatCountdown, formatInr, formatIst, formatStay } from '../../lib/format';
import { ROOM_TYPES } from '../quotes/form';
import { REASON_LABEL } from '../quotes/labels';
import { describePricing } from '../quotes/pricingText';
import { useNow, useQuoteAction } from '../quotes/queries';
import { ArithmeticTrail, TotalsTable } from '../quotes/ResultPanels';
import { StatusBadge } from '../quotes/StatusBadge';
import { TermsComparison } from './TermsComparison';
import { counted } from '../../lib/plural';

export type ReviewResult = { kind: 'approved' | 'rejected'; quote: Quote };

const REASON_HELP = 'Required. At least 5 characters. It is recorded in the audit trail.';
const REASON_ERROR = 'Enter at least 5 characters explaining why.';

type Decision = 'approve' | 'reject' | null;

/** One quote awaiting a decision: terms, reasons, and the approve and reject actions. */
export function ReviewPanel({
  quote,
  currentUserId,
  onDone,
}: {
  quote: Quote;
  currentUserId: string;
  onDone: (result: ReviewResult) => void;
}) {
  const api = useApi();
  const now = useNow();
  const id = quote.quote_id;
  const approve = useQuoteAction<{ reason: string }>(id, (input, o) =>
    api.approveQuote(id, input, o),
  );
  const reject = useQuoteAction<{ reason: string }>(id, (input, o) =>
    api.rejectQuote(id, input, o),
  );

  const [open, setOpen] = useState<Decision>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>();

  const isOwnQuote = quote.created_by.user_id === currentUserId;
  const { evaluation } = quote;
  const unknownContribution = evaluation.totals.contribution_inr === null;

  const failed = [approve, reject].find((m) => m.error instanceof ApiError);
  const error = failed?.error instanceof ApiError ? failed.error : null;

  function close() {
    setOpen(null);
    setReason('');
    setReasonError(undefined);
    approve.reset();
    reject.reset();
  }

  function submit() {
    const schema = open === 'approve' ? ApproveRequest : RejectRequest;
    const parsed = parseWith(schema, { reason: reason.trim() });
    if (!parsed.ok) {
      setReasonError(REASON_ERROR);
      return;
    }
    setReasonError(undefined);
    const mutation = open === 'approve' ? approve : reject;
    mutation.mutate(parsed.value, {
      onSuccess: (saved) => {
        close();
        onDone({ kind: open === 'approve' ? 'approved' : 'rejected', quote: saved });
      },
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-bold">{quote.request.organiser.name}</h2>
          <StatusBadge status={quote.status} />
        </div>
        <p className="mt-1 text-sm text-ink-muted">
          Requested by {quote.created_by.user_id} ({quote.created_by.role}) ·{' '}
          {formatStay(evaluation.check_in, evaluation.check_out)} ·{' '}
          {counted(
            evaluation.requested_rooms,
            `${ROOM_TYPES.find((t) => t.code === quote.request.room_type)?.label ?? quote.request.room_type} room`,
          )}{' '}
          ·{' '}
          {quote.valid_until && (
            <>
              hold {formatCountdown(quote.valid_until, now)} (
              <time dateTime={quote.valid_until} title={`UTC: ${quote.valid_until}`}>
                {formatIst(quote.valid_until)}
              </time>
              )
            </>
          )}
        </p>
        <p className="mt-1 text-sm font-semibold">
          {describePricing(quote.request, evaluation.totals).text}
          {evaluation.totals.shortfall_inr !== null && evaluation.totals.shortfall_inr > 0 && (
            <>, {formatInr(evaluation.totals.shortfall_inr)} below the floor</>
          )}
        </p>
      </div>

      {quote.request.note_for_owner && (
        <Card title={`Note from ${quote.created_by.user_id}`}>
          <p className="whitespace-pre-line text-sm">{quote.request.note_for_owner}</p>
        </Card>
      )}

      <Alert tone="warning" title="Why this needs a decision">
        <ul className="list-disc pl-5">
          {evaluation.reasons.map((r) => (
            <li key={r}>
              <strong>{REASON_LABEL[r]}.</strong> {REASON_DESCRIPTIONS[r]}
            </li>
          ))}
        </ul>
      </Alert>

      {unknownContribution && (
        <Alert tone="info" title="The contribution is unknown">
          Approving means accepting a margin nobody has verified. It is not treated as zero or as
          meeting the floor.
        </Alert>
      )}

      <TermsComparison quote={quote} />
      <TotalsTable totals={evaluation.totals} />
      <ArithmeticTrail trail={evaluation.trail} />

      {/* Kept in view while the terms above are read. */}
      <div className="sticky bottom-0 z-10 rounded-card shadow-card">
        <Card title="Your decision">
          {isOwnQuote && (
            <p id={`self-${id}`} className="mb-3 text-sm font-medium">
              <Badge tone="warning">Four-eyes rule</Badge> You created this quote, so someone else
              must approve it. You can still reject it.
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={isOwnQuote}
              {...(isOwnQuote ? { 'aria-describedby': `self-${id}` } : {})}
              onClick={() => setOpen('approve')}
            >
              Approve…
            </Button>
            <Button variant="danger" onClick={() => setOpen('reject')}>
              Reject…
            </Button>
          </div>
        </Card>
      </div>

      <Dialog
        open={open !== null}
        title={open === 'approve' ? 'Approve this quote' : 'Reject this quote'}
        onClose={close}
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Not now
            </Button>
            <Button
              variant={open === 'approve' ? 'primary' : 'danger'}
              loading={approve.isPending || reject.isPending}
              onClick={submit}
            >
              {open === 'approve' ? 'Approve quote' : 'Reject quote'}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm">
          {open === 'approve'
            ? 'Your approval covers exactly these rooms, dates and price. If any of them change, the quote must be approved again.'
            : 'The held rooms are released and the quote is closed.'}
        </p>
        {error && (
          <div className="mb-3">
            <ProblemAlert
              error={error}
              title={
                open === 'approve' ? 'Could not approve the quote' : 'Could not reject the quote'
              }
            />
          </div>
        )}
        <TextAreaField
          label="Reason"
          required
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setReasonError(undefined);
          }}
          hint={REASON_HELP}
          {...(reasonError ? { error: reasonError } : {})}
        />
      </Dialog>
    </div>
  );
}
