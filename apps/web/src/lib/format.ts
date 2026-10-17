/** Shown wherever a value is null. Unknown is never rendered as 0 or blank. */
export const UNKNOWN_LABEL = 'Unknown';

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

export function formatInr(value: number | null | undefined): string {
  return value === null || value === undefined ? UNKNOWN_LABEL : inr.format(value);
}

export function formatCount(value: number | null | undefined): string {
  return value === null || value === undefined ? UNKNOWN_LABEL : String(value);
}

const ist = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** IST display for a UTC instant, for example "01 Nov 2026, 14:30 IST". */
export function formatIst(utcIso: string | null | undefined): string {
  if (!utcIso) return UNKNOWN_LABEL;
  const date = new Date(utcIso);
  if (Number.isNaN(date.getTime())) return UNKNOWN_LABEL;
  return `${ist.format(date)} IST`;
}

/** Relative countdown such as "2h 05m left" or "Expired". */
export function formatCountdown(utcIso: string, now: Date): string {
  const ms = new Date(utcIso).getTime() - now.getTime();
  if (Number.isNaN(ms)) return UNKNOWN_LABEL;
  if (ms <= 0) return 'Expired';
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h left`;
  return `${hours}h ${String(minutes).padStart(2, '0')}m left`;
}
