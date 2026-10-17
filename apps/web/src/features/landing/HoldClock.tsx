import { useEffect, useId, useState } from 'react';
import { IconBed, IconClock } from './icons';
import { Burst, Reveal } from './motion';
import { Section } from './Section';

/** The default validity window in the policy: a quote holds its rooms for 72 hours. */
const WINDOW_HOURS = 72;
const ROOMS = 10;
const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

type Phase = 'open' | 'held' | 'confirmed' | 'expired';

function remaining(hours: number): string {
  const left = Math.max(0, WINDOW_HOURS - hours);
  const d = Math.floor(left / 24);
  const h = left % 24;
  return d > 0 ? `${d}d ${h}h left` : `${h}h left`;
}

const ROOM_STYLE: Record<'free' | 'held' | 'confirmed', string> = {
  free: 'bg-success-soft text-success',
  held: 'bg-warning-soft text-warning',
  confirmed: 'bg-info-soft text-info',
};

const ROOM_LABEL: Record<'free' | 'held' | 'confirmed', string> = {
  free: 'Free',
  held: 'Held',
  confirmed: 'Booked',
};

const PHASE_STORY: Record<Phase, { title: string; text: string }> = {
  open: {
    title: 'Nothing held yet',
    text: 'Ten rooms are free. Issue the quote and StayQuote holds all ten for the whole stay, or none.',
  },
  held: {
    title: 'Quote issued: rooms are held',
    text: 'The rooms are reserved for this quote only, and the clock is running. Drag time forward, or confirm.',
  },
  confirmed: {
    title: 'Confirmed: the rooms are booked',
    text: 'Confirming stops the clock. The rooms move from held to booked and cannot be sold twice.',
  },
  expired: {
    title: 'Expired: the rooms were released',
    text: 'Nobody had to remember to free them. The hold ended on its own and the rooms can be sold again.',
  },
};

export function HoldClock() {
  const [phase, setPhase] = useState<Phase>('open');
  const [hours, setHours] = useState(0);
  const [flipKey, setFlipKey] = useState(0);
  const sliderId = useId();
  const [running, setRunning] = useState(false);
  const [confirmBurst, setConfirmBurst] = useState(0);

  const state: 'free' | 'held' | 'confirmed' =
    phase === 'held' ? 'held' : phase === 'confirmed' ? 'confirmed' : 'free';
  const progress = phase === 'held' ? 1 - hours / WINDOW_HOURS : phase === 'confirmed' ? 1 : 0;
  const urgent = phase === 'held' && hours >= WINDOW_HOURS * 0.75;
  const ringColor =
    phase === 'confirmed' ? 'var(--color-info)' : urgent ? 'var(--color-danger)' : 'var(--lp-ink)';

  function move(next: Phase, nextHours = hours) {
    setPhase(next);
    setHours(nextHours);
    setFlipKey((k) => k + 1);
  }

  function slide(value: number) {
    if (value >= WINDOW_HOURS) move('expired', WINDOW_HOURS);
    else setHours(value);
  }

  // "Run the clock" moves time forward by itself until the quote expires.
  useEffect(() => {
    if (!running || phase !== 'held') return;
    const timer = setInterval(() => setHours((h) => Math.min(WINDOW_HOURS, h + 1)), 100);
    return () => clearInterval(timer);
  }, [running, phase]);
  useEffect(() => {
    if (phase === 'held' && hours >= WINDOW_HOURS) {
      setRunning(false);
      move('expired', WINDOW_HOURS);
    }
  }, [hours, phase]);
  useEffect(() => {
    if (phase !== 'held') setRunning(false);
  }, [phase]);

  const story = PHASE_STORY[phase];

  return (
    <Section
      id="holds"
      eyebrow="Rooms and time"
      title="A quote is a promise with a deadline."
      lead="Every quote holds real room-nights until it expires, so two quotes can never claim the same room. Play it through: issue, fast-forward, confirm or let it lapse."
      dot="var(--lp-green)"
    >
      <Reveal className="grid items-center gap-8 rounded-[1.5rem] bg-[var(--lp-card)] p-6 md:grid-cols-[14rem_1fr] md:p-10">
        <div className="mx-auto flex flex-col items-center">
          <div className="relative size-48">
            <svg
              viewBox="0 0 120 120"
              className={`size-full -rotate-90 ${urgent ? 'lp-urgent' : ''}`}
              aria-hidden="true"
              focusable="false"
            >
              <circle cx="60" cy="60" r={RADIUS} fill="none" stroke="#fff" strokeWidth="10" />
              <circle
                className="lp-ring"
                cx="60"
                cy="60"
                r={RADIUS}
                fill="none"
                stroke={ringColor}
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={CIRCUMFERENCE * (1 - progress)}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <IconClock className={`size-7 ${urgent ? 'text-danger' : 'lp-muted'}`} />
              <p className="mt-1 text-xl font-semibold tracking-tight tabular-nums">
                {phase === 'held'
                  ? remaining(hours)
                  : phase === 'confirmed'
                    ? 'Stopped'
                    : phase === 'expired'
                      ? 'Expired'
                      : '72h window'}
              </p>
            </div>
          </div>
          {urgent && <p className="mt-2 text-sm font-semibold text-danger">Expiring soon</p>}
        </div>

        <div>
          <div role="status" aria-live="polite">
            <p className="lp-h3 text-2xl">{story.title}</p>
            <p className="lp-muted mt-1">{story.text}</p>
          </div>

          <div className="relative mt-5">
            <Burst fire={confirmBurst} />
            <ul className="grid grid-cols-5 gap-2 sm:grid-cols-10" aria-label="Ten rooms">
              {Array.from({ length: ROOMS }, (_, i) => (
                <li
                  key={`${flipKey}-${i}`}
                  style={{ animationDelay: `${i * 40}ms` }}
                  className={`${flipKey > 0 ? 'lp-pop' : ''} flex aspect-square flex-col items-center justify-center rounded-xl text-[0.65rem] font-semibold transition-colors ${ROOM_STYLE[state]}`}
                >
                  <IconBed className="size-5" />
                  <span>{ROOM_LABEL[state]}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-6 flex flex-wrap items-end gap-3">
            <button
              type="button"
              disabled={phase !== 'open' && phase !== 'expired'}
              onClick={() => move('held', 0)}
              className="lp-btn disabled:cursor-not-allowed disabled:opacity-40"
            >
              Issue the quote
            </button>
            <button
              type="button"
              disabled={phase !== 'held'}
              onClick={() => {
                move('confirmed');
                setConfirmBurst((n) => n + 1);
              }}
              className="lp-btn-outline disabled:cursor-not-allowed disabled:opacity-40"
            >
              Confirm it
            </button>
            <button
              type="button"
              disabled={phase !== 'held'}
              onClick={() => setRunning((r) => !r)}
              className="lp-btn-outline disabled:cursor-not-allowed disabled:opacity-40"
            >
              {running ? 'Pause the clock' : 'Run the clock'}
            </button>
            <button
              type="button"
              disabled={phase === 'open'}
              onClick={() => move('open', 0)}
              className="min-h-11 rounded-full px-4 text-sm font-medium underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-40"
            >
              Start over
            </button>
            <div className="min-w-48 flex-1">
              <label htmlFor={sliderId} className="text-sm font-medium">
                Fast-forward time
              </label>
              <input
                id={sliderId}
                type="range"
                min={0}
                max={WINDOW_HOURS}
                step={1}
                value={hours}
                disabled={phase !== 'held'}
                onChange={(e) => slide(Number(e.target.value))}
                aria-valuetext={`${hours} of ${WINDOW_HOURS} hours`}
                className="h-11 w-full cursor-pointer accent-[var(--lp-ink)] disabled:cursor-not-allowed disabled:opacity-40"
              />
            </div>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
