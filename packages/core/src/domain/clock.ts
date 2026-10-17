/**
 * Injected clock (blueprint 11.2). Rules never read the system time directly: services pass a
 * Clock in, so tests can pin "now" and prove expiry deterministically.
 */
export interface Clock {
  /** Current instant as epoch milliseconds (UTC). */
  now(): number;
}

/** The real clock, used by the API and the worker. */
export const systemClock: Clock = Object.freeze({ now: () => Date.now() });

function toMs(instant: string | number): number {
  const ms = typeof instant === 'number' ? instant : Date.parse(instant);
  if (!Number.isFinite(ms)) throw new RangeError(`Not a valid instant: ${String(instant)}`);
  return ms;
}

/** A clock frozen at one instant. */
export function fixedClock(instant: string | number): Clock {
  const ms = toMs(instant);
  return Object.freeze({ now: () => ms });
}

/** A clock tests can move: `advance` to fast-forward past an expiry, `set` to jump. */
export class ManualClock implements Clock {
  private ms: number;

  constructor(instant: string | number) {
    this.ms = toMs(instant);
  }

  now(): number {
    return this.ms;
  }

  set(instant: string | number): void {
    this.ms = toMs(instant);
  }

  advance(by: { hours?: number; minutes?: number; seconds?: number; ms?: number }): void {
    const delta =
      (by.hours ?? 0) * 3_600_000 +
      (by.minutes ?? 0) * 60_000 +
      (by.seconds ?? 0) * 1_000 +
      (by.ms ?? 0);
    if (!Number.isFinite(delta) || delta < 0) throw new RangeError('A clock only moves forward');
    this.ms += delta;
  }
}
