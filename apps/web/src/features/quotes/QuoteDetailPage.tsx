import { Link, useParams } from 'react-router-dom';
import type { Quote } from '@c32/core';
import { Alert, Badge, Button, Card, EmptyState, Money, Spinner } from '../../components';
import { ApiError } from '../../lib/api';
import { formatCountdown, formatIst } from '../../lib/format';
import { useAuth } from '../auth/auth';
import { AuditTimeline } from './AuditTimeline';
import { DECISION_LABEL, OPEN_STATUSES } from './labels';
import { QuoteActions } from './QuoteActions';
import { useNow, useQuote, useQuoteAudit } from './queries';
import { ArithmeticTrail, DecisionSummary, TotalsTable } from './ResultPanels';
import { StatusBadge } from './StatusBadge';

function Countdown({ quote }: { quote: Quote }) {
  const now = useNow();
  if (!OPEN_STATUSES.includes(quote.status) || quote.valid_until === null) return null;
  const left = formatCountdown(quote.valid_until, now);
  return (
    <Card title="Hold countdown">
      <p className="text-2xl font-bold" aria-live="polite">
        {left}
      </p>
      <p className="mt-1 text-sm text-ink-muted">
        Rooms are held until{' '}
        <time dateTime={quote.valid_until} title={`UTC: ${quote.valid_until}`}>
          {formatIst(quote.valid_until)}
        </time>
        . After that they are released automatically.
      </p>
    </Card>
  );
}

function Summary({ quote }: { quote: Quote }) {
  const { request, evaluation } = quote;
  const rate = request.rate_per_room_night_inr;
  return (
    <Card title="Request">
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-ink-muted">Organiser</dt>
        <dd>
          {request.organiser.name}
          {request.organiser.reference ? ` (${request.organiser.reference})` : ''}
        </dd>
        <dt className="text-ink-muted">Stay</dt>
        <dd>
          {evaluation.check_in} to {evaluation.check_out} ({evaluation.nights} nights)
        </dd>
        <dt className="text-ink-muted">Room type</dt>
        <dd className="capitalize">{request.room_type}</dd>
        <dt className="text-ink-muted">Rooms</dt>
        <dd>
          {evaluation.offered_rooms} offered of {evaluation.requested_rooms} requested
        </dd>
        <dt className="text-ink-muted">Rate per room-night</dt>
        <dd>
          {rate !== undefined ? (
            <Money value={rate} />
          ) : request.discount_pct !== undefined ? (
            // Full price less the discount, so the organiser sees what they were given.
            <>
              <Money value={evaluation.totals.floor_rate_per_room_night_inr} /> full price, less{' '}
              {request.discount_pct}% ={' '}
              <Money
                value={Math.ceil(
                  (evaluation.totals.floor_rate_per_room_night_inr * (100 - request.discount_pct)) /
                    100,
                )}
              />
            </>
          ) : (
            'From the rate plan'
          )}
        </dd>
        {request.inclusions && request.inclusions.length > 0 && (
          <>
            <dt className="text-ink-muted">Inclusions</dt>
            <dd>{request.inclusions.map((i) => i.name).join(', ')}</dd>
          </>
        )}
        <dt className="text-ink-muted">Quote id</dt>
        <dd className="font-mono text-xs">{quote.quote_id}</dd>
        <dt className="text-ink-muted">Version</dt>
        <dd>{quote.version}</dd>
        <dt className="text-ink-muted">Created by</dt>
        <dd>
          {quote.created_by.user_id} ({quote.created_by.role}), {formatIst(quote.created_at)}
        </dd>
      </dl>
    </Card>
  );
}

export function QuoteDetailPage() {
  const { quoteId = '' } = useParams();
  const { session } = useAuth();
  const quote = useQuote(quoteId);
  const audit = useQuoteAudit(quoteId);

  if (quote.isPending) {
    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-bold">Quote</h1>
        <p className="mt-6 flex items-center gap-2" role="status">
          <Spinner /> Loading the quote…
        </p>
      </div>
    );
  }

  if (quote.isError) {
    const error = quote.error instanceof ApiError ? quote.error : null;
    const notFound = error?.code === 'NOT_FOUND';
    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-bold">{notFound ? 'Quote not found' : 'Quote'}</h1>
        <div className="mt-6">
          {notFound ? (
            <EmptyState
              title="We could not find that quote"
              action={
                <Link to="/" className="font-semibold text-brand underline">
                  Back to the dashboard
                </Link>
              }
            >
              It may have been removed, or the link is wrong.
            </EmptyState>
          ) : (
            <Alert
              tone="danger"
              title={error?.friendly.title ?? 'Could not load the quote'}
              action={
                <Button variant="secondary" onClick={() => void quote.refetch()}>
                  Try again
                </Button>
              }
            >
              {error
                ? `${error.friendly.message} ${error.friendly.nextStep}`
                : 'Try again in a moment.'}
            </Alert>
          )}
        </div>
      </div>
    );
  }

  const q = quote.data;
  return (
    <div className="mx-auto max-w-5xl">
      <p className="text-sm">
        <Link to="/" className="text-brand underline">
          Dashboard
        </Link>
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{q.request.organiser.name}</h1>
        <StatusBadge status={q.status} />
        <Badge tone="neutral">{DECISION_LABEL[q.evaluation.decision]}</Badge>
        {q.review_required && <Badge tone="warning">Review required after amendment</Badge>}
      </div>

      {q.status === 'EXPIRED' && (
        <div className="mt-4">
          <Alert
            tone="warning"
            title="This quote expired"
            action={
              <Link to="/quotes/new" className="font-semibold text-brand underline">
                Start a new quote
              </Link>
            }
          >
            The validity window passed and the rooms were released.
          </Alert>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="flex flex-col gap-6">
          <Countdown quote={q} />
          {session && <QuoteActions quote={q} role={session.user.role} />}
          <DecisionSummary evaluation={q.evaluation} />
          <TotalsTable totals={q.evaluation.totals} />
          <ArithmeticTrail trail={q.evaluation.trail} />
        </div>
        <div className="flex flex-col gap-6">
          <Summary quote={q} />
          {q.approval && (
            <Card title="Approval">
              <p className="text-sm">
                Approved by {q.approval.approved_by.user_id} on{' '}
                <time dateTime={q.approval.approved_at}>{formatIst(q.approval.approved_at)}</time>.
              </p>
              <p className="mt-1 text-sm">Reason: {q.approval.reason}</p>
            </Card>
          )}
          {audit.isError ? (
            <Alert tone="warning" title="The audit timeline could not be loaded">
              The quote is shown without it.
            </Alert>
          ) : (
            <AuditTimeline events={audit.data?.items ?? []} />
          )}
        </div>
      </div>
    </div>
  );
}
