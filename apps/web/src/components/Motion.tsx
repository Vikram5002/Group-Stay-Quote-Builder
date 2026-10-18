import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn';

/** True when the person asked their system for less motion. Safe where matchMedia is missing. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * A number that counts up to its value, and glides when the value changes. With reduced motion
 * (and in tests) it shows the final value straight away.
 */
export function CountUp({
  value,
  format = (n) => String(Math.round(n)),
  duration = 900,
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
}) {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? value : 0));
  const from = useRef(shown);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(value);
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      // Ease out: fast at first, settling gently on the exact value.
      const eased = 1 - Math.pow(1 - p, 4);
      const next = p === 1 ? value : origin + (value - origin) * eased;
      from.current = next;
      setShown(next);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  return <span className="tabular-nums">{format(shown)}</span>;
}

/**
 * A ring showing how much of a period is left, for hold countdowns. Decoration: the text beside
 * it says the same.
 */
export function ProgressRing({
  fraction,
  size = 36,
  stroke = 3.5,
  className,
}: {
  fraction: number;
  size?: number;
  stroke?: number;
  className?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, fraction));
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn('shrink-0 -rotate-90', className)}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.12"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - f)}
        className="c32-ring"
        style={{ ['--c32-ring-from' as string]: String(c) }}
      />
    </svg>
  );
}
