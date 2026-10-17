import { LIMITS, parseWith, pastCheckInIssue, PROPERTY_ROOM_TYPES, QuoteRequest } from '@c32/core';
import type { INCLUSION_BASES, InclusionInput, ValidationIssue } from '@c32/core';

export type InclusionBasisValue = (typeof INCLUSION_BASES)[number];

export interface InclusionForm {
  id: string;
  name: string;
  basis: InclusionBasisValue;
  /** Blank is only allowed together with costUnknown. */
  unitCost: string;
  costUnknown: boolean;
  /** True when the price is already in the room rate; false means it is charged on top. */
  includedInRate: boolean;
  price: string;
}

/** Another block of rooms in the same quote (D-058), as text while editing. */
export interface LineForm {
  id: string;
  checkIn: string;
  nights: string;
  rooms: string;
}

/** Everything the wizard edits, kept as text so half-typed numbers stay visible. */
export interface QuoteForm {
  organiser: string;
  reference: string;
  checkIn: string;
  nights: string;
  roomType: string;
  rooms: string;
  /** More blocks of rooms, for example 3 more rooms for one extra night. */
  extraLines: LineForm[];
  /** Discount off the full price (the floor rate), whole percent. Blank means none. */
  discount: string;
  /** A fixed rate instead of a discount; blank means "use the discount". */
  rate: string;
  /** Blank means "use the policy default". */
  guests: string;
  inclusions: InclusionForm[];
}

/** The room types on sale: the same list the import check accepts. */
export const ROOM_TYPES = PROPERTY_ROOM_TYPES;

export const initialForm: QuoteForm = {
  organiser: '',
  reference: '',
  checkIn: '',
  nights: '2',
  roomType: 'standard',
  rooms: '10',
  extraLines: [],
  discount: '0',
  rate: '',
  guests: '',
  inclusions: [],
};

export const STEPS = [
  { id: 'group', label: 'Group and dates' },
  { id: 'rooms', label: 'Rooms and type' },
  { id: 'pricing', label: 'Pricing and inclusions' },
  { id: 'review', label: 'Review and issue' },
] as const;

/** Which request fields each step owns, so a step only blocks on its own errors. */
const STEP_PATHS: ReadonlyArray<readonly string[]> = [
  ['organiser', 'stay'],
  ['room_type', 'rooms', 'additional_lines'],
  ['discount_pct', 'rate_per_room_night_inr', 'guests_per_room_units', 'inclusions'],
  [],
];

let counter = 0;
export function newLine(checkIn = ''): LineForm {
  counter += 1;
  return { id: `line-${counter}`, checkIn, nights: '1', rooms: '1' };
}

export function newInclusion(): InclusionForm {
  counter += 1;
  return {
    id: `inc-${counter}`,
    name: '',
    basis: 'per_guest_night',
    unitCost: '',
    costUnknown: false,
    includedInRate: true,
    price: '',
  };
}

const num = (text: string): number => (text.trim() === '' ? Number.NaN : Number(text));

function inclusionRequest(inc: InclusionForm): InclusionInput {
  const out: InclusionInput = {
    name: inc.name,
    basis: inc.basis,
    unit_cost_inr: inc.costUnknown ? null : num(inc.unitCost),
    included_in_rate: inc.includedInRate,
  };
  if (!inc.includedInRate && inc.price.trim() !== '') out.price_inr = num(inc.price);
  return out;
}

/** Build the API request from the form. Invalid text stays invalid so the shared schema reports it. */
export function toRequest(form: QuoteForm): unknown {
  const request: Record<string, unknown> = {
    organiser: {
      name: form.organiser,
      ...(form.reference.trim() ? { reference: form.reference } : {}),
    },
    stay: {
      check_in: form.checkIn,
      nights: form.nights.trim() === '' ? undefined : num(form.nights),
    },
    room_type: form.roomType,
    rooms: num(form.rooms),
  };
  // A fixed rate wins; otherwise Sales prices by a discount off the full price (D-057).
  if (form.rate.trim() !== '') request.rate_per_room_night_inr = num(form.rate);
  else if (form.discount.trim() !== '') request.discount_pct = num(form.discount);
  if (form.guests.trim() !== '') request.guests_per_room_units = num(form.guests);
  if (form.inclusions.length > 0) request.inclusions = form.inclusions.map(inclusionRequest);
  if (form.extraLines.length > 0) {
    request.additional_lines = form.extraLines.map((l) => ({
      stay: { check_in: l.checkIn, nights: l.nights.trim() === '' ? undefined : num(l.nights) },
      rooms: num(l.rooms),
    }));
  }
  return request;
}

export type ParsedRequest =
  { ok: true; request: QuoteRequest } | { ok: false; issues: ValidationIssue[] };

/** "Today" for the check-in rule: the current instant and the property time zone. */
export interface FormCalendar {
  nowMs: number;
  timeZone: string;
}

/**
 * Validation uses the same schema as the server, so the two cannot drift. With a calendar it also
 * applies the server's rule that check-in is today or later in the property time zone.
 */
export function parseForm(form: QuoteForm, calendar?: FormCalendar): ParsedRequest {
  const result = parseWith(QuoteRequest, toRequest(form));
  const past =
    calendar && ISO_DATE.test(form.checkIn)
      ? pastCheckInIssue(form.checkIn, calendar.nowMs, calendar.timeZone)
      : null;
  // Charged on top of the rate means a price must be typed; blank is never read as 0.
  const unpriced: ValidationIssue[] = form.inclusions.flatMap((inc, i) =>
    !inc.includedInRate && inc.price.trim() === ''
      ? [{ path: `inclusions.${i}.price_inr`, code: 'REQUIRED' as const, message: 'Required' }]
      : [],
  );
  const extra = [...(past ? [past] : []), ...unpriced];
  if (result.ok && extra.length === 0) return { ok: true, request: result.value };
  return { ok: false, issues: [...(result.ok ? [] : result.issues), ...extra] };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const RANGES: Record<string, [number, number]> = {
  'stay.nights': [LIMITS.MIN_NIGHTS, LIMITS.MAX_NIGHTS],
  rooms: [LIMITS.MIN_ROOMS, LIMITS.MAX_ROOMS],
  rate_per_room_night_inr: [0, LIMITS.MAX_UNIT_INR],
  discount_pct: [0, 100],
  guests_per_room_units: [1, LIMITS.MAX_GUESTS_PER_ROOM],
};

/** Plain-language text for a field issue. */
export function friendlyIssue(issue: ValidationIssue): string {
  const range =
    RANGES[issue.path] ?? (issue.path.endsWith('_inr') ? [0, LIMITS.MAX_UNIT_INR] : undefined);
  switch (issue.code) {
    case 'REQUIRED':
      return issue.path.endsWith('.price_inr')
        ? 'Enter the extra price, or 0 if there is no extra charge'
        : 'Required';
    case 'NOT_INTEGER':
      return 'Use a whole number';
    case 'INVALID_TYPE':
      return 'Enter a number';
    case 'OUT_OF_RANGE':
      return range
        ? `Must be between ${range[0]} and ${range[1].toLocaleString('en-IN')}`
        : issue.message;
    case 'INVALID_LENGTH':
      return issue.path.endsWith('name') ? 'Enter a name' : 'Check the length of this value';
    case 'INVALID_DATE':
      return 'Enter a valid date';
    case 'INCONSISTENT':
      return 'Remove the price, or untick "included in the rate"';
    default:
      return issue.message;
  }
}

/** Issues keyed by field path, first message per field. */
export function issuesByPath(issues: readonly ValidationIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    out[issue.path] ??= friendlyIssue(issue);
  }
  return out;
}

/** Errors that belong to one step. */
export function stepErrors(step: number, issues: readonly ValidationIssue[]): ValidationIssue[] {
  const owned = STEP_PATHS[step] ?? [];
  return issues.filter((i) => owned.some((p) => i.path === p || i.path.startsWith(`${p}.`)));
}
