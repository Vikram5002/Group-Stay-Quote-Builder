import { REASON_DESCRIPTIONS } from '@c32/core';
import type { Decision, Evaluation, QuoteTotals } from '@c32/core';
import {
  Alert,
  Badge,
  Button,
  Card,
  ContributionMeter,
  Count,
  Money,
  Unknown,
} from '../../components';
import { formatInr, formatIst } from '../../lib/format';
import { meterStatus } from './meterStatus';
import { clientTotal } from './pricingText';
import type { ReviewBanner } from './reviewState';
import type { LiveMeterState } from './usePreview';
import { counted } from '../../lib/plural';

const METER_NOTE: Record<LiveMeterState['kind'], string> = {
  start:
    'Fill in the group, dates and rooms. The price against the Sales limit will appear here and update as you change the discount or rate.',
  invalid: 'Enter valid values to see the price check.',
  error: 'The server could not check these values, so no price check is shown.',
  checking: 'Checking with the server…',
  estimate: 'Estimate from your rate. The server confirms it next.',
  server: 'Confirmed by the server.',
};

/**
 * Always-visible contribution meter. Shows Unknown, never zero, when a cost is missing. It says
 * "Confirmed by the server" only for the server's answer to exactly the current form.
 */
export function LiveMeter({ state }: { state: LiveMeterState }) {
  const note = (
    <p className="mt-3 text-xs text-ink-muted" role="status">
      {METER_NOTE[state.kind]}
    </p>
  );
  if (!('totals' in state) || !state.totals) {
    return (
      <Card title="Live price check" aria-busy={state.kind === 'checking' || undefined}>
        {state.kind === 'start' ? (
          <p className="text-sm text-ink-muted">{METER_NOTE.start}</p>
        ) : (
          note
        )}
      </Card>
    );
  }
  const { totals } = state;
  const checking = state.kind === 'checking';
  const status = state.evaluation ? meterStatus(state.evaluation, totals) : null;
  if (state.evaluation?.decision === 'DECLINE') {
    // Nothing is offered, so there is no price to show: say exactly why (which nights, how many).
    const why = state.evaluation.trail.filter((line) => !line.startsWith('decision '));
    return (
      <Card title="Live price check" aria-busy={checking || undefined}>
        <div className={checking ? 'opacity-60' : undefined}>
          {status ? <Badge tone="danger">{status.label}</Badge> : null}
          <ul className="mt-3 flex list-disc flex-col gap-1 pl-5 text-sm">
            {why.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
        {note}
      </Card>
    );
  }
  // What the package would earn at full price: the discount taken back off the contribution.
  const beforeDiscount =
    totals.contribution_inr === null || totals.room_revenue_inr === null
      ? null
      : totals.contribution_inr + (totals.list_revenue_inr - totals.room_revenue_inr);
  return (
    <Card title="Live price check" aria-busy={checking || undefined}>
      <div className={checking ? 'opacity-60' : undefined}>
        {totals.contribution_inr === null || totals.contribution_floor_inr === null ? (
          status?.tone === 'danger' ? (
            // Nothing can be offered, so there is no price to check: say why instead.
            <Badge tone="danger">{status.label}</Badge>
          ) : (
            <p className="text-sm">
              A cost is unknown, so the price cannot be checked yet: the owner reviews it.
            </p>
          )
        ) : (
          <ContributionMeter
            label="Contribution after discount"
            okText="Within the Sales limit"
            belowText="Over the limit: owner review"
            contribution={totals.contribution_inr}
            floor={totals.contribution_floor_inr}
            max={Math.max(beforeDiscount ?? 0, totals.contribution_floor_inr)}
            {...(status ? { status } : {})}
          />
        )}
        <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
          <dt>Total revenue at full price</dt>
          <dd className="font-semibold">
            <Money value={totals.list_revenue_inr} />
          </dd>
          <dt>Contribution before discount</dt>
          <dd className="font-semibold">
            <Money value={beforeDiscount} />
          </dd>
          <dt>Discount (Sales limit {totals.max_discount_pct}%)</dt>
          <dd className="font-semibold">
            {totals.discount_pct === null ? 'Unknown' : `${totals.discount_pct}%`}
          </dd>
          <dt>Revenue after discount</dt>
          <dd className="font-semibold">
            <Money value={totals.room_revenue_inr} />
          </dd>
          <dt>Contribution after discount</dt>
          <dd className="font-semibold">
            <Money value={totals.contribution_inr} />
          </dd>
          <dt>Full price per room-night</dt>
          <dd className="font-semibold">
            <Money value={totals.floor_rate_per_room_night_inr} />
          </dd>
          <dt>Minimum safe rate per room-night</dt>
          <dd className="font-semibold">
            <Money value={totals.min_rate_per_room_night_inr} />
          </dd>
        </dl>
      </div>
      {note}
    </Card>
  );
}

const DECISION_VIEW: Record<
  Decision,
  { tone: 'success' | 'info' | 'warning' | 'danger'; title: (e: Evaluation) => string }
> = {
  OFFER: { tone: 'success', title: () => 'Ready to offer' },
  PARTIAL_OFFER: {
    tone: 'info',
    title: (e) => `Partial offer: ${e.offered_rooms} of ${counted(e.requested_rooms, 'room')}`,
  },
  REVIEW: { tone: 'warning', title: () => 'Owner review required' },
  DECLINE: { tone: 'danger', title: () => 'This request cannot be offered' },
};

export function DecisionSummary({
  evaluation,
  review,
  reviewAction,
  onUseRate,
  useRateLabel = (rate) => `Use rate ${rate}`,
  onUseRooms,
}: {
  evaluation: Evaluation;
  /**
   * A saved quote's current review state (see reviewState.ts). It replaces the evaluation's own
   * title, which only says what the engine found when the quote was issued.
   */
  review?: ReviewBanner | null;
  /** A next step shown in the banner, for example the Owner's link to the review queue. */
  reviewAction?: React.ReactNode;
  /** Offered on the builder only. A saved quote cannot be edited, so these are omitted there. */
  onUseRate?: (rate: number) => void;
  /** The button text for a suggested rate. */
  useRateLabel?: (rate: number) => string;
  onUseRooms?: (rooms: number) => void;
}) {
  const decision = DECISION_VIEW[evaluation.decision];
  const view = review ?? { tone: decision.tone, title: decision.title(evaluation) };
  const partial = evaluation.offered_rooms > 0 && evaluation.shortfall_rooms > 0;
  return (
    <div className="flex flex-col gap-4">
      <Alert tone={view.tone} title={view.title} action={reviewAction}>
        {evaluation.reasons.length > 0 ? (
          <ul className="list-disc pl-5">
            {evaluation.reasons.map((reason) => (
              <li key={reason}>{REASON_DESCRIPTIONS[reason]}</li>
            ))}
          </ul>
        ) : evaluation.auto_confirm_allowed ? (
          'It meets the contribution floor and can be confirmed without approval.'
        ) : undefined}
        {review?.note && <p className="mt-2 font-semibold">{review.note}</p>}
      </Alert>

      {partial && (
        <Card title="Partial offer">
          <p className="text-sm">
            Only {evaluation.offered_rooms} of {counted(evaluation.requested_rooms, 'room')} can be
            held on every night. You are {evaluation.shortfall_rooms} short. The quote will hold{' '}
            {counted(evaluation.offered_rooms, 'room')} and never more than are available.
          </p>
          {onUseRooms && (
            <Button
              variant="secondary"
              className="mt-3"
              onClick={() => onUseRooms(evaluation.offered_rooms)}
            >
              Change the request to {counted(evaluation.offered_rooms, 'room')}
            </Button>
          )}
        </Card>
      )}

      {evaluation.counter_offers.length > 0 && (
        <Card title="Floor-safe alternatives">
          <ul className="flex flex-col gap-3">
            {evaluation.counter_offers.map((offer) => (
              <li
                key={`${offer.type}-${offer.summary}`}
                className="flex flex-wrap items-center justify-between gap-3"
              >
                <span className="text-sm">{offer.summary}</span>
                {onUseRate &&
                  offer.type === 'RAISE_RATE' &&
                  offer.rate_per_room_night_inr !== undefined && (
                    <Button
                      variant="secondary"
                      onClick={() => onUseRate(offer.rate_per_room_night_inr as number)}
                    >
                      {useRateLabel(offer.rate_per_room_night_inr)}
                    </Button>
                  )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right font-semibold tabular-nums">{children}</dd>
    </>
  );
}

const TOTALS_GRID = 'grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-sm';

/** The totals in two parts: what the client pays, then the hotel's own check (never sent out). */
export function TotalsTable({ totals }: { totals: QuoteTotals }) {
  return (
    <Card title="Totals">
      <h3 className="mb-2 text-sm font-semibold">What the client pays</h3>
      <dl className={TOTALS_GRID}>
        <Row label="Room-nights">
          <Count value={totals.room_nights} />
        </Row>
        <Row
          label={`Full price (${totals.room_nights} room-nights x ${formatInr(totals.floor_rate_per_room_night_inr)})`}
        >
          <Money value={totals.list_revenue_inr} />
        </Row>
        <Row label={`Discount${totals.discount_pct === null ? '' : ` (${totals.discount_pct}%)`}`}>
          {totals.room_revenue_inr === null ? (
            <Money value={null} />
          ) : (
            <>
              - <Money value={totals.list_revenue_inr - totals.room_revenue_inr} />
            </>
          )}
        </Row>
        <Row label="Room revenue after discount">
          <Money value={totals.room_revenue_inr} />
        </Row>
        <Row label="Inclusions revenue">
          <Money value={totals.inclusions_revenue_inr} />
        </Row>
        <Row label="Total for the client">
          <Money value={clientTotal(totals)} />
        </Row>
      </dl>
      <h3 className="mt-5 mb-2 border-t border-border pt-4 text-sm font-semibold">
        Hotel check (internal, not on the quotation)
      </h3>
      <dl className={TOTALS_GRID}>
        <Row label="Variable cost">
          <Money value={totals.variable_cost_inr} />
        </Row>
        <Row label="Inclusions cost">
          <Money value={totals.inclusions_cost_inr} />
        </Row>
        <Row label="Contribution">
          <Money value={totals.contribution_inr} />
        </Row>
        <Row label="Floor rate per room-night (cost included)">
          <Money value={totals.floor_rate_per_room_night_inr} />
        </Row>
        <Row label="Contribution floor">
          <Money value={totals.contribution_floor_inr} />
        </Row>
        <Row label="Headroom">
          <Money value={totals.floor_headroom_inr} />
        </Row>
        <Row label="Shortfall">
          <Money value={totals.shortfall_inr} />
        </Row>
        <Row label="Margin">
          {totals.contribution_margin_pct === null ? (
            <Unknown />
          ) : (
            `${totals.contribution_margin_pct}%`
          )}
        </Row>
        <Row label="Minimum safe rate per room-night">
          <Money value={totals.min_rate_per_room_night_inr} />
        </Row>
      </dl>
    </Card>
  );
}

export function ArithmeticTrail({ trail }: { trail: readonly string[] }) {
  if (trail.length === 0) return null;
  return (
    <Card title="How this was calculated">
      <ol className="list-decimal pl-5 text-sm">
        {trail.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
    </Card>
  );
}

export function ValidUntil({ instant }: { instant: string | null }) {
  if (instant === null) return <Badge tone="neutral">No hold is taken</Badge>;
  return (
    <p className="text-sm">
      Held until{' '}
      <time dateTime={instant} title={`UTC: ${instant}`}>
        {formatIst(instant)}
      </time>{' '}
      if issued now.
    </p>
  );
}
