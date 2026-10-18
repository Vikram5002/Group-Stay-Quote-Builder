import { useEffect, useRef, useState } from 'react';
import type { Quote } from '@c32/core';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../../app/ApiProvider';
import { Alert, Badge, Button, EmptyState, Money, SelectField, Spinner } from '../../components';
import { ApiError } from '../../lib/api';
import { formatCountdown } from '../../lib/format';
import { cn } from '../../lib/cn';
import { counted, plural } from '../../lib/plural';
import { useAuth } from '../auth/auth';
import { REASON_LABEL } from '../quotes/labels';
import { QUOTES_KEY, useNow } from '../quotes/queries';
import type { BackState } from '../quotes/QuoteDetailPage';
import { ReviewPanel } from './ReviewPanel';
import type { ReviewResult } from './ReviewPanel';

const REVIEW_KEY = [...QUOTES_KEY, 'review'] as const;

const SORTS = {
  urgent: 'Hold ends, soonest first',
  shortfall: 'Furthest below the floor first',
  oldest: 'Waiting longest first',
} as const;
type Sort = keyof typeof SORTS;

// An unknown shortfall is the biggest risk, so it sorts first.
const shortfall = (q: Quote) => q.evaluation.totals.shortfall_inr ?? Number.POSITIVE_INFINITY;
const SORTERS: Record<Sort, (a: Quote, b: Quote) => number> = {
  urgent: (a, b) => (a.valid_until ?? '9999').localeCompare(b.valid_until ?? '9999'),
  shortfall: (a, b) => shortfall(b) - shortfall(a),
  oldest: (a, b) => a.created_at.localeCompare(b.created_at),
};

export function ReviewQueuePage() {
  const api = useApi();
  const { session } = useAuth();
  const now = useNow();
  const [params, setParams] = useSearchParams();
  const [result, setResult] = useState<ReviewResult | null>(null);
  const sort = (params.get('sort') ?? 'urgent') as Sort;
  // After choosing a quote, its heading takes focus once it shows (on a phone it is below the list).
  const panelRef = useRef<HTMLDivElement>(null);
  const focusPanel = useRef(false);
  const selectedParam = params.get('quote');
  useEffect(() => {
    if (!focusPanel.current) return;
    focusPanel.current = false;
    const heading = panelRef.current?.querySelector<HTMLElement>('h2');
    heading?.setAttribute('tabindex', '-1');
    heading?.focus();
    heading?.scrollIntoView?.({ block: 'start' });
  }, [selectedParam]);

  const list = useQuery({
    queryKey: REVIEW_KEY,
    queryFn: () => api.listQuotes({ status: 'PENDING_REVIEW', limit: '100' }),
  });

  const heading = (
    <h1 className="text-[1.875rem] leading-tight font-semibold md:text-[2.125rem]">Review queue</h1>
  );
  const intro = (
    <p className="mt-1 text-ink-muted">
      Floor breaches and unknowns waiting for an Owner decision.
    </p>
  );

  const resultAlert = result && (
    <div className="mt-4">
      <Alert
        tone="success"
        title={result.kind === 'approved' ? 'Quote approved' : 'Quote rejected'}
        action={
          <Link
            to={`/quotes/${result.quote.quote_id}`}
            state={{ from: { to: '/review', label: 'Review queue' } } satisfies BackState}
            className="font-semibold text-ink underline decoration-ink/25 underline-offset-4 hover:decoration-ink"
          >
            Open {result.quote.request.organiser.name}
          </Link>
        }
      >
        {result.kind === 'approved'
          ? 'It is now offered, and Sales can confirm it. The approval is tied to the exact terms you saw.'
          : 'The held rooms were released.'}
      </Alert>
    </div>
  );

  if (list.isPending) {
    return (
      <div className="mx-auto max-w-6xl">
        {heading}
        <p className="mt-6 flex items-center gap-2" role="status">
          <Spinner /> Loading the queue…
        </p>
      </div>
    );
  }

  if (list.isError) {
    const error = list.error instanceof ApiError ? list.error : null;
    return (
      <div className="mx-auto max-w-6xl">
        {heading}
        <div className="mt-6">
          <Alert
            tone="danger"
            title={error?.friendly.title ?? 'Could not load the queue'}
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

  const items = [...list.data.items].sort(SORTERS[sort] ?? SORTERS.urgent);

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-6xl">
        {heading}
        {intro}
        {resultAlert}
        <div className="mt-6">
          <EmptyState title="Nothing is waiting for review">
            Quotes below the contribution floor, or with an unknown value, appear here for an Owner
            to decide.
          </EmptyState>
        </div>
      </div>
    );
  }

  const selectedId = params.get('quote');
  const match = items.find((q) => q.quote_id === selectedId);
  const selected = match ?? items[0];
  if (!selected) return null;
  // A link to a quote that was decided, cancelled or expired since.
  const gone = selectedId !== null && !match && !result;
  const select = (changes: Record<string, string>) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    });

  return (
    <div className="mx-auto max-w-6xl">
      {heading}
      {intro}
      {resultAlert}
      {gone && (
        <div className="mt-4">
          <Alert
            tone="info"
            title="That quote is no longer waiting for review"
            action={
              <Link
                to={`/quotes/${selectedId}`}
                className="font-semibold text-ink underline decoration-ink/25 underline-offset-4 hover:decoration-ink"
              >
                Open it to see what happened
              </Link>
            }
          >
            It was decided, cancelled or expired after the link was made. The most urgent quote in
            the queue is shown instead.
          </Alert>
        </div>
      )}
      <div className="mt-6 grid gap-6 lg:grid-cols-[20rem_1fr]">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold" role="status">
            {counted(items.length, 'quote')} {plural(items.length, 'is', 'are')} waiting
          </p>
          <SelectField
            label="Sort"
            value={sort}
            onChange={(e) => select({ sort: e.target.value === 'urgent' ? '' : e.target.value })}
          >
            {Object.entries(SORTS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
          <nav aria-label="Quotes awaiting review">
            <ul className="flex flex-col gap-2">
              {items.map((q) => {
                const active = q.quote_id === selected.quote_id;
                return (
                  <li key={q.quote_id}>
                    <button
                      type="button"
                      aria-current={active ? 'true' : undefined}
                      onClick={() => {
                        setResult(null);
                        focusPanel.current = q.quote_id !== selectedParam;
                        select({ quote: q.quote_id });
                      }}
                      className={cn(
                        'w-full rounded-card border p-3 text-left',
                        active
                          ? 'border-brand bg-brand-soft'
                          : 'border-border bg-surface hover:bg-surface-muted',
                      )}
                    >
                      <span className="block font-semibold">{q.request.organiser.name}</span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {q.evaluation.reasons.map((r) => (
                          <Badge key={r} tone={r === 'FLOOR_BREACH' ? 'danger' : 'unknown'}>
                            {REASON_LABEL[r]}
                          </Badge>
                        ))}
                      </span>
                      <span className="mt-2 block text-sm text-ink-muted">
                        Contribution <Money value={q.evaluation.totals.contribution_inr} />
                        {q.evaluation.totals.shortfall_inr !== null &&
                          q.evaluation.totals.shortfall_inr > 0 && (
                            <>
                              {' '}
                              (<Money value={q.evaluation.totals.shortfall_inr} /> below the floor)
                            </>
                          )}
                        {q.valid_until && <> · {formatCountdown(q.valid_until, now)}</>}
                      </span>
                      <span className="block text-xs text-ink-muted">
                        By {q.created_by.user_id}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {list.data.next_cursor && (
              <p className="mt-3 text-sm text-ink-muted">
                Showing the first 100 quotes in the queue.
              </p>
            )}
          </nav>
        </div>

        <div aria-label="Selected quote" ref={panelRef}>
          <ReviewPanel
            key={selected.quote_id}
            quote={selected}
            currentUserId={session?.user.user_id ?? ''}
            onDone={(done) => {
              setResult(done);
              select({ quote: '' });
              void list.refetch();
            }}
          />
        </div>
      </div>
    </div>
  );
}
