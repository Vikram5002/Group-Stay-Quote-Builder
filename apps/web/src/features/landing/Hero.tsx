import { useEffect, useRef } from 'react';
import type { CSSProperties, PointerEvent } from 'react';
import { SignInLink } from './SignInLink';
import { Money } from '../../components';
import {
  IconArrowRight,
  IconCalculator,
  IconCalendar,
  IconCheck,
  IconClock,
  IconFile,
  IconPercent,
  IconScale,
} from './icons';
import { prefersReducedMotion, useCountUp, useSeen } from './motion';
import { SAMPLE } from './sample';

function QuoteCard() {
  const [ref, seen] = useSeen<HTMLDivElement>(0.3);
  const card = useRef<HTMLDivElement>(null);

  // The card leans toward the mouse and settles back when it leaves.
  function onMove(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== 'mouse' || prefersReducedMotion() || !card.current) return;
    const box = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - box.left) / box.width - 0.5;
    const py = (e.clientY - box.top) / box.height - 0.5;
    card.current.dataset['active'] = 'true';
    card.current.style.setProperty('--ry', `${px * 10}deg`);
    card.current.style.setProperty('--rx', `${-py * 8}deg`);
  }
  function onLeave() {
    if (!card.current) return;
    card.current.dataset['active'] = 'false';
    card.current.style.setProperty('--rx', '0deg');
    card.current.style.setProperty('--ry', '0deg');
  }

  const revenue = useCountUp(SAMPLE.totals.room_revenue_inr ?? 0, seen, 1400);
  const contribution = useCountUp(SAMPLE.totals.contribution_inr ?? 0, seen, 1400);

  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      className="relative mx-auto w-full max-w-md"
    >
      <div
        ref={card}
        className="lp-tilt rounded-[1.5rem] bg-white p-6 shadow-[0_30px_60px_-30px_rgb(16_19_25_/_0.35)] ring-1 ring-[var(--lp-line)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="lp-muted text-xs font-medium uppercase tracking-wide">Group quotation</p>
            <p className="mt-1 text-lg font-semibold tracking-tight">Fictional Events Pvt Ltd</p>
          </div>
          <span className="lp-pop inline-flex items-center gap-1.5 rounded-full bg-success-soft px-3 py-1 text-xs font-semibold text-success">
            <IconCheck className="size-4" /> Ready to offer
          </span>
        </div>
        <p className="lp-muted mt-3 text-sm">
          10 rooms · 2 nights from 1 Nov 2026 · ₹2,000 a night
        </p>

        <dl className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-[var(--lp-card)] p-4">
            <dt className="lp-muted text-xs">Room revenue</dt>
            <dd className="lp-big mt-2 text-[1.9rem]">
              <span aria-hidden="true">₹{revenue.toLocaleString('en-IN')}</span>
              <span className="sr-only">
                ₹{(SAMPLE.totals.room_revenue_inr ?? 0).toLocaleString('en-IN')}
              </span>
            </dd>
          </div>
          <div className="rounded-2xl bg-[var(--lp-card)] p-4">
            <dt className="lp-muted text-xs">Contribution</dt>
            <dd className="lp-big mt-2 text-[1.9rem]">
              <span aria-hidden="true">₹{contribution.toLocaleString('en-IN')}</span>
              <span className="sr-only">
                ₹{(SAMPLE.totals.contribution_inr ?? 0).toLocaleString('en-IN')}
              </span>
            </dd>
          </div>
        </dl>

        <div className="mt-5" aria-hidden="true">
          <div className="relative h-2.5 overflow-hidden rounded-full bg-[var(--lp-bg)]">
            <div
              className="h-full rounded-full bg-[var(--lp-ink)] transition-[width] duration-[1400ms] ease-out"
              style={{ width: seen ? '60%' : '0%' }}
            />
            <div className="absolute inset-y-0 w-0.5 bg-[var(--lp-blue)]" style={{ left: '50%' }} />
          </div>
          <div className="lp-muted mt-1.5 flex justify-between text-xs">
            <span>₹0</span>
            <span>Minimum acceptable ₹20,000</span>
          </div>
        </div>
      </div>

      <div
        className="lp-float lp-chip absolute -left-4 -top-5 hidden sm:inline-flex lg:-left-12"
        style={{ '--r': '-4deg', '--fd': '0s' } as CSSProperties}
      >
        <span className="lp-dot" style={{ '--d': 'var(--lp-orange)' } as CSSProperties} />
        <IconClock className="size-4" /> Valid for 2d 23h
      </div>
      <div
        className="lp-float lp-chip absolute -bottom-6 -right-3 hidden sm:inline-flex lg:-right-10"
        style={{ '--r': '3deg', '--fd': '-2s' } as CSSProperties}
      >
        <span className="lp-dot" style={{ '--d': 'var(--lp-green)' } as CSSProperties} />
        <IconScale className="size-4" /> Safe down to{' '}
        <Money value={SAMPLE.totals.min_rate_per_room_night_inr} />
      </div>
      <div
        className="lp-float lp-chip absolute -bottom-6 left-6 hidden lg:inline-flex"
        style={{ '--r': '-2deg', '--fd': '-4s' } as CSSProperties}
      >
        <span className="lp-dot" style={{ '--d': 'var(--color-danger)' } as CSSProperties} />
        At ₹1,700 it needs approval
      </div>
    </div>
  );
}

function Stat({
  value,
  prefix = '',
  caption,
  active,
}: {
  value: number;
  prefix?: string;
  caption: string;
  active: boolean;
}) {
  const shown = useCountUp(value, active);
  return (
    <div>
      <p className="lp-big lp-big--stat">
        <span aria-hidden="true">
          {prefix}
          {shown.toLocaleString('en-IN')}
        </span>
        <span className="sr-only">
          {prefix}
          {value.toLocaleString('en-IN')}
        </span>
      </p>
      <p className="lp-muted mt-1.5 text-sm">{caption}</p>
    </div>
  );
}

const STRIP = [
  [IconCalendar, 'Check room availability'],
  [IconCalculator, 'Calculate group rates'],
  [IconPercent, 'Evaluate discounts'],
  [IconFile, 'Prepare quotations'],
  [IconClock, 'Hold rooms until the quote expires'],
  [IconScale, 'Protect your minimum margin'],
] as const;

function Strip() {
  const items = (hidden: boolean) =>
    STRIP.map(([Icon, label]) => (
      <li
        key={`${label}-${hidden}`}
        className="lp-muted flex items-center gap-2.5 whitespace-nowrap text-lg font-medium"
        {...(hidden ? { 'aria-hidden': true } : {})}
      >
        <Icon className="size-6 text-[var(--lp-ink)]" /> {label}
      </li>
    ));
  return (
    <div
      className="overflow-hidden border-t border-[var(--lp-line)] bg-white py-7"
      role="region"
      aria-label="What StayQuote does"
    >
      <ul className="lp-marquee">
        {items(false)}
        {items(true)}
      </ul>
    </div>
  );
}

/** The headline, one word at a time. Spaces are kept, so it still reads as one sentence. */
function Words({ text }: { text: string }) {
  return (
    <>
      {text.split(' ').map((word, i) => (
        <span key={i}>
          <span className="lp-word" style={{ '--i': i } as CSSProperties}>
            {word}
          </span>{' '}
        </span>
      ))}
    </>
  );
}

const delay = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties;

export function Hero() {
  const root = useRef<HTMLElement>(null);
  const [statsRef, statsSeen] = useSeen<HTMLDivElement>(0.4);

  useEffect(() => {
    const el = root.current;
    if (!el || prefersReducedMotion()) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (window.scrollY < 1400) el.style.setProperty('--sy', String(window.scrollY));
      });
    };
    window.addEventListener('scroll', update, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', update);
    };
  }, []);

  // A soft light follows the pointer. Skipped when motion is reduced.
  function follow(e: PointerEvent<HTMLElement>) {
    if (prefersReducedMotion() || !root.current) return;
    const box = root.current.getBoundingClientRect();
    root.current.style.setProperty('--mx', `${((e.clientX - box.left) / box.width) * 100}%`);
    root.current.style.setProperty('--my', `${((e.clientY - box.top) / box.height) * 100}%`);
  }

  return (
    <>
      <section ref={root} onPointerMove={follow} className="lp-hero" aria-labelledby="hero-title">
        <div className="lp-parallax absolute inset-0 -z-10" aria-hidden="true">
          <div className="lp-blob lp-blob--a" />
          <div className="lp-blob lp-blob--b" />
        </div>
        <div className="mx-auto grid max-w-6xl items-center gap-16 px-4 pb-20 pt-14 md:pt-20 lg:grid-cols-[1.08fr_1fr]">
          <div>
            <p className="lp-chip lp-rise">
              <span className="lp-dot" /> Group quotes for small hotels
            </p>
            <h1 id="hero-title" className="lp-h1 mt-6">
              <Words text="Every group enquiry is a booking opportunity. Don't lose it to a slow quotation." />
            </h1>
            <p className="lp-lead lp-rise mt-6 max-w-xl" style={delay(700)}>
              A customer wants 10 rooms for a family trip. A corporate client needs 15 rooms for two
              nights. A tour operator wants your best rate for a group. You need to check
              availability, calculate the total price, decide how much discount you can offer and
              send a quotation&mdash;quickly.
            </p>
            <p
              className="lp-rise mt-4 max-w-xl text-lg font-semibold tracking-tight"
              style={delay(850)}
            >
              StayQuote helps you bring it all together in one simple workflow.
            </p>
            <p className="lp-lead lp-rise mt-2 max-w-xl" style={delay(950)}>
              Check room availability. Calculate group rates. Evaluate discounts. Prepare quotations
              with greater confidence.
            </p>

            <div className="lp-rise mt-8 flex flex-wrap items-center gap-3" style={delay(1050)}>
              <a href="#try" className="lp-btn lp-shine">
                Try a Group Quote <IconArrowRight className="size-5" />
              </a>
              <SignInLink className="lp-btn-outline">Sign in to the app</SignInLink>
            </div>
            <p className="lp-muted lp-rise mt-3 text-sm" style={delay(1150)}>
              Start with a sample group booking and see how the calculation works.
            </p>

            <div
              ref={statsRef}
              style={delay(1250)}
              className="lp-rise mt-10 grid max-w-2xl grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4"
            >
              <Stat
                active={statsSeen}
                prefix="₹"
                value={SAMPLE.totals.room_revenue_inr ?? 0}
                caption="room revenue, sample booking"
              />
              <Stat
                active={statsSeen}
                prefix="₹"
                value={SAMPLE.totals.contribution_inr ?? 0}
                caption="contribution after costs"
              />
              <Stat
                active={statsSeen}
                prefix="₹"
                value={SAMPLE.totals.min_rate_per_room_night_inr ?? 0}
                caption="lowest safe rate a night"
              />
              <Stat active={statsSeen} value={1} caption="hold from 20 requests for 10 rooms" />
            </div>
          </div>
          <QuoteCard />
        </div>
      </section>
      <Strip />
    </>
  );
}
