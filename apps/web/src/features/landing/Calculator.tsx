import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { flatNights, price } from '@c32/core';
import { ContributionMeter, Unknown } from '../../components';
import { formatInr } from '../../lib/format';
import { IconAlert, IconCheck, IconQuestion, IconScale } from './icons';
import { Burst, GlideMoney, Reveal } from './motion';
import {
  SAMPLE_CHECK_IN,
  SAMPLE_COST,
  SAMPLE_FLOOR,
  SAMPLE_MAX_DISCOUNT,
  SAMPLE_ROOMS,
} from './sample';
import { Section } from './Section';

interface Inputs {
  rooms: number;
  nights: number;
  rate: number;
  /** Breakfast is offered but its cost has not been entered. Unknown stays unknown. */
  breakfastCostUnknown: boolean;
}

type Decision = 'OFFER' | 'PARTIAL_OFFER' | 'REVIEW';

const PRESETS: Array<{ label: string; inputs: Inputs }> = [
  {
    label: 'The sample booking',
    inputs: { rooms: 10, nights: 2, rate: 2000, breakfastCostUnknown: false },
  },
  {
    label: '10% discount',
    inputs: { rooms: 10, nights: 2, rate: 1800, breakfastCostUnknown: false },
  },
  {
    label: '15% discount',
    inputs: { rooms: 10, nights: 2, rate: 1700, breakfastCostUnknown: false },
  },
  {
    label: 'Too many rooms',
    inputs: { rooms: 12, nights: 2, rate: 2000, breakfastCostUnknown: false },
  },
  {
    label: 'Breakfast cost unknown',
    inputs: { rooms: 10, nights: 2, rate: 2000, breakfastCostUnknown: true },
  },
];

/** The same rules as the product: unknown or below-floor goes to review; short on rooms is partial. */
function evaluate(inputs: Inputs) {
  const offered = Math.min(inputs.rooms, SAMPLE_ROOMS);
  const result = price({
    rooms: offered,
    nights: flatNights(SAMPLE_CHECK_IN, inputs.nights, inputs.rate, SAMPLE_COST),
    floor: {
      contribution_floor_inr: SAMPLE_FLOOR,
      total_rooms_units: SAMPLE_ROOMS,
      max_sales_discount_pct: SAMPLE_MAX_DISCOUNT,
    },
    extras: { revenue_inr: 0, cost_inr: inputs.breakfastCostUnknown ? null : 0 },
  });
  const reasons: string[] = [];
  if (result.totals.contribution_inr === null) {
    reasons.push('A cost is unknown, so the margin cannot be checked.');
  } else if (result.floor_ok === false) {
    reasons.push('Contribution is below the contribution floor.');
  }
  const short = inputs.rooms - offered;
  let decision: Decision = 'OFFER';
  if (reasons.length > 0) decision = 'REVIEW';
  else if (short > 0) decision = 'PARTIAL_OFFER';
  return { offered, short, result, reasons, decision };
}

const VIEW: Record<
  Decision,
  {
    title: string;
    tone: string;
    icon: typeof IconCheck;
    line: (short: number, offered: number) => string;
  }
> = {
  OFFER: {
    title: 'Ready to offer',
    tone: 'bg-success-soft text-success',
    icon: IconCheck,
    line: () => 'It meets your minimum, so it can be confirmed without approval.',
  },
  PARTIAL_OFFER: {
    title: 'Partial offer',
    tone: 'bg-info-soft text-info',
    icon: IconAlert,
    line: (short, offered) =>
      `Only ${offered} rooms are free on every night. You are ${short} short, so the quote holds ${offered} and never more.`,
  },
  REVIEW: {
    title: 'Service Manager review required',
    tone: 'bg-warning-soft text-warning',
    icon: IconAlert,
    line: () => 'It cannot be confirmed automatically. A Service Manager must approve it first.',
  },
};

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format: (n: number) => string;
  onChange: (n: number) => void;
}) {
  const id = useId();
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <output htmlFor={id} className="lp-big text-2xl">
          {format(value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-11 w-full cursor-pointer accent-[var(--lp-ink)]"
      />
    </div>
  );
}

export function Calculator() {
  const [inputs, setInputs] = useState<Inputs>(PRESETS[0]?.inputs as Inputs);
  const [active, setActive] = useState(0);
  const { offered, short, result, reasons, decision } = useMemo(() => evaluate(inputs), [inputs]);
  const t = result.totals;

  // A small celebration when a quote that needed review becomes a clean offer.
  const [burst, setBurst] = useState(0);
  const previous = useRef(decision);
  useEffect(() => {
    if (decision === 'OFFER' && previous.current !== 'OFFER') setBurst((n) => n + 1);
    previous.current = decision;
  }, [decision]);
  const view = VIEW[decision];
  const Icon = view.icon;
  const minRate = t.min_rate_per_room_night_inr;
  const set = (changes: Partial<Inputs>) => {
    setInputs((i) => ({ ...i, ...changes }));
    setActive(-1);
  };

  return (
    <Section
      id="try"
      eyebrow="A simple example"
      title="Know what the numbers say before you negotiate."
      lead="Suppose a customer requests 10 rooms for two nights at ₹2,000 a room per night. Now suppose they ask for a discount. Move the numbers and see what it does to your booking."
      dot="var(--lp-blue)"
    >
      <div className="flex flex-wrap gap-2" role="group" aria-label="Example requests">
        {PRESETS.map((p, i) => (
          <button
            key={p.label}
            type="button"
            aria-pressed={active === i}
            onClick={() => {
              setInputs(p.inputs);
              setActive(i);
            }}
            className={`min-h-11 rounded-full px-5 text-sm font-medium transition-colors ${
              active === i
                ? 'bg-[var(--lp-ink)] text-white'
                : 'bg-white ring-1 ring-[var(--lp-line)] hover:bg-[var(--lp-bg)]'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[24rem_1fr]">
        <Reveal className="lp-card flex flex-col gap-5">
          <Slider
            label="Rooms requested"
            value={inputs.rooms}
            min={1}
            max={20}
            format={(n) => `${n}`}
            onChange={(rooms) => set({ rooms })}
          />
          <Slider
            label="Length of stay"
            value={inputs.nights}
            min={1}
            max={7}
            format={(n) => `${n} night${n === 1 ? '' : 's'}`}
            onChange={(nights) => set({ nights })}
          />
          <Slider
            label="Rate per room per night"
            value={inputs.rate}
            min={1000}
            max={3000}
            step={50}
            format={(n) => formatInr(n)}
            onChange={(rate) => set({ rate })}
          />
          <div className="border-t border-[var(--lp-line)] pt-4">
            <p className="lp-muted text-sm">Total room revenue</p>
            <p className="lp-big mt-1">
              <GlideMoney value={t.room_revenue_inr} />
            </p>
          </div>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={inputs.breakfastCostUnknown}
              onChange={(e) => set({ breakfastCostUnknown: e.target.checked })}
              className="mt-0.5 size-5 accent-[var(--lp-ink)]"
            />
            <span>
              <span className="font-medium">Add breakfast, cost not entered yet</span>
              <span className="lp-muted block">StayQuote will not guess it as zero.</span>
            </span>
          </label>
          <p className="lp-muted rounded-2xl bg-white p-3 text-sm">
            10 rooms are free on both nights. Ask for more and the quote holds only what exists.
          </p>
        </Reveal>

        <Reveal delay={100} className="flex flex-col gap-4">
          <div className="relative">
            <div
              key={decision}
              role="status"
              className={`lp-pop flex items-start gap-3 rounded-2xl p-5 ${view.tone}`}
            >
              <span className="mt-0.5 shrink-0">
                <Icon />
              </span>
              <div>
                <p className="text-lg font-semibold tracking-tight">{view.title}</p>
                <p className="text-sm text-[var(--lp-ink)]">{view.line(short, offered)}</p>
                {reasons.map((r) => (
                  <p key={r} className="mt-1 text-sm font-medium text-[var(--lp-ink)]">
                    {r}
                  </p>
                ))}
              </div>
            </div>
            <Burst fire={burst} />
          </div>

          <div className="lp-card">
            <ContributionMeter
              contribution={t.contribution_inr}
              floor={SAMPLE_FLOOR}
              max={Math.max(t.room_revenue_inr ?? 0, SAMPLE_FLOOR * 2)}
            />
            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
              {[
                ['Room revenue', t.room_revenue_inr],
                ['Variable cost', t.variable_cost_inr],
                ['Contribution', t.contribution_inr],
                ['Headroom', t.floor_headroom_inr],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <dt className="lp-muted text-sm">{label}</dt>
                  <dd className="lp-big mt-1 text-[1.5rem]">
                    <GlideMoney value={value as number | null} />
                  </dd>
                </div>
              ))}
            </dl>
            {t.contribution_inr === null && (
              <p className="mt-4 flex items-center gap-2 text-sm font-medium">
                <IconQuestion className="size-5 text-unknown" />
                Contribution shows <Unknown /> until the cost is known.
              </p>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="lp-card">
              <p className="flex items-center gap-2 font-semibold">
                <IconScale className="size-5" /> Lowest safe rate
              </p>
              <p className="lp-big mt-3">
                <GlideMoney value={minRate} />
              </p>
              <p className="lp-muted mt-1 text-sm">
                The lowest flat rate a night that still meets your minimum.
              </p>
              {minRate !== null && inputs.rate < minRate && (
                <button
                  type="button"
                  onClick={() => set({ rate: minRate })}
                  className="lp-btn-outline mt-4 text-sm"
                >
                  Use {formatInr(minRate)}
                </button>
              )}
            </div>
            <div className="lp-card">
              <p className="font-semibold">How it was calculated</p>
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
                {result.trail.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ol>
            </div>
          </div>
        </Reveal>
      </div>

      <Reveal className="mt-10 max-w-3xl">
        <p className="text-xl font-medium leading-snug tracking-tight md:text-2xl">
          Don&apos;t just calculate what the customer pays.{' '}
          <span className="lp-muted">
            Understand what the booking contributes to your business.
          </span>
        </p>
        <p className="lp-muted mt-4 text-sm">
          Illustrative example. Actual contribution depends on your property&apos;s costs, charges
          and booking terms. Here the sample uses a variable cost of ₹800 per room per night and a
          minimum contribution of ₹20,000 for the booking.
        </p>
      </Reveal>
    </Section>
  );
}
