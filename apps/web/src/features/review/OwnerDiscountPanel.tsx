import { useState } from 'react';
import type { Quote } from '@c32/core';
import { useApi } from '../../app/ApiProvider';
import { Alert, Button, Card, Money, ProblemAlert, TextField } from '../../components';
import { ApiError } from '../../lib/api';
import { formatStay } from '../../lib/format';
import { counted } from '../../lib/plural';
import { useQuoteAction } from '../quotes/queries';
import { ArithmeticTrail, TotalsTable } from '../quotes/ResultPanels';
import { StatusBadge } from '../quotes/StatusBadge';

/**
 * The Owner's discount (D-062): the Service Manager sent this quote with no discount, and the
 * Owner sets any whole percent off the full price. The preview uses the same rule as the server
 * (rate = full price x (100 - discount) / 100, rounded up); the server's answer is what is saved.
 */
export function OwnerDiscountPanel({
  quote,
  onDone,
}: {
  quote: Quote;
  onDone: (saved: Quote) => void;
}) {
  const api = useApi();
  const id = quote.quote_id;
  const apply = useQuoteAction<{ discount_pct: number; reason?: string }>(id, (input, o) =>
    api.ownerDiscount(id, input, o),
  );
  const [pctText, setPctText] = useState('0');
  const [reason, setReason] = useState('');

  const pct = Number(pctText);
  const valid = pctText.trim() !== '' && Number.isInteger(pct) && pct >= 0 && pct <= 100;
  const t = quote.evaluation.totals;
  const fullRate = t.floor_rate_per_room_night_inr;
  const rate = valid ? Math.ceil((fullRate * (100 - pct)) / 100) : null;
  const roomRevenue = rate === null ? null : rate * t.room_nights;
  const total =
    roomRevenue === null || t.inclusions_revenue_inr === null
      ? null
      : roomRevenue + t.inclusions_revenue_inr;
  const cost =
    t.variable_cost_inr === null || t.inclusions_cost_inr === null
      ? null
      : t.variable_cost_inr + t.inclusions_cost_inr;
  const contribution = total === null || cost === null ? null : total - cost;
  const belowFloor =
    contribution !== null &&
    t.contribution_floor_inr !== null &&
    contribution < t.contribution_floor_inr;
  const error = apply.error instanceof ApiError ? apply.error : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-bold">{quote.request.organiser.name}</h2>
          <StatusBadge status={quote.status} />
        </div>
        <p className="mt-1 text-sm text-ink-muted">
          Sent by {quote.created_by.user_id} ·{' '}
          {formatStay(quote.evaluation.check_in, quote.evaluation.check_out)} ·{' '}
          {counted(quote.evaluation.offered_rooms, 'room')} · {counted(t.room_nights, 'room-night')}
        </p>
      </div>

      {quote.request.note_for_owner && (
        <Card title={`Note from ${quote.created_by.user_id}`}>
          <p className="whitespace-pre-line text-sm">{quote.request.note_for_owner}</p>
        </Card>
      )}

      <Card title="Your discount">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Discount (%)"
            inputMode="numeric"
            value={pctText}
            onChange={(e) => setPctText(e.target.value)}
            hint="Any whole percent from 0 to 100, off the full price. No Reception limit applies."
            {...(valid ? {} : { error: 'Enter a whole number from 0 to 100.' })}
          />
          <TextField
            label="Note (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            hint="Recorded in the audit trail."
          />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-ink-muted">Full price per room-night</dt>
            <dd className="font-semibold">
              <Money value={fullRate} />
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted">Rate after discount</dt>
            <dd className="font-semibold">
              <Money value={rate} />
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted">Total for the client</dt>
            <dd className="font-semibold">
              <Money value={total} />
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted">Contribution</dt>
            <dd className="font-semibold">
              <Money value={contribution} />
            </dd>
          </div>
        </dl>
        {belowFloor && (
          <div className="mt-4">
            <Alert tone="warning" title="Below the contribution floor">
              This price is under the floor of <Money value={t.contribution_floor_inr} />. As the
              Owner you can still issue it.
            </Alert>
          </div>
        )}
        {error && (
          <div className="mt-4">
            <ProblemAlert error={error} title="Could not apply the discount" />
          </div>
        )}
        <div className="mt-4">
          <Button
            disabled={!valid}
            loading={apply.isPending}
            onClick={() =>
              apply.mutate(
                { discount_pct: pct, ...(reason.trim() ? { reason: reason.trim() } : {}) },
                { onSuccess: onDone },
              )
            }
          >
            Apply discount and issue quote
          </Button>
        </div>
      </Card>

      <TotalsTable totals={t} />
      <ArithmeticTrail trail={quote.evaluation.trail} />
    </div>
  );
}
