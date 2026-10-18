import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { PROPERTY_ROOM_TYPES } from '@c32/core';
import type { Quote } from '@c32/core';
import { Alert, Badge, Button, Card, EmptyState, Spinner, useToast } from '../../components';
import { ApiError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatCountdown, formatInr, formatIst, formatStay } from '../../lib/format';
import { counted } from '../../lib/plural';
import { useAuth } from '../auth/auth';
import { AuditTimeline } from './AuditTimeline';
import { OPEN_STATUSES } from './labels';
import { describePricing } from './pricingText';
import { QuoteActions, useRequote } from './QuoteActions';
import { useNow, useQuote, useQuoteAudit } from './queries';
import { shortReference } from './quotation';
import { ArithmeticTrail, DecisionSummary, TotalsTable } from './ResultPanels';
import { reviewBadge, reviewBanner, reviewState } from './reviewState';
import { StatusBadge } from './StatusBadge';

/** Where the quote was opened from, so "back" goes there (a filtered list, the review queue). */
export interface BackState {
  from: { to: string; label: string };
}

const HOUR_MS = 3_600_000;

type Urgency = 'calm' | 'soon' | 'urgent' | 'over';
function urgency(ms: number): Urgency {
  if (ms <= 0) return 'over';
  if (ms < HOUR_MS) return 'urgent';
  if (ms < 6 * HOUR_MS) return 'soon';
  return 'calm';
}
const URGENCY_TEXT: Record<Exclude<Urgency, 'calm'>, string> = {
  soon: 'Less than 6 hours left on this hold.',
  urgent: 'Less than an hour left on this hold.',
  over: 'The hold has ended. The status updates in a moment.',
};

/**
 * Time left on the hold. The figure is not a live region, so it does not interrupt every
 * half-minute; crossing 6 hours, 1 hour and the end is announced once each.
 */
function Countdown({ quote }: { quote: Quote }) {
  const now = useNow();
  const until = quote.valid_until;
  const ms = until === null ? 0 : Date.parse(until) - now.getTime();
  const level = urgency(ms);
  const seen = useRef(level);
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    if (seen.current === level) return;
    seen.current = level;
    if (level !== 'calm') setAnnouncement(URGENCY_TEXT[level]);
  }, [level]);

  if (!OPEN_STATUSES.includes(quote.status) || until === null) return null;
  return (
    <Card title="Hold countdown">
      <p
        className={cn(
          'text-2xl font-bold',
          level === 'urgent' || level === 'over'
            ? 'text-danger'
            : level === 'soon'
              ? 'text-warning'
              : undefined,
        )}
      >
        {formatCountdown(until, now)}
      </p>
      {level !== 'calm' && <p className="mt-1 text-sm font-semibold">{URGENCY_TEXT[level]}</p>}
      <p className="mt-1 text-sm text-ink-muted">
        Rooms are held until{' '}
        <time dateTime={until} title={`UTC: ${until}`}>
          {formatIst(until)}
        </time>
        . After that they are released automatically.
      </p>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </Card>
  );
}

function CopyId({ quote }: { quote: Quote }) {
  const notify = useToast();
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="font-mono" title={quote.quote_id}>
        {shortReference(quote)}
      </span>
      <Button
        variant="ghost"
        className="min-h-0 px-2 py-1 text-xs"
        title="Copy the full quote id"
        onClick={() => {
          void navigator.clipboard
            ?.writeText(quote.quote_id)
            .then(() => notify('Quote id copied.'))
            .catch(() => notify('Copying is blocked in this browser.', 'warning'));
        }}
      >
        Copy id
      </Button>
    </span>
  );
}

function Summary({ quote, showVersion }: { quote: Quote; showVersion: boolean }) {
  const { request, evaluation } = quote;
  const o = request.organiser;
  const roomType =
    PROPERTY_ROOM_TYPES.find((t) => t.code === request.room_type)?.label ?? request.room_type;
  return (
    <Card title="Request">
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-ink-muted">Organiser</dt>
        <dd>
          {o.name}
          {o.reference && <span className="block text-ink-muted">Ref {o.reference}</span>}
        </dd>
        {(o.contact_name || o.email || o.phone) && (
          <>
            <dt className="text-ink-muted">Contact</dt>
            <dd className="break-words">
              {o.contact_name && <span className="block">{o.contact_name}</span>}
              {o.email && (
                <a className="block text-brand underline" href={`mailto:${o.email}`}>
                  {o.email}
                </a>
              )}
              {o.phone && (
                <a
                  className="block text-brand underline"
                  href={`tel:${o.phone.replace(/[^+0-9]/g, '')}`}
                >
                  {o.phone}
                </a>
              )}
            </dd>
          </>
        )}
        <dt className="text-ink-muted">Stay</dt>
        <dd>
          {formatStay(evaluation.check_in, evaluation.check_out)}
          <span className="block text-ink-muted">{counted(evaluation.nights, 'night')}</span>
        </dd>
        <dt className="text-ink-muted">Rooms</dt>
        <dd>
          {counted(evaluation.offered_rooms, `${roomType} room`)}
          {evaluation.offered_rooms !== evaluation.requested_rooms && (
            <span className="block text-ink-muted">
              {evaluation.requested_rooms} were asked for
            </span>
          )}
        </dd>
        <dt className="text-ink-muted">Price</dt>
        {/* Full price less the discount, so the organiser sees what they were given. */}
        <dd>{describePricing(request, evaluation.totals).text}</dd>
        {request.inclusions && request.inclusions.length > 0 && (
          <>
            <dt className="text-ink-muted">Inclusions</dt>
            <dd>
              <ul>
                {request.inclusions.map((i) => (
                  <li key={i.name}>
                    {i.name}
                    <span className="text-ink-muted">
                      {' '}
                      (
                      {i.included_in_rate
                        ? 'in the rate'
                        : `${formatInr(i.price_inr ?? 0)} ${i.basis === 'per_room_night' ? 'per room-night' : 'per guest-night'}`}
                      )
                    </span>
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
        {request.note_for_owner && (
          <>
            <dt className="text-ink-muted">Note for the Owner</dt>
            <dd className="whitespace-pre-line">{request.note_for_owner}</dd>
          </>
        )}
        <dt className="text-ink-muted">Quote ref</dt>
        <dd>
          <CopyId quote={quote} />
        </dd>
        {showVersion && (
          <>
            <dt className="text-ink-muted">Version</dt>
            <dd>{quote.version}</dd>
          </>
        )}
        <dt className="text-ink-muted">Created by</dt>
        <dd>
          {quote.created_by.user_id} ({quote.created_by.role})
          <span className="block text-ink-muted">{formatIst(quote.created_at)}</span>
        </dd>
      </dl>
    </Card>
  );
}

function Detail({ quote: q }: { quote: Quote }) {
  const { session } = useAuth();
  const location = useLocation();
  const audit = useQuoteAudit(q.quote_id);
  const requote = useRequote(q);
  const role = session?.user.role;
  const canWrite = role === 'Sales' || role === 'Owner';
  const back = (location.state as BackState | null)?.from ?? { to: '/quotes', label: 'All quotes' };

  const review = reviewState(q);
  const badge = reviewBadge(review);
  const partial = q.evaluation.offered_rooms > 0 && q.evaluation.shortfall_rooms > 0;
  return (
    <div className="mx-auto max-w-5xl">
      <p className="text-sm">
        <Link to={back.to} className="text-brand underline">
          <span aria-hidden="true">← </span>
          {back.label}
        </Link>
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{q.request.organiser.name}</h1>
        <StatusBadge status={q.status} />
        {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
        {partial && <Badge tone="info">Partial offer</Badge>}
      </div>

      {q.status === 'EXPIRED' && (
        <div className="mt-4">
          <Alert
            tone="warning"
            title="This quote expired"
            action={
              canWrite ? (
                <Button variant="secondary" onClick={() => requote.start()}>
                  Re-quote with these details
                </Button>
              ) : undefined
            }
          >
            The validity window passed and the rooms were released.
            {canWrite && ' Re-quote to check availability and hold them again.'}
          </Alert>
        </div>
      )}

      {/* On a phone the request comes first; on a wide screen it sits beside the result. */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_22rem] lg:grid-rows-[auto_1fr]">
        <div className="lg:col-start-2 lg:row-start-1">
          <Summary quote={q} showVersion={role === 'Owner'} />
        </div>
        <div className="flex flex-col gap-6 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <Countdown quote={q} />
          {session && <QuoteActions quote={q} role={session.user.role} onRequote={requote.start} />}
          <DecisionSummary
            evaluation={
              // Alternatives only help while the quote waits for a decision.
              q.status === 'PENDING_REVIEW' ? q.evaluation : { ...q.evaluation, counter_offers: [] }
            }
            review={reviewBanner(q, review)}
            reviewAction={
              role === 'Owner' && q.status === 'PENDING_REVIEW' ? (
                <Link
                  to={`/review?quote=${q.quote_id}`}
                  className="font-semibold text-brand underline"
                >
                  Review this quote
                </Link>
              ) : undefined
            }
            {...(canWrite
              ? {
                  onUseRate: (rate: number) =>
                    requote.start(
                      { rate: String(rate), discount: '0', discountKind: 'pct' },
                      `at ${formatInr(rate)}`,
                    ),
                  useRateLabel: (rate: number) => `Re-quote at ${formatInr(rate)}`,
                }
              : {})}
          />
          <TotalsTable totals={q.evaluation.totals} />
          <ArithmeticTrail trail={q.evaluation.trail} />
        </div>
        <div className="self-start lg:col-start-2 lg:row-start-2">
          {audit.isError ? (
            <Alert tone="warning" title="The audit timeline could not be loaded">
              The quote is shown without it.
            </Alert>
          ) : (
            <AuditTimeline events={audit.data?.items ?? []} />
          )}
        </div>
      </div>
      {requote.dialog}
    </div>
  );
}

export function QuoteDetailPage() {
  const { quoteId = '' } = useParams();
  const quote = useQuote(quoteId);

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
                <Link to="/quotes" className="font-semibold text-brand underline">
                  Back to all quotes
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

  return <Detail quote={quote.data} />;
}
