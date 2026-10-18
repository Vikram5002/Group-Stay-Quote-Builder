import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { QUOTE_STATUSES } from '@c32/core';
import type { Quote, QuoteStatus } from '@c32/core';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  EmptyState,
  HotelScene,
  Icon,
  Money,
  Spinner,
} from '../../components';
import type { IconName } from '../../components';
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
import { BUILDERS, can } from '../../lib/roles';

const BACK: BackState = { from: { to: '/', label: 'Dashboard' } };

const SOON_HOURS = 24;
const HOUR_MS = 3_600_000;

/** The pipeline in the order work moves: still open, booked, then closed one way or another. */
const PIPELINE: ReadonlyArray<{ title: string; statuses: readonly QuoteStatus[] }> = [
  { title: 'Open', statuses: ['OFFERED', 'PENDING_REVIEW'] },
  { title: 'Booked', statuses: ['CONFIRMED'] },
  { title: 'Closed', statuses: ['DECLINED', 'REJECTED', 'EXPIRED', 'CANCELLED'] },
];

/** Segment colours for the pipeline bar. The bar is decoration: the tiles below carry the counts. */
const STATUS_FILL: Record<QuoteStatus, string> = {
  OFFERED: 'bg-[#3b82f6]',
  PENDING_REVIEW: 'bg-[#f59e0b]',
  CONFIRMED: 'bg-[#10b981]',
  DECLINED: 'bg-[#fb7185]',
  REJECTED: 'bg-[#e11d48]',
  EXPIRED: 'bg-[#94a3b8]',
  CANCELLED: 'bg-[#cbd5e1]',
};

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
  icon: IconName;
  tone: 'brand' | 'info' | 'warning' | 'danger';
}

/** What needs this person now, by role: reviews for a Service Manager, their own open quotes, ending holds. */
function nextSteps(
  quotes: readonly Quote[],
  userId: string,
  role: string,
  soon: number,
): NextStep[] {
  const steps: NextStep[] = [];
  if (role === 'Owner') {
    const sent = quotes.filter((q) => q.status === 'PENDING_REVIEW' && q.awaiting_owner).length;
    if (sent > 0) {
      steps.push({
        to: '/review',
        text: `${counted(sent, 'quote')} ${plural(sent, 'is', 'are')} waiting for your discount`,
        icon: 'review',
        tone: 'brand',
      });
    }
  }
  if (role === 'ServiceManager') {
    // A Service Manager cannot approve a quote they created (four-eyes), so those are not counted.
    const reviews = quotes.filter(
      (q) => q.status === 'PENDING_REVIEW' && !q.awaiting_owner && q.created_by.user_id !== userId,
    ).length;
    if (reviews > 0) {
      steps.push({
        to: '/review',
        text: `${counted(reviews, 'quote')} ${plural(reviews, 'is', 'are')} waiting for your review`,
        icon: 'review',
        tone: 'brand',
      });
    }
  }
  if (role === 'Reception' || role === 'ServiceManager') {
    const mine = quotes.filter((q) => q.created_by.user_id === userId);
    const offered = mine.filter((q) => q.status === 'OFFERED').length;
    if (offered > 0) {
      steps.push({
        to: '/quotes?status=OFFERED&mine=1',
        text: `${offered} of your quotes ${plural(offered, 'is', 'are')} offered and waiting for the client to accept`,
        icon: 'quotes',
        tone: 'info',
      });
    }
    const pending = mine.filter((q) => q.status === 'PENDING_REVIEW').length;
    if (pending > 0) {
      steps.push({
        to: '/quotes?status=PENDING_REVIEW&mine=1',
        text: `${pending} of your quotes ${plural(pending, 'is', 'are')} waiting for a Service Manager`,
        icon: 'clock',
        tone: 'warning',
      });
    }
  }
  if (soon > 0) {
    steps.push({
      to: '/quotes?status=OPEN&sort=expiry',
      text: `${counted(soon, 'hold')} ${plural(soon, 'ends', 'end')} within ${SOON_HOURS} hours`,
      icon: 'alert',
      tone: 'danger',
    });
  }
  return steps;
}

const STEP_TONE: Record<NextStep['tone'], string> = {
  brand: 'bg-ink text-white',
  info: 'bg-info-soft text-info',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
};

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

/** "Good morning" and so on, by the hour in India. */
function greeting(now: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-IN', {
      hour: 'numeric',
      hourCycle: 'h23',
      timeZone: 'Asia/Kolkata',
    }).format(now),
  );
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** A headline number with its icon and a short explanation. */
function StatCard({
  title,
  icon,
  value,
  children,
  featured = false,
  className,
}: {
  title: string;
  icon: IconName;
  value: ReactNode;
  children?: ReactNode;
  featured?: boolean;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-card border p-6',
        featured
          ? 'border-transparent bg-ink text-white shadow-raised'
          : 'border-border bg-surface shadow-card',
        className,
      )}
    >
      {featured && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-16 -right-10 size-48 rounded-full bg-white/10 blur-2xl"
        />
      )}
      <div className="relative flex items-center justify-between gap-3">
        <h2 className={cn('text-sm font-semibold', featured ? 'text-white' : 'text-ink-muted')}>
          {title}
        </h2>
        <span
          aria-hidden="true"
          className={cn(
            'grid size-9 place-items-center rounded-xl',
            featured ? 'bg-white/15 text-white' : 'bg-surface-muted text-ink',
          )}
        >
          <Icon name={icon} className="size-[1.1rem]" />
        </span>
      </div>
      <p className="relative mt-3 text-3xl font-bold tracking-tight tabular-nums">{value}</p>
      {children && (
        <div className={cn('relative mt-2 text-sm', featured ? 'text-white/90' : 'text-ink-muted')}>
          {children}
        </div>
      )}
    </section>
  );
}

/** A white panel with a heading, for the lists below the headline numbers. */
function Panel({
  title,
  id,
  icon,
  action,
  children,
  className,
}: {
  title: string;
  id: string;
  icon: IconName;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn('rounded-card border border-border bg-surface p-6 shadow-card', className)}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id={id} className="flex items-center gap-2.5 text-base font-semibold">
          <span
            aria-hidden="true"
            className="grid size-8 place-items-center rounded-lg bg-surface-muted text-ink-muted"
          >
            <Icon name={icon} className="size-4" />
          </span>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function DashboardPage() {
  const { session } = useAuth();
  const list = useQuoteList();
  const now = useNow();
  const canCreate = can(BUILDERS, session?.user.role);

  const hero = (summary?: ReactNode, action?: ReactNode) => (
    <div className="relative isolate overflow-hidden rounded-[2rem] border border-border bg-surface-muted px-6 py-7 shadow-card md:px-10 md:py-9">
      {/* A soft colour wash behind the greeting. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[radial-gradient(45%_80%_at_85%_100%,rgb(255_207_77/0.22),transparent_65%)]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 [background-image:radial-gradient(rgb(14_14_14/0.10)_1px,transparent_1px)] [background-size:18px_18px] [mask-image:linear-gradient(to_left,black,transparent_65%)]"
      />
      <div className="flex items-end justify-between gap-6">
        <div className="min-w-0 pb-1">
          <p className="inline-flex items-center gap-2 rounded-full border border-ink/20 bg-surface px-3 py-1 text-xs font-semibold text-ink">
            <Icon name="bed" className="size-3.5" />
            Group stays
          </p>
          <h1 className="mt-4 text-4xl md:text-5xl">Dashboard</h1>
          {session && (
            <p className="mt-2 text-base text-ink-muted md:text-lg">
              {greeting(now)}. Welcome back, {session.displayName}.
            </p>
          )}
          {(summary || action) && (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              {action}
              {summary}
            </div>
          )}
        </div>
        <HotelScene className="-mr-2 -mb-3 hidden h-44 w-auto shrink-0 sm:block lg:h-52" />
      </div>
    </div>
  );

  if (list.isPending) {
    return (
      <div className="mx-auto max-w-6xl">
        {hero()}
        <p className="mt-6 flex items-center gap-2 text-ink-muted" role="status">
          <Spinner /> Loading quotes…
        </p>
        <div aria-hidden="true" className="mt-6 grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-36 animate-pulse rounded-card bg-surface-muted" />
          ))}
        </div>
      </div>
    );
  }

  if (list.isError) {
    const error = list.error instanceof ApiError ? list.error : null;
    return (
      <div className="mx-auto max-w-6xl">
        {hero()}
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
      <div className="mx-auto max-w-6xl">
        {hero()}
        <div className="mt-6">
          <EmptyState
            title="No quotes yet"
            action={
              canCreate ? (
                <Link
                  to="/quotes/new"
                  className="inline-flex min-h-11 items-center gap-2 rounded-full bg-brand px-6 text-sm font-semibold text-on-brand shadow-brand hover:bg-brand-hover"
                >
                  <Icon name="plus" className="size-4" strokeWidth={2.25} />
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

  const summary = (
    <p className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface/80 px-4 text-sm font-medium text-ink-muted backdrop-blur">
      <Icon name="layers" className="size-4 text-ink" />
      {counted(quotes.length, 'quote')}
      {list.data.next_cursor ? ' (showing the latest 100)' : ''}
    </p>
  );
  const newQuote = canCreate ? (
    <Link
      to="/quotes/new"
      className="inline-flex min-h-11 items-center gap-2 rounded-full bg-brand px-6 text-sm font-semibold text-on-brand shadow-brand hover:-translate-y-px hover:bg-brand-hover"
    >
      <Icon name="plus" className="size-4" strokeWidth={2.25} />
      New quote
    </Link>
  ) : undefined;

  return (
    <div className="mx-auto max-w-6xl">
      {hero(summary, newQuote)}

      <div className="c32-stagger mt-6 grid gap-4 md:grid-cols-3">
        <StatCard
          featured
          title="Contribution at risk"
          icon="trending"
          value={<Money value={risk.total} />}
        >
          <p>
            Contribution on {counted(risk.openCount, 'open quote')} that{' '}
            {plural(risk.openCount, 'is', 'are')} offered or pending review. It is lost if{' '}
            {plural(risk.openCount, 'it expires', 'they expire')}.
          </p>
          {risk.unknown > 0 && (
            <p className="mt-2 font-medium text-white">
              {counted(risk.unknown, 'open quote')} {plural(risk.unknown, 'has', 'have')} an unknown
              contribution and {plural(risk.unknown, 'is', 'are')} not included in this total.
            </p>
          )}
        </StatCard>
        <StatCard title="Booked contribution" icon="wallet" value={<Money value={booked.total} />}>
          On {counted(booked.count, 'confirmed quote')}
          {booked.unknown > 0 && `, plus ${booked.unknown} with an unknown contribution`}.
        </StatCard>
        <StatCard title="Holds ending soon" icon="clock" value={soon.length}>
          {soon.length === 0
            ? `None of ${counted(risk.openCount, 'open quote')} ends in the next ${SOON_HOURS} hours.`
            : `${plural(soon.length, 'Hold', 'Holds')} on open quotes ending within ${SOON_HOURS} hours.`}
        </StatCard>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Panel title="Needs you now" id="next" icon="sparkle" className="lg:col-span-3">
          {steps.length === 0 ? (
            <p className="flex items-center gap-3 rounded-control bg-surface-muted p-4 text-sm text-ink-muted">
              <span
                aria-hidden="true"
                className="grid size-8 place-items-center rounded-full bg-success-soft text-success"
              >
                <Icon name="check" className="size-4" strokeWidth={2.25} />
              </span>
              Nothing needs you right now.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {steps.map((step) => (
                <li key={step.to}>
                  <Link
                    to={step.to}
                    className="group flex min-h-14 items-center gap-3 rounded-control border border-border bg-surface px-3 py-2 text-sm font-semibold text-ink hover:border-brand/40 hover:bg-brand-soft/50"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'grid size-9 shrink-0 place-items-center rounded-lg',
                        STEP_TONE[step.tone],
                      )}
                    >
                      <Icon name={step.icon} className="size-[1.1rem]" />
                    </span>
                    <span className="flex-1">{step.text}</span>
                    <Icon
                      name="arrowRight"
                      className="size-4 text-ink-muted transition-transform group-hover:translate-x-0.5 group-hover:text-brand"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title={`Holds expiring in ${SOON_HOURS} hours`}
          id="holds"
          icon="clock"
          className="lg:col-span-2"
        >
          {soon.length === 0 ? (
            <p className="rounded-control bg-surface-muted p-4 text-sm text-ink-muted">
              No holds expire in the next {SOON_HOURS} hours.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {soon.map((q) => (
                <li
                  key={q.quote_id}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-3 text-sm first:pt-0 last:pb-0"
                >
                  <Link
                    to={`/quotes/${q.quote_id}`}
                    state={BACK}
                    className="font-semibold text-ink underline decoration-border-strong/50 underline-offset-4 hover:text-brand hover:decoration-brand"
                  >
                    {q.request.organiser.name}
                  </Link>
                  <span
                    title={`UTC: ${q.valid_until}`}
                    className={cn(
                      'flex flex-wrap items-center gap-2',
                      holdTone(q.valid_until as string, now),
                    )}
                  >
                    {Date.parse(q.valid_until as string) - now.getTime() < HOUR_MS && (
                      <Badge tone="danger">Under 1 hour</Badge>
                    )}
                    <span className="rounded-full bg-surface-muted px-2.5 py-0.5 tabular-nums">
                      {formatCountdown(q.valid_until as string, now)}
                    </span>
                    <span className="text-xs text-ink-muted">{formatIst(q.valid_until)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <section
        aria-labelledby="pipeline"
        className="mt-6 rounded-card border border-border bg-surface p-6 shadow-card"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 id="pipeline" className="flex items-center gap-2.5 text-base font-semibold">
            <span
              aria-hidden="true"
              className="grid size-8 place-items-center rounded-lg bg-surface-muted text-ink-muted"
            >
              <Icon name="layers" className="size-4" />
            </span>
            Pipeline by status
          </h2>
        </div>
        {/* The share of quotes in each status, as one bar. The tiles below give the numbers. */}
        <div
          aria-hidden="true"
          className="mb-6 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-surface-muted"
        >
          {QUOTE_STATUSES.filter((s) => counts[s] > 0).map((s) => (
            <span
              key={s}
              className={cn('h-full first:rounded-l-full last:rounded-r-full', STATUS_FILL[s])}
              style={{ width: `${(counts[s] / quotes.length) * 100}%` }}
            />
          ))}
        </div>
        <div className="grid gap-5 md:grid-cols-[2fr_1fr] lg:grid-cols-[2fr_1fr_4fr]">
          {PIPELINE.map((group) => (
            <div key={group.title}>
              <h3 className="mb-2 text-xs font-semibold tracking-[0.12em] text-ink-muted uppercase">
                {group.title}
              </h3>
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
                      className="group relative block h-full overflow-hidden rounded-control border border-border bg-surface-muted/50 p-4 hover:-translate-y-0.5 hover:border-brand/40 hover:bg-surface hover:shadow-raised"
                    >
                      <span className="block text-3xl font-bold tracking-tight tabular-nums">
                        {counts[status]}
                      </span>
                      <span className="mt-2 block">
                        <StatusBadge status={status} />
                      </span>
                      <span className="sr-only">{STATUS_LABEL[status]} quotes</span>
                      <span
                        aria-hidden="true"
                        className={cn(
                          'absolute inset-x-0 bottom-0 h-1 opacity-70',
                          STATUS_FILL[status],
                        )}
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="recent" className="mt-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="recent" className="text-lg font-semibold">
            Recent quotes
          </h2>
          <Link
            to="/quotes"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline"
          >
            View all quotes
            <Icon name="arrowRight" className="size-4" />
          </Link>
        </div>
        <DataTable
          caption="Most recent quotes"
          rows={quotes.slice(0, 8)}
          rowKey={(q) => q.quote_id}
          columns={[
            {
              header: 'Organiser',
              render: (q) => (
                <span className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-bold text-brand"
                  >
                    {(q.request.organiser.name.trim()[0] ?? '?').toUpperCase()}
                  </span>
                  <Link
                    to={`/quotes/${q.quote_id}`}
                    state={BACK}
                    className="font-semibold text-ink hover:text-brand hover:underline"
                  >
                    {q.request.organiser.name}
                  </Link>
                </span>
              ),
            },
            { header: 'Status', render: (q) => <StatusBadge status={q.status} /> },
            {
              header: 'Stay',
              render: (q) => (
                <span className="whitespace-nowrap">
                  {formatDateShort(q.evaluation.check_in)} to{' '}
                  {formatDateShort(q.evaluation.check_out)}
                </span>
              ),
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
              render: (q) => (
                <span className="font-semibold">
                  <Money value={q.evaluation.totals.contribution_inr} />
                </span>
              ),
            },
            {
              header: 'Hold',
              render: (q) =>
                OPEN_STATUSES.includes(q.status) && q.valid_until ? (
                  <span className={cn('whitespace-nowrap', holdTone(q.valid_until, now))}>
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
