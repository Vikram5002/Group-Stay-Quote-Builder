import { Link } from 'react-router-dom';
import { QUOTE_STATUSES } from '@c32/core';
import type { Quote, QuoteStatus } from '@c32/core';
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Money,
  Spinner,
} from '../../components';
import { ApiError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatCountdown, formatDateShort, formatIst } from '../../lib/format';
import { counted, plural } from '../../lib/plural';
import { useAuth } from '../auth/auth';
import { OPEN_STATUSES, STATUS_LABEL } from '../quotes/labels';
import { useNow, useQuoteList } from '../quotes/queries';
import { clientTotal } from '../quotes/pricingText';
import type { BackState } from '../quotes/QuoteDetailPage';
import { StatusBadge } from '../quotes/StatusBadge';

const BACK: BackState = { from: { to: '/', label: 'Dashboard' } };

const SOON_HOURS = 24;
const HOUR_MS = 3_600_000;

/** The pipeline in the order work moves: still open, booked, then closed one way or another. */
const PIPELINE: ReadonlyArray<{ title: string; statuses: readonly QuoteStatus[] }> = [
  { title: 'Open', statuses: ['OFFERED', 'PENDING_REVIEW'] },
  { title: 'Booked', statuses: ['CONFIRMED'] },
  { title: 'Closed', statuses: ['DECLINED', 'REJECTED', 'EXPIRED', 'CANCELLED'] },
];

/** Amber under 6 hours, red under 1, so the most urgent holds stand out. */
function holdTone(validUntil: string, now: Date): string | undefined {
  const ms = Date.parse(validUntil) - now.getTime();
  if (ms < HOUR_MS) return 'font-semibold text-danger';
  if (ms < 6 * HOUR_MS) return 'font-semibold text-warning';
  return undefined;
}

interface NextStep {
  to: string;
  text: string;
}

/** What needs this person now, by role: reviews for an Owner, their own open quotes, ending holds. */
function nextSteps(
  quotes: readonly Quote[],
  userId: string,
  role: string,
  soon: number,
): NextStep[] {
  const steps: NextStep[] = [];
  if (role === 'Owner') {
    // An Owner cannot approve a quote they created (four-eyes), so those are not counted.
    const reviews = quotes.filter(
      (q) => q.status === 'PENDING_REVIEW' && q.created_by.user_id !== userId,
    ).length;
    if (reviews > 0) {
      steps.push({
        to: '/review',
        text: `${counted(reviews, 'quote')} ${plural(reviews, 'is', 'are')} waiting for your review`,
      });
    }
  }
  if (role === 'Sales' || role === 'Owner') {
    const mine = quotes.filter((q) => q.created_by.user_id === userId);
    const offered = mine.filter((q) => q.status === 'OFFERED').length;
    if (offered > 0) {
      steps.push({
        to: '/quotes?status=OFFERED&mine=1',
        text: `${offered} of your quotes ${plural(offered, 'is', 'are')} offered and waiting for the client to accept`,
      });
    }
    const pending = mine.filter((q) => q.status === 'PENDING_REVIEW').length;
    if (pending > 0) {
      steps.push({
        to: '/quotes?status=PENDING_REVIEW&mine=1',
        text: `${pending} of your quotes ${plural(pending, 'is', 'are')} waiting for an Owner`,
      });
    }
  }
  if (soon > 0) {
    steps.push({
      to: '/quotes?status=OPEN&sort=expiry',
      text: `${counted(soon, 'hold')} ${plural(soon, 'ends', 'end')} within ${SOON_HOURS} hours`,
    });
  }
  return steps;
}

function expiringSoon(quotes: readonly Quote[], now: Date): Quote[] {
  const limit = now.getTime() + SOON_HOURS * 3_600_000;
  return quotes
    .filter((q) => OPEN_STATUSES.includes(q.status) && q.valid_until !== null)
    .filter((q) => new Date(q.valid_until as string).getTime() <= limit)
    .sort((a, b) => (a.valid_until as string).localeCompare(b.valid_until as string));
}

/**
 * Contribution still waiting on a decision: open quotes (offered or pending review). Quotes whose
 * contribution is unknown are counted separately and never added in as zero.
 */
function contributionAtRisk(quotes: readonly Quote[]) {
  const open = quotes.filter((q) => OPEN_STATUSES.includes(q.status));
  let total = 0;
  let unknown = 0;
  for (const q of open) {
    const value = q.evaluation.totals.contribution_inr;
    if (value === null) unknown += 1;
    else total += value;
  }
  return { total, unknown, openCount: open.length };
}

/** Contribution already booked: confirmed quotes, with unknowns counted apart. */
function bookedContribution(quotes: readonly Quote[]) {
  let total = 0;
  let unknown = 0;
  const booked = quotes.filter((q) => q.status === 'CONFIRMED');
  for (const q of booked) {
    const value = q.evaluation.totals.contribution_inr;
    if (value === null) unknown += 1;
    else total += value;
  }
  return { total, unknown, count: booked.length };
}

export function DashboardPage() {
  const { session } = useAuth();
  const list = useQuoteList();
  const now = useNow();
  const canCreate = session?.user.role !== 'Viewer';

  const heading = <h1 className="text-2xl font-bold">Dashboard</h1>;

  if (list.isPending) {
    return (
      <div className="mx-auto max-w-5xl">
        {heading}
        <p className="mt-6 flex items-center gap-2" role="status">
          <Spinner /> Loading quotes…
        </p>
      </div>
    );
  }

  if (list.isError) {
    const error = list.error instanceof ApiError ? list.error : null;
    return (
      <div className="mx-auto max-w-5xl">
        {heading}
        <div className="mt-6">
          <Alert
            tone="danger"
            title={error?.friendly.title ?? 'Could not load quotes'}
            action={
              <Button variant="secondary" onClick={() => void list.refetch()}>
                Try again
              </Button>
            }
          >
            {error
              ? `${error.friendly.message} ${error.friendly.nextStep}`
              : 'Try again in a moment.'}
          </Alert>
        </div>
      </div>
    );
  }

  const quotes = list.data.items;
  if (quotes.length === 0) {
    return (
      <div className="mx-auto max-w-5xl">
        {heading}
        <div className="mt-6">
          <EmptyState
            title="No quotes yet"
            action={
              canCreate ? (
                <Link
                  to="/quotes/new"
                  className="inline-flex min-h-11 items-center rounded-control bg-brand px-4 text-sm font-semibold text-on-brand"
                >
                  Create the first quote
                </Link>
              ) : undefined
            }
          >
            Quotes appear here with their status and expiry once someone issues one.
          </EmptyState>
        </div>
      </div>
    );
  }

  const counts = Object.fromEntries(QUOTE_STATUSES.map((s) => [s, 0])) as Record<
    (typeof QUOTE_STATUSES)[number],
    number
  >;
  for (const q of quotes) counts[q.status] += 1;

  const soon = expiringSoon(quotes, now);
  const risk = contributionAtRisk(quotes);
  const booked = bookedContribution(quotes);
  const steps = session
    ? nextSteps(quotes, session.user.user_id, session.user.role, soon.length)
    : [];

  return (
    <div className="mx-auto max-w-5xl">
      {heading}
      <p className="mt-1 text-ink-muted">
        {counted(quotes.length, 'quote')}
        {list.data.next_cursor ? ' (showing the latest 100)' : ''}
      </p>

      <section aria-labelledby="next" className="mt-6">
        <h2 id="next" className="mb-3 text-lg font-semibold">
          Needs you now
        </h2>
        {steps.length === 0 ? (
          <p className="rounded-card border border-border bg-surface p-4 text-sm text-ink-muted">
            Nothing needs you right now.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {steps.map((step) => (
              <li key={step.to}>
                <Link
                  to={step.to}
                  className="flex min-h-11 items-center justify-between gap-3 rounded-card border border-border bg-surface px-4 py-2 text-sm font-semibold text-brand hover:border-brand"
                >
                  {step.text}
                  <span aria-hidden="true">→</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="pipeline" className="mt-6">
        <h2 id="pipeline" className="mb-3 text-lg font-semibold">
          Pipeline by status
        </h2>
        <div className="grid gap-4 md:grid-cols-[2fr_1fr] lg:grid-cols-[2fr_1fr_4fr]">
          {PIPELINE.map((group) => (
            <div key={group.title}>
              <h3 className="mb-2 text-sm font-semibold text-ink-muted">{group.title}</h3>
              <ul
                className={cn(
                  'grid gap-3',
                  group.statuses.length === 1
                    ? 'grid-cols-1'
                    : group.statuses.length === 2
                      ? 'grid-cols-2'
                      : 'grid-cols-2 sm:grid-cols-4',
                )}
              >
                {group.statuses.map((status) => (
                  <li key={status}>
                    {/* Each count opens the quotes with that status. */}
                    <Link
                      to={`/quotes?status=${status}`}
                      className="block h-full rounded-card border border-border bg-surface p-4 shadow-card hover:border-brand"
                    >
                      <span className="block text-3xl font-bold tabular-nums">
                        {counts[status]}
                      </span>
                      <span className="mt-1 block">
                        <StatusBadge status={status} />
                      </span>
                      <span className="sr-only">{STATUS_LABEL[status]} quotes</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Card title="Contribution at risk">
          <p className="text-3xl font-bold tabular-nums">
            <Money value={risk.total} />
          </p>
          <p className="mt-2 text-sm text-ink-muted">
            Contribution on {counted(risk.openCount, 'open quote')} that{' '}
            {plural(risk.openCount, 'is', 'are')} offered or pending review. It is lost if{' '}
            {plural(risk.openCount, 'it expires', 'they expire')}.
          </p>
          {risk.unknown > 0 && (
            <p className="mt-2 text-sm">
              {counted(risk.unknown, 'open quote')} {plural(risk.unknown, 'has', 'have')} an unknown
              contribution and {plural(risk.unknown, 'is', 'are')} not included in this total.
            </p>
          )}
          <p className="mt-3 border-t border-border pt-3 text-sm">
            Booked: <Money value={booked.total} /> on {counted(booked.count, 'confirmed quote')}
            {booked.unknown > 0 && `, plus ${booked.unknown} with an unknown contribution`}.
          </p>
        </Card>

        <Card title={`Holds expiring in ${SOON_HOURS} hours`}>
          {soon.length === 0 ? (
            <p className="text-sm text-ink-muted">
              No holds expire in the next {SOON_HOURS} hours.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {soon.map((q) => (
                <li
                  key={q.quote_id}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm"
                >
                  <Link
                    to={`/quotes/${q.quote_id}`}
                    state={BACK}
                    className="font-semibold text-brand underline"
                  >
                    {q.request.organiser.name}
                  </Link>
                  <span
                    title={`UTC: ${q.valid_until}`}
                    className={holdTone(q.valid_until as string, now)}
                  >
                    {Date.parse(q.valid_until as string) - now.getTime() < HOUR_MS && (
                      <Badge tone="danger">Under 1 hour</Badge>
                    )}{' '}
                    {formatCountdown(q.valid_until as string, now)} · {formatIst(q.valid_until)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <section aria-labelledby="recent" className="mt-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="recent" className="text-lg font-semibold">
            Recent quotes
          </h2>
          <Link to="/quotes" className="mr-auto ml-3 text-sm font-semibold text-brand underline">
            View all quotes
          </Link>
          {canCreate && (
            <Link
              to="/quotes/new"
              className="inline-flex min-h-11 items-center rounded-control bg-brand px-4 text-sm font-semibold text-on-brand"
            >
              New quote
            </Link>
          )}
        </div>
        <DataTable
          caption="Most recent quotes"
          rows={quotes.slice(0, 8)}
          rowKey={(q) => q.quote_id}
          columns={[
            {
              header: 'Organiser',
              render: (q) => (
                <Link
                  to={`/quotes/${q.quote_id}`}
                  state={BACK}
                  className="font-semibold text-brand underline"
                >
                  {q.request.organiser.name}
                </Link>
              ),
            },
            { header: 'Status', render: (q) => <StatusBadge status={q.status} /> },
            {
              header: 'Stay',
              render: (q) =>
                `${formatDateShort(q.evaluation.check_in)} to ${formatDateShort(q.evaluation.check_out)}`,
            },
            { header: 'Rooms', numeric: true, render: (q) => q.evaluation.offered_rooms },
            {
              header: 'Total',
              numeric: true,
              render: (q) => <Money value={clientTotal(q.evaluation.totals)} />,
            },
            {
              header: 'Contribution',
              numeric: true,
              render: (q) => <Money value={q.evaluation.totals.contribution_inr} />,
            },
            {
              header: 'Hold',
              render: (q) =>
                OPEN_STATUSES.includes(q.status) && q.valid_until ? (
                  <span className={holdTone(q.valid_until, now)}>
                    {formatCountdown(q.valid_until, now)}
                  </span>
                ) : (
                  <span className="text-ink-muted">None</span>
                ),
            },
          ]}
        />
      </section>
    </div>
  );
}
