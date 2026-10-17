import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { IconArrowRight } from './icons';
import { GlideMoney, Reveal, useCountUp } from './motion';
import { SAMPLE, SAMPLE_MIN_CONTRIBUTION, SAMPLE_RATE, contributionAt, rupees } from './sample';
import { Section } from './Section';

const NIGHTS = ['1 Nov', '2 Nov', '3 Nov', '4 Nov', '5 Nov'];

function AvailabilityVisual() {
  return (
    <div>
      <div className="grid grid-cols-5 gap-2" aria-hidden="true">
        {NIGHTS.map((n, i) => (
          <div
            key={n}
            className="lp-pop rounded-2xl bg-white p-3 text-center ring-1 ring-[var(--lp-line)]"
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <p className="lp-muted text-xs">{n}</p>
            <p className="lp-big mt-1 text-2xl">10</p>
            <p className="lp-muted text-[0.7rem]">free</p>
          </div>
        ))}
      </div>
      <p className="mt-4 rounded-2xl bg-white p-4 text-sm ring-1 ring-[var(--lp-line)]">
        <strong>12 rooms requested, 10 free on every night.</strong> StayQuote flags it as a partial
        offer instead of letting a promise you cannot keep go out.
      </p>
    </div>
  );
}

function PriceVisual() {
  const total = useCountUp(SAMPLE.totals.room_revenue_inr ?? 0, true, 1200);
  const rows = [
    ['Rooms', '10'],
    ['Nights', '2'],
    ['Rate per room per night', rupees(SAMPLE_RATE)],
  ];
  return (
    <div className="space-y-2">
      {rows.map(([k, v], i) => (
        <div
          key={k}
          className="lp-pop flex items-center justify-between rounded-2xl bg-white px-4 py-3 ring-1 ring-[var(--lp-line)]"
          style={{ animationDelay: `${i * 100}ms` }}
        >
          <span className="lp-muted text-sm">{k}</span>
          <span className="font-semibold">{v}</span>
        </div>
      ))}
      <div
        className="lp-pop flex items-center justify-between rounded-2xl bg-[var(--lp-ink)] px-4 py-4 text-white"
        style={{ animationDelay: '300ms' }}
      >
        <span className="text-sm">Total room revenue</span>
        <span className="lp-big text-3xl">
          <span aria-hidden="true">₹{total.toLocaleString('en-IN')}</span>
          <span className="sr-only">{rupees(SAMPLE.totals.room_revenue_inr)}</span>
        </span>
      </div>
    </div>
  );
}

function NegotiateVisual() {
  const [rate, setRate] = useState(2250);
  const options: Array<[string, number]> = [
    ['10% off', 2250],
    ['20% off', 2000],
    ['25% off', 1875],
  ];
  const c = contributionAt(rate);
  const ok = c !== null && c >= SAMPLE_MIN_CONTRIBUTION;
  return (
    <div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Discount to try">
        {options.map(([label, r]) => (
          <button
            key={label}
            type="button"
            aria-pressed={rate === r}
            onClick={() => setRate(r)}
            className={`min-h-11 rounded-full px-5 text-sm font-medium transition-colors ${
              rate === r
                ? 'bg-[var(--lp-ink)] text-white'
                : 'bg-white ring-1 ring-[var(--lp-line)] hover:bg-[var(--lp-bg)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mt-4 rounded-2xl bg-white p-5 ring-1 ring-[var(--lp-line)]" role="status">
        <p className="lp-muted text-sm">
          At ₹{rate.toLocaleString('en-IN')} a room per night, the booking contributes
        </p>
        <p className="lp-big mt-2">
          <GlideMoney value={c} />
        </p>
        <p
          className={`mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ${ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`}
        >
          <span aria-hidden="true">{ok ? '✓' : '✕'}</span>
          {ok
            ? `Meets the ${rupees(SAMPLE_MIN_CONTRIBUTION)} minimum`
            : `Below the ${rupees(SAMPLE_MIN_CONTRIBUTION)} minimum: needs approval`}
        </p>
      </div>
    </div>
  );
}

function QuoteVisual() {
  return (
    <div className="rounded-2xl bg-white p-5 ring-1 ring-[var(--lp-line)]">
      <div className="flex items-center justify-between">
        <p className="font-semibold">Group quotation</p>
        <span className="lp-chip">Valid for 3 days</span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-y-3 text-sm">
        <dt className="lp-muted">Stay</dt>
        <dd className="text-right font-medium">1 to 3 Nov 2026</dd>
        <dt className="lp-muted">Rooms</dt>
        <dd className="text-right font-medium">10 standard</dd>
        <dt className="lp-muted">Rate</dt>
        <dd className="text-right font-medium">{rupees(SAMPLE_RATE)} per room per night</dd>
        <dt className="lp-muted">Total</dt>
        <dd className="text-right text-lg font-semibold">
          {rupees(SAMPLE.totals.room_revenue_inr)}
        </dd>
      </dl>
    </div>
  );
}

interface Tab {
  id: string;
  label: string;
  dot: string;
  title: string;
  text: string;
  visual: ReactNode;
}

const TABS: Tab[] = [
  {
    id: 'availability',
    label: 'Availability',
    dot: 'var(--lp-blue)',
    title: 'Check availability before you commit.',
    text: 'Review the rooms available for the requested dates and identify when the full request cannot be accommodated.',
    visual: <AvailabilityVisual />,
  },
  {
    id: 'price',
    label: 'Pricing',
    dot: 'var(--lp-green)',
    title: 'Calculate the right price.',
    text: 'Work out the quotation using the number of rooms, nights, room rates and applicable charges.',
    visual: <PriceVisual />,
  },
  {
    id: 'negotiate',
    label: 'Negotiation',
    dot: 'var(--lp-orange)',
    title: 'Negotiate with clarity.',
    text: "Evaluate how a proposed discount affects the booking's contribution, so you can make a more informed offer.",
    visual: <NegotiateVisual />,
  },
  {
    id: 'quote',
    label: 'Quotation',
    dot: '#9f80f8',
    title: 'Prepare the quote and move forward.',
    text: 'Review the booking details, pricing and quote validity before sharing the offer with your customer.',
    visual: <QuoteVisual />,
  },
];

export function Introducing() {
  const [index, setIndex] = useState(0);
  const base = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const [marker, setMarker] = useState({ left: 0, top: 0, width: 0, height: 0 });

  // The white marker slides to whichever tab is selected.
  useLayoutEffect(() => {
    const place = () => {
      const el = refs.current[index];
      if (el) {
        setMarker({
          left: el.offsetLeft,
          top: el.offsetTop,
          width: el.offsetWidth,
          height: el.offsetHeight,
        });
      }
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [index]);

  const tab = TABS[index] ?? TABS[0];
  if (!tab) return null;

  function onKey(e: KeyboardEvent<HTMLButtonElement>) {
    const last = TABS.length - 1;
    const next =
      e.key === 'ArrowRight'
        ? (index + 1) % TABS.length
        : e.key === 'ArrowLeft'
          ? (index + last) % TABS.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    setIndex(next);
    refs.current[next]?.focus();
  }

  return (
    <Section
      id="introducing"
      eyebrow="Introducing StayQuote"
      title="Your group booking quotation process, simplified."
      lead="StayQuote is designed to help small hotels prepare group-stay quotations without juggling multiple calculations and manual checks."
      dot="var(--lp-green)"
      tone="grey"
    >
      <Reveal>
        <div
          role="tablist"
          aria-label="What StayQuote helps with"
          className="relative flex flex-wrap gap-1 rounded-2xl bg-[var(--lp-card)] p-1.5 sm:inline-flex"
        >
          <span
            className="lp-tab-marker"
            aria-hidden="true"
            style={{
              left: marker.left,
              top: marker.top,
              width: marker.width,
              height: marker.height,
            }}
          />
          {TABS.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              role="tab"
              id={`${base}-t-${i}`}
              aria-selected={i === index}
              aria-controls={`${base}-p`}
              tabIndex={i === index ? 0 : -1}
              onClick={() => setIndex(i)}
              onKeyDown={onKey}
              className="lp-tab"
            >
              <span className="lp-dot" style={{ '--d': t.dot } as CSSProperties} />
              {t.label}
            </button>
          ))}
        </div>

        <div
          role="tabpanel"
          id={`${base}-p`}
          aria-labelledby={`${base}-t-${index}`}
          key={tab.id}
          className="lp-pop mt-4 grid gap-8 rounded-[1.5rem] bg-white p-6 ring-1 ring-[var(--lp-line)] md:grid-cols-2 md:p-10"
        >
          <div className="flex flex-col justify-between gap-8">
            <div>
              <h3 className="lp-h2 text-[2rem]">{tab.title}</h3>
              <p className="lp-lead mt-4">{tab.text}</p>
            </div>
            <a href="#how" className="lp-btn w-fit">
              See How It Works <IconArrowRight className="size-5" />
            </a>
          </div>
          <div className="rounded-2xl bg-[var(--lp-card)] p-5 md:p-6">{tab.visual}</div>
        </div>
      </Reveal>
    </Section>
  );
}
