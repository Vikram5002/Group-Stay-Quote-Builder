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

const count = new Intl.NumberFormat('en-IN');

export function formatCount(value: number | null | undefined): string {
  return value === null || value === undefined ? UNKNOWN_LABEL : count.format(value);
}

/** A calendar date (YYYY-MM-DD, already in the property time zone), read as UTC so it never shifts. */
function calendarDate(iso: string): Date | null {
  const date = new Date(`${iso}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && !Number.isNaN(date.getTime()) ? date : null;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const dayMonth = (date: Date) =>
  `${WEEKDAYS[date.getUTCDay()]} ${String(date.getUTCDate()).padStart(2, '0')} ${MONTHS[date.getUTCMonth()]}`;

/** "Sun 01 Nov 2026" for a calendar date. Anything that is not one is shown as it is. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return UNKNOWN_LABEL;
  const date = calendarDate(iso);
  return date ? `${dayMonth(date)} ${date.getUTCFullYear()}` : iso;
}

/** "Sun 01 Nov" for a calendar date, where the year is clear from the context. */
export function formatDateShort(iso: string): string {
  const date = calendarDate(iso);
  return date ? dayMonth(date) : iso;
}

/** "Sun 01 Nov 2026 to Tue 03 Nov 2026" */
export function formatStay(checkIn: string, checkOut: string): string {
  return `${formatDate(checkIn)} to ${formatDate(checkOut)}`;
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
