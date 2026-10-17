import { LIMITS, parseWith, PolicyUpdateRequest } from '@c32/core';
import type { FLOOR_MODES, Policy, ValidationIssue } from '@c32/core';

export type FloorModeValue = (typeof FLOOR_MODES)[number];

/** The policy as text, so half-typed numbers stay visible while editing. */
export interface PolicyForm {
  floorMode: FloorModeValue;
  contributionFloor: string;
  floorPerRoomNight: string;
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
    floorMode: policy.floor_mode,
    contributionFloor: text(policy.contribution_floor_inr),
    floorPerRoomNight: text(policy.floor_per_room_night_inr),
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
    floor_mode: form.floorMode,
    contribution_floor_inr: num(form.contributionFloor),
    floor_per_room_night_inr: nullableNum(form.floorPerRoomNight),
    validity_hours: num(form.validityHours),
    stay_cutoff_hours: num(form.stayCutoffHours),
    min_validity_hours: num(form.minValidityHours),
    min_partial_rooms_units: num(form.minPartialRooms),
    guests_per_room_units: nullableNum(form.guestsPerRoom),
    version,
  };
}

export const FIELD_LABEL: Record<string, string> = {
  floor_mode: 'Floor mode',
  contribution_floor_inr: 'Package floor',
  floor_per_room_night_inr: 'Floor per room-night',
  validity_hours: 'Validity',
  stay_cutoff_hours: 'Stay cutoff',
  min_validity_hours: 'Minimum validity',
  min_partial_rooms_units: 'Minimum partial rooms',
  guests_per_room_units: 'Guests per room',
  timezone: 'Time zone',
};

const RANGES: Record<string, [number, number]> = {
  contribution_floor_inr: [0, LIMITS.MAX_UNIT_INR * 100],
  floor_per_room_night_inr: [0, LIMITS.MAX_UNIT_INR],
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
      return issue.path === 'floor_per_room_night_inr'
        ? 'Required when the floor mode is per room-night'
        : 'Required';
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
