import { toEpochDay } from './calendar.js';

/**
 * Time zone helpers on top of the runtime's IANA database (Intl), so core needs no date library
 * (blueprint 5.2, G13). Instants are UTC epoch milliseconds; calendar dates are property-local.
 */

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Offset of `timeZone` from UTC at `instantMs`, in whole minutes (IST is +330). */
export function zoneOffsetMinutes(instantMs: number, timeZone: string): number {
  const parts = new Map<string, number>();
  for (const p of formatterFor(timeZone).formatToParts(new Date(instantMs))) {
    if (p.type !== 'literal') parts.set(p.type, Number(p.value));
  }
  const part = (type: string): number => {
    const v = parts.get(type);
    if (v === undefined) throw new Error(`Intl did not return "${type}" for ${timeZone}`);
    return v;
  };
  const asIfUtc = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  const wholeSeconds = Math.floor(instantMs / 1000) * 1000;
  return Math.round((asIfUtc - wholeSeconds) / MS_PER_MINUTE);
}

/**
 * The UTC instant at which local calendar day `isoDate` starts in `timeZone`. Two passes cover
 * zones whose offset changes near midnight (DST); IST has a fixed offset.
 */
export function startOfDayUtc(isoDate: string, timeZone: string): number {
  const localMidnightAsUtc = toEpochDay(isoDate) * MS_PER_DAY;
  let guess = localMidnightAsUtc - zoneOffsetMinutes(localMidnightAsUtc, timeZone) * MS_PER_MINUTE;
  guess = localMidnightAsUtc - zoneOffsetMinutes(guess, timeZone) * MS_PER_MINUTE;
  return guess;
}

/** Local calendar date of an instant in `timeZone`. */
export function localDate(instantMs: number, timeZone: string): string {
  const offset = zoneOffsetMinutes(instantMs, timeZone);
  return new Date(instantMs + offset * MS_PER_MINUTE).toISOString().slice(0, 10);
}

/** ISO instant with the zone's offset, for display: "2026-10-20T10:00:00+05:30". */
export function formatInZone(instantMs: number, timeZone: string): string {
  const offset = zoneOffsetMinutes(instantMs, timeZone);
  const local = new Date(instantMs + offset * MS_PER_MINUTE).toISOString().slice(0, 19);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${local}${sign}${hh}:${mm}`;
}

/** Canonical UTC form for storage: "2026-10-20T04:30:00.000Z". */
export function toUtcIso(instantMs: number): string {
  return new Date(instantMs).toISOString();
}
