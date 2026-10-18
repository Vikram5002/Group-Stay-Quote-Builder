import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { RequoteState } from '../quotes/QuoteBuilderPage';
import { useQuery } from '@tanstack/react-query';
import { addDays, daysBetween, DEFAULT_POLICY, LIMITS, localDate, stayNights } from '@c32/core';
import type { InventoryNight, Quote } from '@c32/core';
import { useApi } from '../../app/ApiProvider';
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  SelectField,
  Spinner,
  TextField,
} from '../../components';
import { ApiError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatDate } from '../../lib/format';
import { useAuth } from '../auth/auth';
import { usePolicy } from '../policy/queries';
import { initialForm, ROOM_TYPES } from '../quotes/form';
import { STATUS_LABEL } from '../quotes/labels';
import type { BackState } from '../quotes/QuoteDetailPage';
import { useQuoteList } from '../quotes/queries';
import { StatusBadge } from '../quotes/StatusBadge';
import { counted } from '../../lib/plural';

/** The page opens on today and the 13 nights after it, so current holds are in view. */
const DEFAULT_NIGHTS = 14;

const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });

type Cell =
  | { kind: 'sale'; date: string; night: InventoryNight }
  | { kind: 'unknown'; date: string; night: InventoryNight }
  | { kind: 'off'; date: string };

function cellFor(date: string, byDate: Map<string, InventoryNight>): Cell {
  const night = byDate.get(date);
  if (!night) return { kind: 'off', date };
  if (night.total_units === null) return { kind: 'unknown', date, night };
  return { kind: 'sale', date, night };
}

/** A night with a fifth of its rooms or fewer still free. */
const isLow = (n: InventoryNight) =>
  n.total_units !== null &&
  n.available_units !== null &&
  n.available_units > 0 &&
  n.available_units <= n.total_units / 5;

function Segment({ value, total, className }: { value: number; total: number; className: string }) {
  if (value === 0 || total === 0) return null;
  return <div className={className} style={{ width: `${(value / total) * 100}%` }} />;
}

function NightButton({
  cell,
  selected,
  onSelect,
}: {
  cell: Cell;
  selected: boolean;
  onSelect: () => void;
}) {
  const base =
    'flex min-h-24 w-full flex-col justify-between rounded-control border p-2 text-left text-xs';
  const tone =
    cell.kind === 'sale'
      ? 'border-border-strong bg-surface'
      : 'border-dashed border-unknown bg-unknown-soft';
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(base, tone, selected && 'outline outline-3 outline-offset-1 outline-focus')}
    >
      <span className="flex flex-wrap items-center justify-between gap-1">
        <span className="font-semibold">{dayLabel(cell.date)}</span>
        {cell.kind === 'sale' && cell.night.available_units === 0 && (
          <Badge tone="danger">Sold out</Badge>
        )}
        {cell.kind === 'sale' && isLow(cell.night) && <Badge tone="warning">Few left</Badge>}
      </span>
      {cell.kind === 'sale' && (
        <>
          <span className="tabular-nums">
            {cell.night.available_units} of {cell.night.total_units} free
          </span>
          <span
            aria-hidden="true"
            className="flex h-2 overflow-hidden rounded-full bg-surface-muted ring-1 ring-border"
          >
            <Segment
              value={cell.night.confirmed_units}
              total={cell.night.total_units as number}
              className="bg-info"
            />
            <Segment
              value={cell.night.held_units}
              total={cell.night.total_units as number}
              className="bg-warning"
            />
            <Segment
              value={cell.night.available_units as number}
              total={cell.night.total_units as number}
              className="bg-success"
            />
          </span>
          <span className="tabular-nums text-ink-muted">
            Held {cell.night.held_units} · Confirmed {cell.night.confirmed_units}
          </span>
        </>
      )}
      {cell.kind === 'unknown' && (
        <span className="font-semibold text-unknown">
          <span aria-hidden="true">? </span>Unknown
        </span>
      )}
      {cell.kind === 'off' && <span className="text-ink-muted">Not on sale</span>}
    </button>
  );
}

function Legend() {
  return (
    <ul className="flex flex-wrap gap-4 text-sm" aria-label="Legend">
      <li className="flex items-center gap-2">
        <span aria-hidden="true" className="size-3 rounded-sm bg-success" /> Available
      </li>
      <li className="flex items-center gap-2">
        <span aria-hidden="true" className="size-3 rounded-sm bg-warning" /> Held, expires if not
        confirmed
      </li>
      <li className="flex items-center gap-2">
        <span aria-hidden="true" className="size-3 rounded-sm bg-info" /> Confirmed
      </li>
      <li className="flex items-center gap-2">
        <Badge tone="unknown">Unknown</Badge> no figure; never counted as zero
      </li>
    </ul>
  );
}

const HOLDING: readonly Quote['status'][] = ['OFFERED', 'PENDING_REVIEW', 'CONFIRMED'];

function holdingQuotes(quotes: readonly Quote[], date: string, roomType: string): Quote[] {
  return quotes.filter(
    (q) =>
      HOLDING.includes(q.status) &&
      q.request.room_type === roomType &&
      !q.evaluation.reasons.includes('UNKNOWN_AVAILABILITY') &&
      q.evaluation.offered_rooms > 0 &&
      stayNights(q.evaluation.check_in, q.evaluation.nights).includes(date),
  );
}

function NightDetail({ cell, roomType, today }: { cell: Cell; roomType: string; today: string }) {
  const quotes = useQuoteList();
  const { session } = useAuth();
  const heading = `Night of ${dayLabel(cell.date)}`;
  const label = ROOM_TYPES.find((t) => t.code === roomType)?.label ?? roomType;
  const canQuote =
    (session?.user.role === 'Sales' || session?.user.role === 'Owner') && cell.date >= today;
  const start: RequoteState = {
    prefill: { ...initialForm, checkIn: cell.date, roomType },
    message: `Check-in ${formatDate(cell.date)} and ${label} rooms filled in from the calendar.`,
  };

  if (cell.kind !== 'sale') {
    return (
      <Card title={heading}>
        <p className="text-sm">
          {cell.kind === 'unknown'
            ? 'Availability is unknown for this night, so no rooms can be held on it.'
            : 'This night has no inventory row, so it is not on sale.'}
        </p>
      </Card>
    );
  }
  const n = cell.night;
  const holders = quotes.data ? holdingQuotes(quotes.data.items, cell.date, roomType) : [];

  return (
    <Card title={heading}>
      <p className="text-sm">
        {counted(n.total_units ?? 0, 'room')} = {n.available_units} available + {n.held_units} held
        + {n.confirmed_units} confirmed.
      </p>
      <h3 className="mb-2 mt-4 font-semibold">Quotes holding this night</h3>
      {quotes.isPending ? (
        <p className="flex items-center gap-2 text-sm" role="status">
          <Spinner /> Loading quotes…
        </p>
      ) : quotes.isError ? (
        <Alert tone="warning" title="Quotes could not be loaded">
          The room counts above are still correct.
        </Alert>
      ) : (
        <DataTable
          caption={`Quotes holding ${dayLabel(cell.date)}`}
          rows={holders}
          rowKey={(q) => q.quote_id}
          empty={<p className="text-sm text-ink-muted">No quote holds rooms on this night.</p>}
          columns={[
            {
              header: 'Organiser',
              render: (q) => (
                <Link
                  to={`/quotes/${q.quote_id}`}
                  state={
                    { from: { to: '/availability', label: 'Availability' } } satisfies BackState
                  }
                  className="font-semibold text-brand underline"
                >
                  {q.request.organiser.name}
                </Link>
              ),
            },
            { header: 'Status', render: (q) => <StatusBadge status={q.status} /> },
            { header: 'Rooms', numeric: true, render: (q) => q.evaluation.offered_rooms },
          ]}
        />
      )}
      {canQuote && n.available_units !== null && n.available_units > 0 && (
        <Link
          to="/quotes/new"
          state={start}
          className="mt-4 inline-flex min-h-11 items-center rounded-full bg-brand px-5 text-sm font-medium text-on-brand hover:bg-brand-hover"
        >
          Start a quote from this night
        </Link>
      )}
      <p className="mt-3 text-xs text-ink-muted">
        Showing the latest 100 quotes. {STATUS_LABEL.OFFERED} and{' '}
        {STATUS_LABEL.PENDING_REVIEW.toLowerCase()} quotes are held;{' '}
        {STATUS_LABEL.CONFIRMED.toLowerCase()} quotes are booked.
      </p>
    </Card>
  );
}

function rangeError(from: string, to: string): string | undefined {
  if (!from || !to) return 'Choose both dates.';
  if (to < from) return 'The last night must be on or after the first night.';
  if (daysBetween(from, to) + 1 > LIMITS.MAX_ROOM_TYPE_NIGHTS) {
    return `Choose at most ${LIMITS.MAX_ROOM_TYPE_NIGHTS} nights.`;
  }
  return undefined;
}

export function AvailabilityPage() {
  const api = useApi();
  const [roomType, setRoomType] = useState<string>(ROOM_TYPES[0].code);
  // Today in the property time zone: the policy's for an Owner, else the documented default (IST).
  const policy = usePolicy();
  const today = localDate(Date.now(), policy.data?.timezone ?? DEFAULT_POLICY.timezone);
  // Null until the person picks a date, so the default follows the zone once the policy loads.
  const [fromInput, setFrom] = useState<string | null>(null);
  const [toInput, setTo] = useState<string | null>(null);
  const from = fromInput ?? today;
  const to = toInput ?? addDays(today, DEFAULT_NIGHTS - 1);
  const [selected, setSelected] = useState<string | null>(null);

  const problem = rangeError(from, to);
  const query = useQuery({
    queryKey: ['availability', roomType, from, to],
    queryFn: () => api.getAvailability({ room_type: roomType, from, to }),
    enabled: problem === undefined,
  });

  const dates = problem ? [] : stayNights(from, daysBetween(from, to) + 1);
  const byDate = new Map((query.data?.nights ?? []).map((n) => [n.date, n] as const));
  const cells = dates.map((d) => cellFor(d, byDate));
  const selectedCell = cells.find((c) => c.date === selected);
  const length = problem ? DEFAULT_NIGHTS : daysBetween(from, to) + 1;
  const shift = (days: number) => {
    setFrom(addDays(from, days));
    setTo(addDays(to, days));
    setSelected(null);
  };
  const sale = cells.flatMap((c) => (c.kind === 'sale' ? [c.night] : []));
  const soldOut = sale.filter((n) => n.available_units === 0).length;
  const fewest = sale.reduce<InventoryNight | null>(
    (min, n) => (min === null || (n.available_units ?? 0) < (min.available_units ?? 0) ? n : min),
    null,
  );

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-bold">Availability</h1>
      <p className="mt-1 text-ink-muted">
        Room-nights by date: available, held by open quotes, and confirmed. Choose a night to see
        which quotes hold it.
      </p>

      <Card className="mt-6">
        <form className="grid gap-4 md:grid-cols-3" onSubmit={(e) => e.preventDefault()} noValidate>
          <SelectField
            label="Room type"
            value={roomType}
            onChange={(e) => {
              setRoomType(e.target.value);
              setSelected(null);
            }}
          >
            {ROOM_TYPES.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label}
              </option>
            ))}
          </SelectField>
          <TextField
            label="First night"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <TextField
            label="Last night"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            {...(problem ? { error: problem } : {})}
          />
          <div
            className="flex flex-wrap gap-2 md:col-span-3"
            role="group"
            aria-label="Move the dates"
          >
            <Button variant="secondary" disabled={Boolean(problem)} onClick={() => shift(-length)}>
              <span aria-hidden="true">← </span>Previous {counted(length, 'night')}
            </Button>
            <Button
              variant="secondary"
              disabled={fromInput === null && toInput === null}
              onClick={() => {
                setFrom(null);
                setTo(null);
                setSelected(null);
              }}
            >
              From today
            </Button>
            <Button variant="secondary" disabled={Boolean(problem)} onClick={() => shift(length)}>
              Next {counted(length, 'night')}
              <span aria-hidden="true"> →</span>
            </Button>
          </div>
        </form>
      </Card>

      <div className="mt-6" aria-busy={query.isFetching || undefined}>
        {problem ? null : query.isPending ? (
          <p className="flex items-center gap-2" role="status">
            <Spinner /> Loading availability…
          </p>
        ) : query.isError ? (
          <Alert
            tone="danger"
            title={
              query.error instanceof ApiError
                ? query.error.friendly.title
                : 'Could not load availability'
            }
            action={
              <Button variant="secondary" onClick={() => void query.refetch()}>
                Try again
              </Button>
            }
          >
            {query.error instanceof ApiError
              ? `${query.error.friendly.message} ${query.error.friendly.nextStep}`
              : 'Try again in a moment.'}
          </Alert>
        ) : query.data.nights.length === 0 ? (
          <EmptyState title="No inventory for these dates">
            Nothing is on sale for this room type in this range. Import inventory, or choose other
            dates.
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-4">
            <Legend />
            {sale.length > 0 && (
              <p className="text-sm" role="status">
                {soldOut > 0 ? `${counted(soldOut, 'night')} sold out. ` : 'No night is sold out. '}
                {fewest &&
                  (fewest.available_units ?? 0) > 0 &&
                  `Fewest free: ${counted(fewest.available_units ?? 0, 'room')} on ${dayLabel(fewest.date)}.`}
              </p>
            )}
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-7">
              {cells.map((cell) => (
                <li key={cell.date}>
                  <NightButton
                    cell={cell}
                    selected={cell.date === selected}
                    onSelect={() => setSelected(cell.date === selected ? null : cell.date)}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {selectedCell && (
        <div className="mt-6" aria-live="polite">
          <NightDetail cell={selectedCell} roomType={roomType} today={today} />
        </div>
      )}
    </div>
  );
}
