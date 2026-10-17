import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POLICY,
  InclusionInput,
  InventoryNight,
  Policy,
  PolicyUpdateRequest,
  QuoteRequest,
  RatePlanNight,
  parseWith,
  type ValidationIssue,
} from '../src/index.js';
import { fixtureRequest } from './helpers.js';

const issuesFor = (schema: Parameters<typeof parseWith>[0], input: unknown): ValidationIssue[] => {
  const r = parseWith(schema, input);
  return r.ok ? [] : r.issues;
};

const codes = (issues: ValidationIssue[]) => issues.map((i) => `${i.path}:${i.code}`);

describe('QuoteRequest', () => {
  it('accepts the fixture request', () => {
    const r = parseWith(QuoteRequest, fixtureRequest());
    expect(r.ok).toBe(true);
  });

  it('accepts check_out instead of nights, and both when they agree', () => {
    const base = fixtureRequest();
    expect(
      parseWith(QuoteRequest, {
        ...base,
        stay: { check_in: '2026-11-01', check_out: '2026-11-03' },
      }).ok,
    ).toBe(true);
    expect(
      parseWith(QuoteRequest, {
        ...base,
        stay: { check_in: '2026-11-01', nights: 2, check_out: '2026-11-03' },
      }).ok,
    ).toBe(true);
  });

  it('allows omitting rate (priced from the rate plan) and inclusions', () => {
    const { rate_per_room_night_inr: _r, inclusions: _i, ...rest } = fixtureRequest();
    expect(parseWith(QuoteRequest, rest).ok).toBe(true);
  });

  // T07 (schema part): rooms = 0, -1, 2.5, or text -> field-level codes on "rooms"
  it.each([
    [0, 'rooms:OUT_OF_RANGE'],
    [-1, 'rooms:OUT_OF_RANGE'],
    [501, 'rooms:OUT_OF_RANGE'],
    [2.5, 'rooms:NOT_INTEGER'],
    ['ten', 'rooms:INVALID_TYPE'],
    [null, 'rooms:INVALID_TYPE'],
  ])('T07 rejects rooms = %j', (rooms, expected) => {
    expect(codes(issuesFor(QuoteRequest, { ...fixtureRequest(), rooms }))).toEqual([expected]);
  });

  it('T07 reports a missing field as REQUIRED', () => {
    const { rooms: _rooms, ...rest } = fixtureRequest();
    expect(issuesFor(QuoteRequest, rest)).toEqual([
      { path: 'rooms', code: 'REQUIRED', message: 'Required' },
    ]);
  });

  // T08 (schema part): 0 nights, 29 nights, check-out before check-in
  it.each([
    [{ check_in: '2026-11-01', nights: 0 }, 'stay.nights:OUT_OF_RANGE'],
    [{ check_in: '2026-11-01', nights: 29 }, 'stay.nights:OUT_OF_RANGE'],
    [{ check_in: '2026-11-03', check_out: '2026-11-01' }, 'stay.check_out:DATE_ORDER'],
    [{ check_in: '2026-11-01', check_out: '2026-11-01' }, 'stay.check_out:DATE_ORDER'],
    [{ check_in: '2026-11-01', check_out: '2026-11-30' }, 'stay.check_out:OUT_OF_RANGE'],
    [{ check_in: '2026-11-01', nights: 3, check_out: '2026-11-03' }, 'stay.nights:INCONSISTENT'],
    [{ check_in: '2026-11-01' }, 'stay.nights:REQUIRED'],
    [{ check_in: '2026-02-30', nights: 1 }, 'stay.check_in:INVALID_DATE'],
    [{ check_in: '01/11/2026', nights: 1 }, 'stay.check_in:INVALID_DATE'],
  ])('T08 rejects stay %j', (stay, expected) => {
    expect(codes(issuesFor(QuoteRequest, { ...fixtureRequest(), stay }))).toEqual([expected]);
  });

  it('BR-18 rejects unknown fields at any depth, one issue per key', () => {
    const input = {
      ...fixtureRequest(),
      discount: 10,
      stay: { check_in: '2026-11-01', nights: 2, late: true },
    };
    expect(codes(issuesFor(QuoteRequest, input)).sort()).toEqual([
      'discount:UNKNOWN_FIELD',
      'stay.late:UNKNOWN_FIELD',
    ]);
  });

  it('rejects fractional or negative money (integer INR only)', () => {
    expect(
      codes(issuesFor(QuoteRequest, { ...fixtureRequest(), rate_per_room_night_inr: 1999.5 })),
    ).toEqual(['rate_per_room_night_inr:NOT_INTEGER']);
    expect(
      codes(issuesFor(QuoteRequest, { ...fixtureRequest(), rate_per_room_night_inr: -1 })),
    ).toEqual(['rate_per_room_night_inr:OUT_OF_RANGE']);
  });

  it('rejects an invalid room type and empty organiser name', () => {
    const input = { ...fixtureRequest(), room_type: 'Standard Room', organiser: { name: '   ' } };
    expect(codes(issuesFor(QuoteRequest, input)).sort()).toEqual([
      'organiser.name:INVALID_LENGTH',
      'room_type:INVALID_FORMAT',
    ]);
  });

  it('caps the number of inclusions', () => {
    const inc = {
      name: 'Breakfast',
      basis: 'per_guest_night',
      unit_cost_inr: 150,
      included_in_rate: true,
    };
    const input = { ...fixtureRequest(), inclusions: Array.from({ length: 11 }, () => inc) };
    expect(codes(issuesFor(QuoteRequest, input))).toEqual(['inclusions:INVALID_LENGTH']);
  });
});

describe('InclusionInput', () => {
  const breakfast = {
    name: 'Breakfast',
    basis: 'per_guest_night',
    unit_cost_inr: 150,
    included_in_rate: true,
  };

  it('accepts bundled and separately charged inclusions, and unknown cost as null', () => {
    expect(parseWith(InclusionInput, breakfast).ok).toBe(true);
    expect(
      parseWith(InclusionInput, { ...breakfast, included_in_rate: false, price_inr: 200 }).ok,
    ).toBe(true);
    expect(parseWith(InclusionInput, { ...breakfast, unit_cost_inr: null }).ok).toBe(true);
  });

  it('rejects a price on a bundled inclusion and an unknown basis', () => {
    expect(codes(issuesFor(InclusionInput, { ...breakfast, price_inr: 200 }))).toEqual([
      'price_inr:INCONSISTENT',
    ]);
    expect(codes(issuesFor(InclusionInput, { ...breakfast, basis: 'per_stay' }))).toEqual([
      'basis:INVALID_ENUM',
    ]);
  });
});

describe('Policy', () => {
  it('accepts the defaults (A1 absolute floor 20000, 72h validity, 24h cutoff)', () => {
    expect(parseWith(Policy, DEFAULT_POLICY).ok).toBe(true);
    expect(DEFAULT_POLICY).toMatchObject({
      floor_mode: 'absolute',
      contribution_floor_inr: 20000,
      validity_hours: 72,
      stay_cutoff_hours: 24,
    });
  });

  it('requires a per-room-night floor in per_room_night mode', () => {
    const p = { ...DEFAULT_POLICY, floor_mode: 'per_room_night', floor_per_room_night_inr: null };
    expect(codes(issuesFor(Policy, p))).toEqual(['floor_per_room_night_inr:REQUIRED']);
  });

  it('rejects min validity above validity and an unknown time zone', () => {
    expect(codes(issuesFor(Policy, { ...DEFAULT_POLICY, min_validity_hours: 100 }))).toEqual([
      'min_validity_hours:INCONSISTENT',
    ]);
    expect(codes(issuesFor(Policy, { ...DEFAULT_POLICY, timezone: 'Mars/Olympus' }))).toEqual([
      'timezone:INVALID_FORMAT',
    ]);
  });

  it('update request omits property_id and keeps the same checks', () => {
    const { property_id: _p, ...update } = DEFAULT_POLICY;
    expect(parseWith(PolicyUpdateRequest, update).ok).toBe(true);
    expect(codes(issuesFor(PolicyUpdateRequest, { ...update, property_id: 'p2' }))).toEqual([
      'property_id:UNKNOWN_FIELD',
    ]);
    expect(codes(issuesFor(PolicyUpdateRequest, { ...update, min_validity_hours: 100 }))).toEqual([
      'min_validity_hours:INCONSISTENT',
    ]);
  });
});

describe('InventoryNight (BR-15 ledger invariant)', () => {
  const night = {
    date: '2026-11-01',
    room_type: 'standard',
    total_units: 10,
    available_units: 6,
    held_units: 3,
    confirmed_units: 1,
  };

  it('accepts a balanced ledger and an unknown night', () => {
    expect(parseWith(InventoryNight, night).ok).toBe(true);
    expect(
      parseWith(InventoryNight, {
        ...night,
        total_units: null,
        available_units: null,
        held_units: 0,
        confirmed_units: 0,
      }).ok,
    ).toBe(true);
  });

  it('rejects an unbalanced ledger, negative availability and half-unknown counters', () => {
    expect(codes(issuesFor(InventoryNight, { ...night, available_units: 7 }))).toEqual([
      'total_units:INCONSISTENT',
    ]);
    // -1 is out of range and also unbalances the ledger; both are reported
    expect(codes(issuesFor(InventoryNight, { ...night, available_units: -1 })).sort()).toEqual([
      'available_units:OUT_OF_RANGE',
      'total_units:INCONSISTENT',
    ]);
    expect(codes(issuesFor(InventoryNight, { ...night, total_units: null }))).toEqual([
      'available_units:INCONSISTENT',
    ]);
  });
});

describe('RatePlanNight', () => {
  it('keeps a null variable cost as null (unknown, never zero)', () => {
    const r = parseWith(RatePlanNight, {
      date: '2026-11-02',
      room_type: 'standard',
      rate_per_room_night_inr: 2000,
      variable_cost_per_room_night_inr: null,
      rack_rate_inr: null,
    });
    expect(r.ok && r.value.variable_cost_per_room_night_inr).toBeNull();
  });
});
