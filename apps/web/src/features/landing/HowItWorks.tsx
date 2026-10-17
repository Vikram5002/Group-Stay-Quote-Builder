import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { IconArrowRight, IconCheck } from './icons';
import { prefersReducedMotion, Reveal } from './motion';
import { SAMPLE, SAMPLE_MIN_CONTRIBUTION, contributionAt, rupees } from './sample';
import { Section } from './Section';

interface Step {
  id: string;
  number: string;
  title: string;
  text: string;
  visual: ReactNode;
}

function EnterVisual() {
  const rows: Array<[string, string]> = [
    ['Check-in', '1 Nov 2026'],
    ['Check-out', '3 Nov 2026'],
    ['Room type', 'Standard'],
    ['Number of rooms', '10'],
    ['Proposed rate', '₹2,500 per room per night'],
  ];
  return (
    <div className="space-y-2" aria-hidden="true">
      {rows.map(([k, v], i) => (
        <div
          key={k}
          className="lp-pop flex items-center justify-between rounded-2xl bg-white px-4 py-3 ring-1 ring-[var(--lp-line)]"
          style={{ animationDelay: `${i * 90}ms` }}
        >
          <span className="lp-muted text-sm">{k}</span>
          <span className="font-semibold">
            <span
              className="lp-type"
              style={{ '--n': v.length, '--d': `${i * 420 + 250}ms` } as CSSProperties}
            >
              {v}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

function CheckVisual() {
  const revenue = SAMPLE.totals.room_revenue_inr ?? 1;
  const discounts: Array<[string, number]> = [
    ['No discount', 2500],
    ['10% off', 2250],
    ['20% off', 2000],
    ['25% off', 1875],
  ];
  return (
    <div className="space-y-3" aria-hidden="true">
      <div className="flex gap-2">
        <span className="lp-chip">
          <IconCheck className="size-4 text-success" /> 10 rooms free every night
        </span>
        <span className="lp-chip">Revenue {rupees(SAMPLE.totals.room_revenue_inr)}</span>
      </div>
      {discounts.map(([label, rate], i) => {
        const c = contributionAt(rate) ?? 0;
        const ok = c >= SAMPLE_MIN_CONTRIBUTION;
        return (
          <div key={label} className="lp-pop" style={{ animationDelay: `${i * 110}ms` }}>
            <div className="mb-1 flex justify-between text-sm">
              <span className="font-medium">{label}</span>
              <span className={ok ? 'font-semibold' : 'font-semibold text-danger'}>
                {rupees(c)} {ok ? '' : '· needs approval'}
              </span>
            </div>
            <div className="relative h-2.5 overflow-hidden rounded-full bg-white ring-1 ring-[var(--lp-line)]">
              <div
                className={`h-full origin-left rounded-full ${ok ? 'bg-[var(--lp-ink)]' : 'bg-danger'}`}
                style={{ width: `${(c / revenue) * 100}%`, animation: 'lp-grow 1s ease-out both' }}
              />
              <div
                className="absolute inset-y-0 w-0.5 bg-[var(--lp-blue)]"
                style={{ left: `${(SAMPLE_MIN_CONTRIBUTION / revenue) * 100}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ShareVisual() {
  return (
    <div
      className="lp-pop rounded-2xl bg-white p-5 ring-1 ring-[var(--lp-line)]"
      aria-hidden="true"
    >
      <div className="flex items-center justify-between">
        <p className="font-semibold">Group quotation</p>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-3 py-1 text-xs font-semibold text-success">
          <IconCheck className="size-3.5" /> Ready for the customer
        </span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-y-2.5 text-sm">
        <dt className="lp-muted">Stay</dt>
        <dd className="text-right font-medium">1 to 3 Nov 2026</dd>
        <dt className="lp-muted">Rooms</dt>
        <dd className="text-right font-medium">10 standard</dd>
        <dt className="lp-muted">Total room revenue</dt>
        <dd className="text-right font-medium">{rupees(SAMPLE.totals.room_revenue_inr)}</dd>
        <dt className="lp-muted">Quote valid for</dt>
        <dd className="text-right font-medium">3 days</dd>
      </dl>
      <p className="lp-muted mt-4 rounded-xl bg-[var(--lp-card)] p-3 text-xs">
        Every figure comes with its calculation, so you can explain it to the customer.
      </p>
    </div>
  );
}

const STEPS: Step[] = [
  {
    id: 'enter',
    number: '01',
    title: 'Enter the group booking details',
    text: 'Add the check-in and check-out dates, room requirements, number of rooms and proposed rates.',
    visual: <EnterVisual />,
  },
  {
    id: 'check',
    number: '02',
    title: 'Calculate, check and negotiate',
    text: 'Review availability, total room revenue and the impact of discounts. Identify requests that need an alternative offer or further approval.',
    visual: <CheckVisual />,
  },
  {
    id: 'share',
    number: '03',
    title: 'Review and share your quotation',
    text: 'Prepare a clear quotation for the customer to review, helping you move from enquiry to the next step in the booking process.',
    visual: <ShareVisual />,
  },
];

export function HowItWorks() {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(() => !prefersReducedMotion());

  // Move on every few seconds until the visitor pauses or picks a step themselves.
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % STEPS.length), 6000);
    return () => clearInterval(timer);
  }, [playing]);

  const step = STEPS[index] ?? STEPS[0];
  if (!step) return null;

  return (
    <Section
      id="how"
      eyebrow="How it works"
      title="From enquiry to quotation in three simple steps."
      dot="var(--lp-blue)"
    >
      <Reveal>
        <ol className="grid gap-3 md:grid-cols-3">
          {STEPS.map((s, i) => {
            const on = i === index;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  aria-current={on ? 'step' : undefined}
                  onClick={() => {
                    setIndex(i);
                    setPlaying(false);
                  }}
                  className={`relative w-full overflow-hidden rounded-2xl p-5 text-left transition-colors ${
                    on
                      ? 'bg-[var(--lp-ink)] text-white'
                      : 'bg-[var(--lp-card)] hover:bg-[var(--lp-bg)]'
                  }`}
                >
                  <span className="lp-big block text-4xl">{s.number}</span>
                  <span className="mt-3 block text-lg font-semibold tracking-tight">{s.title}</span>
                  {on && playing && (
                    <span
                      key={`${index}-${playing}`}
                      className="absolute bottom-0 left-0 h-1 w-full origin-left bg-white/60"
                      style={{ animation: 'lp-grow 6s linear both' }}
                      aria-hidden="true"
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ol>

        <div
          key={step.id}
          className="lp-pop mt-4 grid gap-8 rounded-[1.5rem] bg-[var(--lp-card)] p-6 md:grid-cols-2 md:p-10"
        >
          <div className="flex flex-col justify-between gap-6">
            <div>
              <h3 className="lp-h2 text-[2rem]">{step.title}</h3>
              <p className="lp-lead mt-4">{step.text}</p>
            </div>
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              className="lp-btn-outline w-fit text-sm"
            >
              {playing ? 'Pause the tour' : 'Play the tour'}
            </button>
          </div>
          <div className="rounded-2xl bg-white/60 p-4 md:p-6">{step.visual}</div>
        </div>
      </Reveal>

      <Reveal className="mt-10 flex flex-wrap items-center justify-between gap-6">
        <p className="text-2xl font-medium tracking-tight md:text-3xl">
          One workflow. Clearer calculations.{' '}
          <span className="lp-muted">More confident decisions.</span>
        </p>
        <a href="#try" className="lp-btn">
          Try a Sample Group Booking <IconArrowRight className="size-5" />
        </a>
      </Reveal>
    </Section>
  );
}
