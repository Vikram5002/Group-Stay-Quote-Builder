import { LIMITS, parseWith, PolicyUpdateRequest } from '@c32/core';
import type { Policy, ValidationIssue } from '@c32/core';

/** The policy as text, so half-typed numbers stay visible while editing. */
export interface PolicyForm {
  contributionFloor: string;
  totalRooms: string;
  maxDiscount: string;
  hotelName: string;
  /** Blank means none for the three below. */
  hotelAddress: string;
  hotelPhone: string;
  hotelGstin: string;
  validityHours: string;
  stayCutoffHours: string;
  minValidityHours: string;
  minPartialRooms: string;
  /** Blank means unknown (null), never 1. */
  guestsPerRoom: string;
  timezone: string;
}

const text = (n: number | null) => (n === null ? '' : String(n));

export function formFromPolicy(policy: Policy): PolicyForm {
  return {
    contributionFloor: text(policy.contribution_floor_inr),
    totalRooms: text(policy.total_rooms_units),
    maxDiscount: text(policy.max_sales_discount_pct),
    hotelName: policy.hotel_name,
    hotelAddress: policy.hotel_address ?? '',
    hotelPhone: policy.hotel_phone ?? '',
    hotelGstin: policy.hotel_gstin ?? '',
    validityHours: text(policy.validity_hours),
    stayCutoffHours: text(policy.stay_cutoff_hours),
    minValidityHours: text(policy.min_validity_hours),
    minPartialRooms: text(policy.min_partial_rooms_units),
    guestsPerRoom: text(policy.guests_per_room_units),
    timezone: policy.timezone,
  };
}

const num = (value: string): number => (value.trim() === '' ? Number.NaN : Number(value));
const nullableNum = (value: string): number | null => (value.trim() === '' ? null : Number(value));

export function toUpdate(form: PolicyForm, version: number) {
  return {
    timezone: form.timezone.trim(),
    contribution_floor_inr: num(form.contributionFloor),
    total_rooms_units: num(form.totalRooms),
    max_sales_discount_pct: num(form.maxDiscount),
    hotel_name: form.hotelName.trim(),
    hotel_address: form.hotelAddress.trim() || null,
    hotel_phone: form.hotelPhone.trim() || null,
    hotel_gstin: form.hotelGstin.trim().toUpperCase() || null,
    validity_hours: num(form.validityHours),
    stay_cutoff_hours: num(form.stayCutoffHours),
    min_validity_hours: num(form.minValidityHours),
    min_partial_rooms_units: num(form.minPartialRooms),
    guests_per_room_units: nullableNum(form.guestsPerRoom),
    version,
  };
}

export const FIELD_LABEL: Record<string, string> = {
  contribution_floor_inr: 'Package floor',
  total_rooms_units: 'Total rooms',
  max_sales_discount_pct: 'Max Reception discount',
  hotel_name: 'Hotel name',
  hotel_address: 'Hotel address',
  hotel_phone: 'Hotel phone',
  hotel_gstin: 'GSTIN',
  validity_hours: 'Validity',
  stay_cutoff_hours: 'Stay cutoff',
  min_validity_hours: 'Minimum validity',
  min_partial_rooms_units: 'Minimum partial rooms',
  guests_per_room_units: 'Guests per room',
  timezone: 'Time zone',
};

const RANGES: Record<string, [number, number]> = {
  contribution_floor_inr: [0, LIMITS.MAX_UNIT_INR * 100],
  total_rooms_units: [1, LIMITS.MAX_ROOMS],
  max_sales_discount_pct: [0, 100],
  validity_hours: [1, LIMITS.MAX_POLICY_HOURS],
  stay_cutoff_hours: [0, LIMITS.MAX_POLICY_HOURS],
  min_validity_hours: [0, LIMITS.MAX_POLICY_HOURS],
  min_partial_rooms_units: [1, LIMITS.MAX_ROOMS],
  guests_per_room_units: [1, LIMITS.MAX_GUESTS_PER_ROOM],
};

function friendly(issue: ValidationIssue): string {
  const range = RANGES[issue.path];
  switch (issue.code) {
    case 'REQUIRED':
      return 'Required';
    case 'NOT_INTEGER':
      return 'Use a whole number';
    case 'INVALID_TYPE':
      return 'Enter a number';
    case 'OUT_OF_RANGE':
      return range
        ? `Must be between ${range[0]} and ${range[1].toLocaleString('en-IN')}`
        : issue.message;
    case 'INCONSISTENT':
      return issue.message;
    case 'INVALID_FORMAT':
      return 'Use a time zone name such as Asia/Kolkata';
    default:
      return issue.message;
  }
}

export type PolicyParse =
  { ok: true; value: ReturnType<typeof toUpdate> } | { ok: false; errors: Record<string, string> };

/** Same schema as the server, so the checks cannot drift. */
export function parsePolicy(form: PolicyForm, version: number): PolicyParse {
  const body = toUpdate(form, version);
  const result = parseWith(PolicyUpdateRequest, body);
  if (result.ok) return { ok: true, value: body };
  const errors: Record<string, string> = {};
  for (const issue of result.issues) errors[issue.path] ??= friendly(issue);
  return { ok: false, errors };
}

/** What changed between two policies, for the change list. */
export function describeChanges(before: Policy, after: Policy): string[] {
  const out: string[] = [];
  for (const key of Object.keys(FIELD_LABEL) as Array<keyof typeof FIELD_LABEL & keyof Policy>) {
    if (before[key] !== after[key]) {
      const show = (v: unknown) => (v === null ? 'Unknown' : String(v));
      out.push(`${FIELD_LABEL[key]}: ${show(before[key])} to ${show(after[key])}`);
    }
  }
  return out;
}

/**
 * What saving the form would change, in words, with the prices that follow from it. Empty while
 * the form is invalid or unchanged.
 */
export function pendingChanges(form: PolicyForm, policy: Policy): string[] {
  const parsed = parsePolicy(form, policy.version);
  if (!parsed.ok) return [];
  const { version: _version, ...update } = parsed.value;
  const next: Policy = { ...policy, ...update };
  const out = describeChanges(policy, next);
  const before = formFromPolicy(policy);
  const price = (label: string, a: number | null, b: number | null) => {
    if (a !== null && b !== null && a !== b) {
      out.push(`${label}: ₹${a.toLocaleString('en-IN')} to ₹${b.toLocaleString('en-IN')}`);
    }
  };
  price('Full price per room-night', floorRatePreview(before), floorRatePreview(form));
  price(
    'Lowest price Reception can give alone',
    lowestRatePreview(before),
    lowestRatePreview(form),
  );
  return out;
}

/** "72 hours" also as days, so long windows are easy to read: "3 days". */
export function hoursAsDays(value: string): string | null {
  const hours = Number(value);
  if (value.trim() === '' || !Number.isInteger(hours) || hours < 24) return null;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return `${days} ${days === 1 ? 'day' : 'days'}${rest ? ` ${rest} ${rest === 1 ? 'hour' : 'hours'}` : ''}`;
}

/** The time now in a zone, to check it is the right one; null when the zone is not known. */
export function timeIn(zone: string, now: Date = new Date()): string | null {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: zone.trim(),
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now);
  } catch {
    return null;
  }
}

/** Floor rate the form implies (package floor / total rooms, rounded up), or null if invalid. */
export function floorRatePreview(form: PolicyForm): number | null {
  const floor = num(form.contributionFloor);
  const rooms = num(form.totalRooms);
  if (!Number.isInteger(floor) || floor < 0 || !Number.isInteger(rooms) || rooms < 1) return null;
  return Math.ceil(floor / rooms);
}

/** Lowest rate Reception can give alone: full price less the max Reception discount, rounded up. */
export function lowestRatePreview(form: PolicyForm): number | null {
  const full = floorRatePreview(form);
  const pct = num(form.maxDiscount);
  if (full === null || !Number.isInteger(pct) || pct < 0 || pct > 100) return null;
  return Math.ceil((full * (100 - pct)) / 100);
}
