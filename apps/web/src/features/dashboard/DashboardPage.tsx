import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { QUOTE_STATUSES } from '@c32/core';
import type { Quote, QuoteStatus } from '@c32/core';
import {
  Alert,
  Badge,
  Button,
  CountUp,
  DataTable,
  EmptyState,
  HotelScene,
  Icon,
  Money,
  ProgressRing,
} from '../../components';
import type { IconName } from '../../components';
import { ApiError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatCountdown, formatDateShort, formatInr, formatIst } from '../../lib/format';
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
  CONFIRMED: 'bg-[#22c55e]',
  DECLINED: 'bg-[#fb7185]',
  REJECTED: 'bg-[#e11d48]',
  EXPIRED: 'bg-[#a1a1aa]',
  CANCELLED: 'bg-[#d4d4d8]',
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

/** The first name to greet: the part of an email before the @, or the first word of a name. */
function firstName(displayName: string): string {
  const base = (displayName.split('@')[0] ?? displayName).trim().split(/[\s._-]+/)[0] ?? '';
  const letters = base.replace(/\d+$/, '') || base;
  return letters ? letters.charAt(0).toUpperCase() + letters.slice(1) : displayName;
}

const today = (now: Date) =>
  new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Asia/Kolkata',
  }).format(now);

const money = (n: number) => formatInr(Math.round(n));

/** A small frosted label that floats beside the hotel. Decoration: the cards below say the same. */
function FloatChip({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className: string;
  delay?: number;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'c32-float absolute hidden items-center gap-1.5 rounded-full bg-white/85 px-3 py-1.5 text-[0.72rem] font-medium whitespace-nowrap text-ink shadow-raised ring-1 ring-border backdrop-blur-md lg:inline-flex',
        className,
      )}
      style={{ animationDelay: `${delay}s`, animationDuration: '7s' }}
    >
      {children}
    </span>
  );
}

/** A thin bar that grows in, for a share of something. Decoration: the text says the number. */
function ShareBar({
  share,
  className,
  track,
}: {
  share: number;
  className: string;
  track: string;
}) {
  return (
    <div aria-hidden="true" className={cn('mt-5 h-1.5 overflow-hidden rounded-full', track)}>
      <div
        className={cn('c32-grow h-full rounded-full', className)}
        style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%` }}
      />
    </div>
  );
}

/** A headline number with its icon and a short explanation. */
function StatCard({
  title,
  icon,
  value,
  children,
  featured = false,
  footer,
}: {
  title: string;
  icon: IconName;
  value: ReactNode;
  children?: ReactNode;
  featured?: boolean;
  footer?: ReactNode;
}) {
  return (
    <section
      className={cn(
        'group flex flex-col rounded-card border p-5 transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5',
        featured
          ? 'c32-sheen border-transparent bg-ink text-white shadow-raised'
          : 'border-border bg-surface shadow-card hover:shadow-raised',
      )}
    >
      {featured && (
        <span
          aria-hidden="true"
          className="c32-drift pointer-events-none absolute -top-20 -right-16 size-56 rounded-full bg-[radial-gradient(circle,rgb(255_255_255/0.12),transparent_65%)]"
        />
      )}
      <div className="relative flex items-center justify-between gap-3">
        <h2
          className={cn('text-[0.8rem] font-medium', featured ? 'text-white/80' : 'text-ink-muted')}
        >
          {title}
        </h2>
        <span
          aria-hidden="true"
          className={cn(
            'grid size-8 place-items-center rounded-full transition-transform duration-300 group-hover:scale-110',
            featured ? 'bg-white/10 text-white' : 'bg-surface-muted text-ink',
          )}
        >
          <Icon name={icon} className="size-4" />
        </span>
      </div>
      <p className="relative mt-4 text-[2rem] leading-none font-semibold tracking-[-0.03em] tabular-nums">
        {value}
      </p>
      {children && (
        <div
          className={cn(
            'relative mt-3 text-[0.8rem] leading-relaxed',
            featured ? 'text-white/75' : 'text-ink-muted',
          )}
        >
          {children}
        </div>
      )}
      {footer && <div className="relative mt-auto">{footer}</div>}
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
      className={cn('rounded-card border border-border bg-surface p-5 shadow-card', className)}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id={id} className="flex items-center gap-2 text-[0.95rem] font-semibold">
          <Icon name={icon} className="size-4 text-ink-muted" />
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

  const hero = (summary?: ReactNode, actions?: ReactNode, chips?: ReactNode) => (
    <div className="relative isolate overflow-hidden rounded-[1.75rem] border border-border bg-surface px-6 py-7 shadow-card md:px-9 md:py-8">
      {/* Soft light that drifts behind the hotel, over a faint grid that fades out. */}
      <div
        aria-hidden="true"
        className="c32-drift absolute -top-32 -right-24 -z-10 size-[30rem] rounded-full bg-[radial-gradient(circle,rgb(255_207_77/0.30),transparent_62%)]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 [background-image:linear-gradient(rgb(10_10_10/0.045)_1px,transparent_1px),linear-gradient(90deg,rgb(10_10_10/0.045)_1px,transparent_1px)] [background-size:28px_28px] [mask-image:radial-gradient(ellipse_at_80%_40%,black,transparent_70%)]"
      />
      <div className="flex items-center justify-between gap-8">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-medium text-ink-muted">
            <span aria-hidden="true" className="relative flex size-2">
              <span className="c32-ping absolute inset-0 rounded-full bg-accent-bright" />
              <span className="relative size-2 rounded-full bg-accent-bright" />
            </span>
            {today(now)}
          </p>
          <h1 className="mt-3 text-[2.25rem] leading-none md:text-[2.75rem]">Dashboard</h1>
          {session && (
            <p className="mt-3 text-[0.95rem] text-ink-muted">
              {greeting(now)}, {firstName(session.displayName)}.
            </p>
          )}
          {summary}
          {actions && <div className="mt-6 flex flex-wrap items-center gap-2.5">{actions}</div>}
        </div>
        <div className="relative hidden shrink-0 sm:block">
          <HotelScene className="c32-float h-40 w-auto lg:h-48" />
          {chips}
        </div>
      </div>
    </div>
  );

  if (list.isPending) {
    return (
      <div className="mx-auto max-w-6xl">
        {hero()}
        <p className="sr-only" role="status">
          Loading quotes…
        </p>
        <div aria-hidden="true" className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-40 animate-[c32-shimmer_1.4s_linear_infinite] rounded-card bg-[linear-gradient(90deg,var(--color-surface-muted)_25%,#ececee_50%,var(--color-surface-muted)_75%)] bg-[length:200%_100%]"
            />
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
        <div className="mt-5">
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
        <div className="mt-5">
          <EmptyState
            title="No quotes yet"
            action={
              canCreate ? (
                <Link
                  to="/quotes/new"
                  className="inline-flex min-h-11 items-center gap-2 rounded-full bg-brand px-6 text-sm font-medium text-on-brand shadow-brand hover:bg-brand-hover"
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
  const valueTotal = risk.total + booked.total;

  const summary = (
    <p className="mt-1 text-[0.95rem] text-ink-muted">
      <span className="font-semibold text-ink">{formatInr(risk.total)}</span> of contribution is
      waiting on a decision
      {soon.length > 0 ? (
        <>
          , and <span className="font-semibold text-ink">{soon.length}</span>{' '}
          {plural(soon.length, 'hold closes', 'holds close')} today.
        </>
      ) : (
        '.'
      )}
    </p>
  );
  const actions = (
    <>
      {canCreate && (
        <Link
          to="/quotes/new"
          className="group/new inline-flex min-h-11 items-center gap-2 rounded-full bg-brand px-5 text-sm font-medium text-on-brand shadow-brand hover:bg-brand-hover active:scale-[0.98]"
        >
          <Icon
            name="plus"
            className="size-4 transition-transform duration-300 group-hover/new:rotate-90"
            strokeWidth={2.25}
          />
          New quote
        </Link>
      )}
      <p className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface/70 px-4 text-sm font-medium text-ink backdrop-blur">
        <Icon name="layers" className="size-4 text-ink-muted" />
        {counted(quotes.length, 'quote')}
        {list.data.next_cursor ? ' (showing the latest 100)' : ''}
      </p>
    </>
  );

  return (
    <div className="mx-auto max-w-6xl">
      {hero(
        summary,
        actions,
        <>
          <FloatChip className="top-4 -left-20" delay={0.4}>
            <span className="size-1.5 rounded-full bg-accent-bright" />
            {risk.openCount} open
          </FloatChip>
          <FloatChip className="bottom-16 -left-28" delay={1.6}>
            <Icon name="trending" className="size-3.5" />
            {formatInr(risk.total)} at stake
          </FloatChip>
          {soon[0] && (
            <FloatChip className="-bottom-1 -left-12" delay={2.6}>
              <Icon name="clock" className="size-3.5 text-danger" />
              Next hold: {formatCountdown(soon[0].valid_until as string, now).replace(' left', '')}
            </FloatChip>
          )}
        </>,
      )}

      <div className="c32-stagger mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          featured
          title="Contribution at risk"
          icon="trending"
          value={<CountUp value={risk.total} format={money} />}
          footer={
            <ShareBar
              share={valueTotal ? risk.total / valueTotal : 0}
              className="bg-[#ffcf4d]"
              track="bg-white/10"
            />
          }
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
        <StatCard
          title="Booked contribution"
          icon="wallet"
          value={<CountUp value={booked.total} format={money} />}
          footer={
            <ShareBar
              share={valueTotal ? booked.total / valueTotal : 0}
              className="bg-accent-bright"
              track="bg-surface-muted"
            />
          }
        >
          On {counted(booked.count, 'confirmed quote')}
          {booked.unknown > 0 && `, plus ${booked.unknown} with an unknown contribution`}.
        </StatCard>
        <StatCard
          title="Open quotes"
          icon="quotes"
          value={<CountUp value={risk.openCount} />}
          footer={
            <ShareBar
              share={quotes.length ? risk.openCount / quotes.length : 0}
              className="bg-[#3b82f6]"
              track="bg-surface-muted"
            />
          }
        >
          {counts.OFFERED} offered, {counts.PENDING_REVIEW} pending review.
        </StatCard>
        <StatCard
          title="Holds ending soon"
          icon="clock"
          value={<CountUp value={soon.length} />}
          footer={
            <ShareBar
              share={risk.openCount ? soon.length / risk.openCount : 0}
              className="bg-danger"
              track="bg-surface-muted"
            />
          }
        >
          {soon.length === 0
            ? `None ends in the next ${SOON_HOURS} hours.`
            : `Of ${counted(risk.openCount, 'open quote')}, ending within ${SOON_HOURS} hours.`}
        </StatCard>
      </div>

      <div className="c32-stagger mt-5 grid gap-4 lg:grid-cols-5">
        <Panel title="Needs you now" id="next" icon="sparkle" className="lg:col-span-3">
          {steps.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl bg-surface-muted/60 px-4 py-8 text-center">
              <span
                aria-hidden="true"
                className="grid size-11 place-items-center rounded-full bg-success-soft text-success ring-8 ring-success-soft/40"
              >
                <Icon name="check" className="size-5" strokeWidth={2.25} />
              </span>
              <p className="text-sm text-ink-muted">Nothing needs you right now.</p>
            </div>
          ) : (
            <ul className="-mx-2 flex flex-col">
              {steps.map((step) => (
                <li key={step.to}>
                  <Link
                    to={step.to}
                    className="group flex min-h-14 items-center gap-3 rounded-xl px-2 py-2 text-sm font-medium text-ink hover:bg-surface-muted"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'grid size-9 shrink-0 place-items-center rounded-full transition-transform duration-300 group-hover:scale-105',
                        STEP_TONE[step.tone],
                      )}
                    >
                      <Icon name={step.icon} className="size-4" />
                    </span>
                    <span className="flex-1">{step.text}</span>
                    <span
                      aria-hidden="true"
                      className="grid size-8 place-items-center rounded-full text-ink-muted transition-all duration-300 group-hover:translate-x-0.5 group-hover:bg-ink group-hover:text-white"
                    >
                      <Icon name="arrowRight" className="size-4" />
                    </span>
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
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl bg-surface-muted/60 px-4 py-8 text-center">
              <span
                aria-hidden="true"
                className="grid size-11 place-items-center rounded-full bg-surface text-ink-muted shadow-card ring-1 ring-border"
              >
                <Icon name="clock" className="size-5" />
              </span>
              <p className="text-sm text-ink-muted">
                No holds expire in the next {SOON_HOURS} hours.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-1">
              {soon.map((q) => {
                const left = Date.parse(q.valid_until as string) - now.getTime();
                const tone = holdTone(q.valid_until as string, now);
                return (
                  <li key={q.quote_id} className="flex items-center gap-3 rounded-xl py-2 text-sm">
                    <span
                      className={cn(
                        'relative grid place-items-center',
                        left < HOUR_MS
                          ? 'text-danger'
                          : left < 6 * HOUR_MS
                            ? 'text-warning'
                            : 'text-ink',
                      )}
                    >
                      <ProgressRing fraction={left / (SOON_HOURS * HOUR_MS)} size={40} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <Link
                        to={`/quotes/${q.quote_id}`}
                        state={BACK}
                        className="block truncate font-semibold text-ink hover:underline"
                      >
                        {q.request.organiser.name}
                      </Link>
                      <span
                        className="block text-xs text-ink-muted"
                        title={`UTC: ${q.valid_until}`}
                      >
                        {formatIst(q.valid_until)}
                      </span>
                    </span>
                    <span className={cn('flex flex-col items-end gap-1', tone)}>
                      {left < HOUR_MS && <Badge tone="danger">Under 1 hour</Badge>}
                      <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium whitespace-nowrap tabular-nums">
                        {formatCountdown(q.valid_until as string, now)}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <section
        aria-labelledby="pipeline"
        className="mt-5 rounded-card border border-border bg-surface p-5 shadow-card"
      >
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 id="pipeline" className="flex items-center gap-2 text-[0.95rem] font-semibold">
            <Icon name="layers" className="size-4 text-ink-muted" />
            Pipeline by status
          </h2>
          <Link
            to="/quotes"
            className="inline-flex items-center gap-1 text-[0.8rem] font-medium text-ink-muted hover:text-ink"
          >
            Open the quotes list
            <Icon name="arrowRight" className="size-3.5" />
          </Link>
        </div>
        {/* The share of quotes in each status, as one bar. The tiles below give the numbers. */}
        <div aria-hidden="true" className="mb-6 flex h-2 gap-1">
          {QUOTE_STATUSES.filter((s) => counts[s] > 0).map((s, i) => (
            <span
              key={s}
              className={cn('c32-grow h-full rounded-full', STATUS_FILL[s])}
              style={{
                width: `${(counts[s] / quotes.length) * 100}%`,
                animationDelay: `${i * 90}ms`,
              }}
            />
          ))}
        </div>
        <div className="grid gap-5 md:grid-cols-[2fr_1fr] lg:grid-cols-[2fr_1fr_4fr]">
          {PIPELINE.map((group) => (
            <div key={group.title}>
              <h3 className="mb-2 text-[0.68rem] font-semibold tracking-[0.12em] text-ink-muted uppercase">
                {group.title}
              </h3>
              <ul
                className={cn(
                  'grid gap-2.5',
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
                      className="group block h-full rounded-2xl border border-border bg-surface p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-ink/20 hover:shadow-raised"
                    >
                      <span className="block text-[1.75rem] leading-none font-semibold tracking-tight tabular-nums">
                        {counts[status]}
                      </span>
                      <span className="mt-3 block">
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

      <section aria-labelledby="recent" className="mt-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="recent" className="text-[0.95rem] font-semibold">
            Recent quotes
          </h2>
          <Link
            to="/quotes"
            className="group inline-flex items-center gap-1 text-[0.8rem] font-medium text-ink-muted hover:text-ink"
          >
            View all quotes
            <Icon
              name="arrowRight"
              className="size-3.5 transition-transform group-hover:translate-x-0.5"
            />
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
                    className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-muted text-xs font-semibold text-ink ring-1 ring-border"
                  >
                    {(q.request.organiser.name.trim()[0] ?? '?').toUpperCase()}
                  </span>
                  <Link
                    to={`/quotes/${q.quote_id}`}
                    state={BACK}
                    className="font-semibold text-ink hover:underline"
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
                <span className="whitespace-nowrap text-ink-muted">
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
