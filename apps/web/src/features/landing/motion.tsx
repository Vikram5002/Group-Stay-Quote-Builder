import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ElementType, PointerEvent, ReactNode } from 'react';
import { Unknown } from '../../components';

/** True when the person asked their system for less motion. Safe where matchMedia is missing. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}

/** Reports once when the element has scrolled into view. Without IntersectionObserver it is simply "seen". */
export function useSeen<T extends HTMLElement>(threshold = 0.15) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(
    () => typeof IntersectionObserver === 'undefined' || prefersReducedMotion(),
  );
  useEffect(() => {
    if (seen) return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { threshold },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [seen, threshold]);
  return [ref, seen] as const;
}

/** Fades and lifts its content in when it scrolls into view. */
export function Reveal({
  children,
  delay = 0,
  as: Tag = 'div',
  className = '',
}: {
  children: ReactNode;
  /** Milliseconds, so neighbours can arrive one after another. */
  delay?: number;
  as?: ElementType;
  className?: string;
}) {
  const [ref, seen] = useSeen<HTMLElement>();
  return (
    <Tag
      ref={ref}
      data-in={seen}
      className={`lp-reveal ${className}`}
      style={{ '--d': `${delay}ms` } as CSSProperties}
    >
      {children}
    </Tag>
  );
}

/** Counts up to `target` once `active` turns true. Shows the final value at once when motion is reduced. */
export function useCountUp(target: number, active: boolean, duration = 1200): number {
  const [value, setValue] = useState(() => (prefersReducedMotion() ? target : 0));
  useEffect(() => {
    if (!active) return;
    if (prefersReducedMotion() || typeof requestAnimationFrame === 'undefined') {
      setValue(target);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      setValue(Math.round(target * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, active, duration]);
  return value;
}

/**
 * A number that glides to its new value when it changes. It starts at its final value on first
 * paint (no count from zero), and while it is moving the digits are hidden from screen readers,
 * which get the final value instead of a blur of numbers.
 */
export function useGlide(target: number, duration = 550): { shown: number; moving: boolean } {
  const [shown, setShown] = useState(target);
  const [moving, setMoving] = useState(false);
  const from = useRef(target);
  useEffect(() => {
    if (shown === target) return;
    if (prefersReducedMotion() || typeof requestAnimationFrame === 'undefined') {
      from.current = target;
      setShown(target);
      return;
    }
    const start = performance.now();
    const begin = from.current;
    let frame = 0;
    setMoving(true);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      const value = Math.round(begin + (target - begin) * eased);
      from.current = value;
      setShown(value);
      if (t < 1) frame = requestAnimationFrame(tick);
      else setMoving(false);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // `shown` is deliberately left out of the dependencies: it is what this effect updates.
  }, [target, duration]);
  return { shown, moving };
}

/** Rupees that glide between values. A null value is shown as Unknown, never as zero. */
export function GlideMoney({ value }: { value: number | null }) {
  const { shown, moving } = useGlide(value ?? 0);
  if (value === null) return <Unknown />;
  const text = (n: number) => `${n < 0 ? '-' : ''}₹${Math.abs(n).toLocaleString('en-IN')}`;
  if (!moving) return <span>{text(value)}</span>;
  return (
    <>
      <span aria-hidden="true">{text(shown)}</span>
      <span className="sr-only">{text(value)}</span>
    </>
  );
}

const BURST_COLOURS = ['#101319', '#5c98f7', '#7ccf9a', '#f0a868', '#9f80f8'];

/** A small burst of dots, fired each time `fire` changes (and is above zero). Purely decorative. */
export function Burst({ fire }: { fire: number }) {
  if (fire === 0 || prefersReducedMotion()) return null;
  return (
    <span
      key={fire}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-visible"
    >
      {Array.from({ length: 16 }, (_, i) => {
        const angle = (i / 16) * Math.PI * 2 + (i % 2) * 0.2;
        const distance = 70 + (i % 4) * 26;
        return (
          <span
            key={i}
            className="lp-particle"
            style={
              {
                '--x': `${Math.cos(angle) * distance}px`,
                '--y': `${Math.sin(angle) * distance}px`,
                '--c': BURST_COLOURS[i % BURST_COLOURS.length],
                animationDelay: `${(i % 3) * 40}ms`,
              } as CSSProperties
            }
          />
        );
      })}
    </span>
  );
}

/** Pointer handler for a group of cards: each card gets a soft light that follows the pointer. */
export function spotlight(e: PointerEvent<HTMLElement>) {
  if (prefersReducedMotion()) return;
  const card = (e.target as Element).closest<HTMLElement>('.lp-spot');
  if (!card) return;
  const box = card.getBoundingClientRect();
  card.style.setProperty('--cx', `${e.clientX - box.left}px`);
  card.style.setProperty('--cy', `${e.clientY - box.top}px`);
}

/** Current vertical scroll position, updated at most once per frame. */
export function useScrollY(): number {
  const [y, setY] = useState(0);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setY(window.scrollY));
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', update);
    };
  }, []);
  return y;
}
