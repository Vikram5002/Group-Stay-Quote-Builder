import { LIMITS, parseWith, QuoteRequest } from '@c32/core';
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

/** Everything the wizard edits, kept as text so half-typed numbers stay visible. */
export interface QuoteForm {
  organiser: string;
  reference: string;
  checkIn: string;
  nights: string;
  roomType: string;
  rooms: string;
  /** Blank means "use the rate plan". */
  rate: string;
  /** Blank means "use the policy default". */
  guests: string;
  inclusions: InclusionForm[];
}

export const ROOM_TYPES = [
  { value: 'standard', label: 'Standard' },
  { value: 'deluxe', label: 'Deluxe' },
] as const;

export const initialForm: QuoteForm = {
  organiser: '',
  reference: '',
  checkIn: '',
  nights: '2',
  roomType: 'standard',
  rooms: '10',
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
  ['room_type', 'rooms'],
  ['rate_per_room_night_inr', 'guests_per_room_units', 'inclusions'],
  [],
];

let counter = 0;
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
  if (form.rate.trim() !== '') request.rate_per_room_night_inr = num(form.rate);
  if (form.guests.trim() !== '') request.guests_per_room_units = num(form.guests);
  if (form.inclusions.length > 0) request.inclusions = form.inclusions.map(inclusionRequest);
  return request;
}

export type ParsedRequest =
  { ok: true; request: QuoteRequest } | { ok: false; issues: ValidationIssue[] };

/** Validation uses the same schema as the server, so the two cannot drift. */
export function parseForm(form: QuoteForm): ParsedRequest {
  const result = parseWith(QuoteRequest, toRequest(form));
  return result.ok ? { ok: true, request: result.value } : { ok: false, issues: result.issues };
}

const RANGES: Record<string, [number, number]> = {
  'stay.nights': [LIMITS.MIN_NIGHTS, LIMITS.MAX_NIGHTS],
  rooms: [LIMITS.MIN_ROOMS, LIMITS.MAX_ROOMS],
  rate_per_room_night_inr: [0, LIMITS.MAX_UNIT_INR],
  guests_per_room_units: [1, LIMITS.MAX_GUESTS_PER_ROOM],
};

/** Plain-language text for a field issue. */
export function friendlyIssue(issue: ValidationIssue): string {
  const range =
    RANGES[issue.path] ?? (issue.path.endsWith('_inr') ? [0, LIMITS.MAX_UNIT_INR] : undefined);
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
