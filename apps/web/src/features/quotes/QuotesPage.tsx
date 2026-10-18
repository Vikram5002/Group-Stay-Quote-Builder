import { useMemo } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { QUOTE_STATUSES } from '@c32/core';
import type { Quote, QuoteStatus } from '@c32/core';
import { useApi } from '../../app/ApiProvider';
import {
  Alert,
  Badge,
  Button,
  Card,
  CheckboxField,
  DataTable,
  EmptyState,
  Money,
  SelectField,
  Spinner,
  TextField,
} from '../../components';
import { ApiError } from '../../lib/api';
import { formatCountdown, formatDateShort, formatIst } from '../../lib/format';
import { counted } from '../../lib/plural';
import { useAuth } from '../auth/auth';
import { OPEN_STATUSES, STATUS_LABEL } from './labels';
import { clientTotal } from './pricingText';
import type { BackState } from './QuoteDetailPage';
import { QUOTES_KEY, useNow } from './queries';
import { reviewBadge, reviewState } from './reviewState';
import { StatusBadge } from './StatusBadge';
import { BUILDERS, can } from '../../lib/roles';

const SORTS = {
  newest: 'Newest first',
  check_in: 'Check-in, soonest first',
  expiry: 'Hold ends, soonest first',
  total: 'Total, highest first',
  contribution: 'Contribution, highest first',
} as const;
type Sort = keyof typeof SORTS;

/** "OPEN" is offered or pending review: everything still holding rooms. */
type StatusFilter = QuoteStatus | 'OPEN' | '';

const byNumberDesc = (pick: (q: Quote) => number | null) => (a: Quote, b: Quote) =>
  (pick(b) ?? Number.NEGATIVE_INFINITY) - (pick(a) ?? Number.NEGATIVE_INFINITY);

const SORTERS: Record<Sort, (a: Quote, b: Quote) => number> = {
  newest: (a, b) => b.created_at.localeCompare(a.created_at),
  check_in: (a, b) => a.evaluation.check_in.localeCompare(b.evaluation.check_in),
  expiry: (a, b) => (a.valid_until ?? '9999').localeCompare(b.valid_until ?? '9999'),
  total: byNumberDesc((q) => clientTotal(q.evaluation.totals)),
  contribution: byNumberDesc((q) => q.evaluation.totals.contribution_inr),
};

/** Every quote, found by organiser, status and dates, and sorted the way the task needs. */
export function QuotesPage() {
  const api = useApi();
  const { session } = useAuth();
  const now = useNow();
  const [params, setParams] = useSearchParams();
  const location = useLocation();

  const search = params.get('q') ?? '';
  const status = (params.get('status') ?? '') as StatusFilter;
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const sort = (params.get('sort') ?? 'newest') as Sort;
  const mine = params.get('mine') === '1';
  const filtered = Boolean(search || status || from || to || mine);

  const set = (changes: Record<string, string>) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );

  // The API filters by one status and by check-in dates; "open" and the text search are applied
  // to the pages loaded so far.
  const apiStatus = status && status !== 'OPEN' ? status : undefined;
  const list = useInfiniteQuery({
    queryKey: [...QUOTES_KEY, 'list', { apiStatus, from, to }],
    queryFn: ({ pageParam }) =>
      api.listQuotes({
        limit: '100',
        ...(apiStatus ? { status: apiStatus } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });

  const quotes = useMemo(() => {
    const all = list.data?.pages.flatMap((p) => p.items) ?? [];
    const text = search.trim().toLowerCase();
    return all
      .filter((q) => status !== 'OPEN' || OPEN_STATUSES.includes(q.status))
      .filter((q) => !mine || q.created_by.user_id === session?.user.user_id)
      .filter((q) => {
        if (!text) return true;
        const o = q.request.organiser;
        return [o.name, o.reference, o.contact_name, o.email, q.quote_id]
          .filter(Boolean)
          .some((v) => (v as string).toLowerCase().includes(text));
      })
      .sort(SORTERS[sort] ?? SORTERS.newest);
  }, [list.data, search, status, mine, sort, session]);

  const organiser = (q: Quote) => (
    <div>
      <Link
        to={`/quotes/${q.quote_id}`}
        state={{ from: { to: `/quotes${location.search}`, label: 'Quotes' } } satisfies BackState}
        className="font-semibold text-brand underline"
      >
        {q.request.organiser.name}
      </Link>
      {q.request.organiser.reference && (
        <span className="block text-xs text-ink-muted">Ref {q.request.organiser.reference}</span>
      )}
    </div>
  );
  const status_ = (q: Quote) => {
    const badge = reviewBadge(reviewState(q));
    return (
      <span className="flex flex-wrap gap-1">
        <StatusBadge status={q.status} />
        {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
      </span>
    );
  };
  const stay = (q: Quote) =>
    `${formatDateShort(q.evaluation.check_in)} to ${formatDateShort(q.evaluation.check_out)}`;
  const hold = (q: Quote) =>
    OPEN_STATUSES.includes(q.status) && q.valid_until ? (
      <time dateTime={q.valid_until} title={formatIst(q.valid_until)}>
        {formatCountdown(q.valid_until, now)}
      </time>
    ) : (
      <span className="text-ink-muted">No hold</span>
    );

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Quotes</h1>
          <p className="mt-1 text-ink-muted" role="status">
            {list.isPending
              ? 'Loading…'
              : `${counted(quotes.length, 'quote')}${filtered ? ' match' : ''}${list.hasNextPage ? ', more to load' : ''}`}
          </p>
        </div>
        {can(BUILDERS, session?.user.role) && (
          <Link
            to="/quotes/new"
            className="inline-flex min-h-11 items-center rounded-full bg-brand px-5 text-sm font-medium text-on-brand hover:bg-brand-hover"
          >
            New quote
          </Link>
        )}
      </div>

      <Card className="mt-6">
        <form
          role="search"
          aria-label="Find quotes"
          className="grid gap-4 md:grid-cols-3 lg:grid-cols-6"
          onSubmit={(e) => e.preventDefault()}
        >
          <div className="md:col-span-3 lg:col-span-2">
            <TextField
              label="Search"
              type="search"
              value={search}
              placeholder="Organiser, reference or contact"
              onChange={(e) => set({ q: e.target.value })}
            />
          </div>
          <SelectField
            label="Status"
            value={status}
            onChange={(e) => set({ status: e.target.value })}
          >
            <option value="">All</option>
            <option value="OPEN">Open (offered or pending)</option>
            {QUOTE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Check-in from"
            type="date"
            value={from}
            onChange={(e) => set({ from: e.target.value })}
          />
          <TextField
            label="Check-in to"
            type="date"
            value={to}
            onChange={(e) => set({ to: e.target.value })}
          />
          <SelectField label="Sort" value={sort} onChange={(e) => set({ sort: e.target.value })}>
            {Object.entries(SORTS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
          <div className="flex flex-wrap items-center gap-4 md:col-span-3 lg:col-span-6">
            <CheckboxField
              label="Only quotes I created"
              checked={mine}
              onChange={(e) => set({ mine: e.target.checked ? '1' : '' })}
            />
            {filtered && (
              <Button
                variant="ghost"
                onClick={() => set({ q: '', status: '', from: '', to: '', mine: '' })}
              >
                Clear filters
              </Button>
            )}
          </div>
        </form>
      </Card>

      <div className="mt-6" aria-busy={list.isFetching || undefined}>
        {list.isPending ? (
          <p className="flex items-center gap-2" role="status">
            <Spinner /> Loading quotes…
          </p>
        ) : list.isError ? (
          <Alert
            tone="danger"
            title="Could not load the quotes"
            action={
              <Button variant="secondary" onClick={() => void list.refetch()}>
                Try again
              </Button>
            }
          >
            {list.error instanceof ApiError
              ? (list.error.problem.detail ?? list.error.problem.title)
              : 'Try again in a moment.'}
          </Alert>
        ) : quotes.length === 0 ? (
          <EmptyState
            title={filtered ? 'No quotes match these filters' : 'No quotes yet'}
            action={
              filtered ? (
                <Button
                  variant="secondary"
                  onClick={() => set({ q: '', status: '', from: '', to: '', mine: '' })}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          >
            {filtered
              ? 'Try other words, another status or a wider range of dates.'
              : 'Quotes appear here once someone issues one.'}
          </EmptyState>
        ) : (
          <>
            <div className="hidden md:block">
              <DataTable
                caption="Quotes"
                rows={quotes}
                rowKey={(q) => q.quote_id}
                columns={[
                  { header: 'Organiser', render: organiser },
                  { header: 'Status', render: status_ },
                  { header: 'Stay', render: stay },
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
                  { header: 'Hold', render: hold },
                  {
                    header: 'Created',
                    render: (q) => (
                      <span className="text-xs">
                        {q.created_by.user_id}
                        <span className="block text-ink-muted">{formatIst(q.created_at)}</span>
                      </span>
                    ),
                  },
                ]}
              />
            </div>
            <ul className="flex flex-col gap-3 md:hidden" aria-label="Quotes">
              {quotes.map((q) => (
                <li key={q.quote_id} className="rounded-card border border-border bg-surface p-4">
                  {organiser(q)}
                  <div className="mt-2">{status_(q)}</div>
                  <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                    <dt className="text-ink-muted">Stay</dt>
                    <dd>{stay(q)}</dd>
                    <dt className="text-ink-muted">Rooms</dt>
                    <dd>{q.evaluation.offered_rooms}</dd>
                    <dt className="text-ink-muted">Total</dt>
                    <dd className="font-semibold">
                      <Money value={clientTotal(q.evaluation.totals)} />
                    </dd>
                    <dt className="text-ink-muted">Hold</dt>
                    <dd>{hold(q)}</dd>
                  </dl>
                </li>
              ))}
            </ul>
            {list.hasNextPage && (
              <div className="mt-4">
                <Button
                  variant="secondary"
                  loading={list.isFetchingNextPage}
                  onClick={() => void list.fetchNextPage()}
                >
                  Load more quotes
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
