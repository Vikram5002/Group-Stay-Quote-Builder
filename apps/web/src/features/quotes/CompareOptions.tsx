import { PROPERTY_ROOM_TYPES } from '@c32/core';
import type { Evaluation, QuoteRequest } from '@c32/core';
import type { ReactNode } from 'react';
import { Badge, Button, Card, Money, Spinner } from '../../components';
import type { Tone } from '../../components';
import { formatDateShort, formatIst } from '../../lib/format';
import { counted } from '../../lib/plural';
import { clientTotal, describePricing } from './pricingText';

export interface ComparedOption {
  label: string;
  request: QuoteRequest | null;
  evaluation: Evaluation | undefined;
  validUntil: string | null | undefined;
  /** The server's answer is for exactly this option's current terms. */
  current: boolean;
}

const DECISION: Record<Evaluation['decision'], { tone: Tone; label: string }> = {
  OFFER: { tone: 'success', label: 'Ready to offer' },
  PARTIAL_OFFER: { tone: 'info', label: 'Partial offer' },
  REVIEW: { tone: 'warning', label: 'Owner review required' },
  DECLINE: { tone: 'danger', label: 'Cannot be offered' },
};

const roomTypeLabel = (code: string) =>
  PROPERTY_ROOM_TYPES.find((t) => t.code === code)?.label ?? code;

/**
 * Two versions of a quote side by side, each priced by the server with no rooms held. Sales
 * chooses one; only that one is issued, so the hotel never holds rooms twice for one group.
 */
export function CompareOptions({
  options,
  onChoose,
  onEdit,
}: {
  options: readonly ComparedOption[];
  onChoose: (index: number) => void;
  onEdit: (index: number) => void;
}) {
  const cell = (option: ComparedOption, render: (e: Evaluation, r: QuoteRequest) => ReactNode) =>
    option.evaluation && option.request ? render(option.evaluation, option.request) : '—';

  const rows: Array<{ label: string; render: (o: ComparedOption) => ReactNode; strong?: boolean }> =
    [
      {
        label: 'Decision',
        render: (o) =>
          o.evaluation && o.current ? (
            <Badge tone={DECISION[o.evaluation.decision].tone}>
              {DECISION[o.evaluation.decision].label}
            </Badge>
          ) : (
            <span className="inline-flex items-center gap-2 text-ink-muted">
              <Spinner /> Checking…
            </span>
          ),
      },
      {
        label: 'Stay',
        render: (o) =>
          cell(
            o,
            (e) =>
              `${formatDateShort(e.check_in)} to ${formatDateShort(e.check_out)}, ${counted(e.nights, 'night')}`,
          ),
      },
      {
        label: 'Rooms',
        render: (o) =>
          cell(o, (e, r) =>
            e.offered_rooms < e.requested_rooms
              ? `${e.offered_rooms} of ${e.requested_rooms} ${roomTypeLabel(r.room_type)}`
              : `${counted(e.offered_rooms, 'room')}, ${roomTypeLabel(r.room_type)}`,
          ),
      },
      { label: 'Price', render: (o) => cell(o, (e, r) => describePricing(r, e.totals).text) },
      {
        label: 'Room charges',
        render: (o) => cell(o, (e) => <Money value={e.totals.room_revenue_inr} />),
      },
      {
        label: 'Extras charged separately',
        render: (o) => cell(o, (e) => <Money value={e.totals.inclusions_revenue_inr} />),
      },
      {
        label: 'Total for the client',
        strong: true,
        render: (o) => cell(o, (e) => <Money value={clientTotal(e.totals)} />),
      },
      {
        label: 'Contribution (internal)',
        render: (o) => cell(o, (e) => <Money value={e.totals.contribution_inr} />),
      },
      {
        label: 'Held until, if issued now',
        render: (o) => (o.validUntil ? formatIst(o.validUntil) : o.evaluation ? 'No hold' : '—'),
      },
    ];

  return (
    <Card title="Compare the options">
      <p className="mb-4 text-sm text-ink-muted">
        Both are priced by the server and nothing is held yet. Choose the one to issue; the other is
        discarded.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] border-collapse text-sm">
          <caption className="sr-only">The options side by side</caption>
          <thead>
            <tr className="border-b border-border">
              <td />
              {options.map((o) => (
                <th
                  key={o.label}
                  scope="col"
                  className="px-3 py-2 text-left text-base font-semibold"
                >
                  {o.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b border-border align-top">
                <th scope="row" className="py-2 pr-3 text-left font-normal text-ink-muted">
                  {row.label}
                </th>
                {options.map((o) => (
                  <td
                    key={o.label}
                    className={row.strong ? 'px-3 py-2 text-base font-bold' : 'px-3 py-2'}
                  >
                    {row.render(o)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td />
              {options.map((o, i) => {
                const choosable =
                  o.current && o.evaluation !== undefined && o.evaluation.decision !== 'DECLINE';
                return (
                  <td key={o.label} className="px-3 pt-4">
                    <div className="flex flex-col items-start gap-2">
                      <Button disabled={!choosable} onClick={() => onChoose(i)}>
                        Choose {o.label}
                      </Button>
                      <Button variant="ghost" onClick={() => onEdit(i)}>
                        Edit {o.label}
                      </Button>
                    </div>
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}
