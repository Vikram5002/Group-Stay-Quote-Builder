import { describe, expect, it } from 'vitest';
import { resolveStay, validateQuoteRequest, type ProblemDetails } from '../src/index.js';

const base = {
  organiser: { name: 'Fictional Events Pvt Ltd' },
  stay: { check_in: '2026-11-01', nights: 2 },
  room_type: 'standard',
  rooms: 10,
  rate_per_room_night_inr: 2000,
};

function failure(input: unknown): ProblemDetails {
  const r = validateQuoteRequest(input, '/v1/quotes');
  if (r.ok) throw new Error('expected validation to fail');
  return r.problem;
}

const fieldCodes = (p: ProblemDetails) => (p.errors ?? []).map((e) => `${e.path}:${e.code}`);

describe('valid requests resolve the stay', () => {
  it('fills check_out and night dates from nights (fixture request)', () => {
    const r = validateQuoteRequest(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.stay).toEqual({
      check_in: '2026-11-01',
      check_out: '2026-11-03',
      nights: 2,
      night_dates: ['2026-11-01', '2026-11-02'],
    });
    expect(r.value.rooms).toBe(10);
  });

  it('fills nights from check_out, across a month end', () => {
    expect(resolveStay({ check_in: '2026-10-30', check_out: '2026-11-02' })).toEqual({
      check_in: '2026-10-30',
      check_out: '2026-11-02',
      nights: 3,
      night_dates: ['2026-10-30', '2026-10-31', '2026-11-01'],
    });
  });

  it('accepts nights and check_out together when they agree', () => {
    const r = validateQuoteRequest({
      ...base,
      stay: { check_in: '2026-11-01', nights: 2, check_out: '2026-11-03' },
    });
    expect(r.ok).toBe(true);
  });
});

describe('T07 invalid rooms return 422 VALIDATION_FAILED with the field path', () => {
  it.each([
    [0, 'rooms:OUT_OF_RANGE'],
    [-1, 'rooms:OUT_OF_RANGE'],
    [2.5, 'rooms:NOT_INTEGER'],
    ['ten', 'rooms:INVALID_TYPE'],
    [null, 'rooms:INVALID_TYPE'],
    [501, 'rooms:OUT_OF_RANGE'],
  ])('rooms = %j', (rooms, expected) => {
    const p = failure({ ...base, rooms });
    expect(p).toMatchObject({ status: 422, code: 'VALIDATION_FAILED', instance: '/v1/quotes' });
    expect(fieldCodes(p)).toEqual([expected]);
  });

  it('missing rooms is REQUIRED', () => {
    const { rooms: _rooms, ...rest } = base;
    expect(fieldCodes(failure(rest))).toEqual(['rooms:REQUIRED']);
  });
});

describe('T08 invalid stays return 422 VALIDATION_FAILED', () => {
  it.each([
    [{ check_in: '2026-11-01', nights: 0 }, 'stay.nights:OUT_OF_RANGE'],
    [{ check_in: '2026-11-01', nights: 29 }, 'stay.nights:OUT_OF_RANGE'],
    [{ check_in: '2026-11-01', nights: 1.5 }, 'stay.nights:NOT_INTEGER'],
    [{ check_in: '2026-11-03', check_out: '2026-11-01' }, 'stay.check_out:DATE_ORDER'],
    [{ check_in: '2026-11-01', check_out: '2026-11-01' }, 'stay.check_out:DATE_ORDER'],
    [{ check_in: '2026-11-01', check_out: '2026-11-30' }, 'stay.check_out:OUT_OF_RANGE'],
    [{ check_in: '2026-11-01', nights: 3, check_out: '2026-11-03' }, 'stay.nights:INCONSISTENT'],
    [{ check_in: '2026-11-01' }, 'stay.nights:REQUIRED'],
    [{ check_in: '2026-02-30', nights: 2 }, 'stay.check_in:INVALID_DATE'],
    [{ check_in: '01/11/2026', nights: 2 }, 'stay.check_in:INVALID_DATE'],
  ])('stay %j', (stay, expected) => {
    expect(fieldCodes(failure({ ...base, stay }))).toEqual([expected]);
  });

  it('a 28-night stay is the maximum allowed', () => {
    const r = validateQuoteRequest({
      ...base,
      stay: { check_in: '2026-11-01', check_out: '2026-11-29' },
    });
    expect(r.ok && r.value.stay.nights).toBe(28);
  });
});

describe('problem details', () => {
  it('reports every failing field and unknown fields (BR-18), with a count in detail', () => {
    const p = failure({
      ...base,
      rooms: 0,
      stay: { check_in: '2026-11-01', nights: 0 },
      discount: 5,
    });
    expect(fieldCodes(p).sort()).toEqual([
      'discount:UNKNOWN_FIELD',
      'rooms:OUT_OF_RANGE',
      'stay.nights:OUT_OF_RANGE',
    ]);
    expect(p.detail).toBe('3 fields failed validation');
    expect(p.type).toBe('https://c32.example/problems/validation-failed');
  });

  it('uses the singular for one field and omits instance when not given', () => {
    const r = validateQuoteRequest({ ...base, rooms: 0 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problem.detail).toBe('1 field failed validation');
    expect(r.problem.instance).toBeUndefined();
  });

  it('a non-object body fails cleanly', () => {
    expect(fieldCodes(failure('rooms=10'))).toEqual([':INVALID_TYPE']);
    expect(fieldCodes(failure(null))).toEqual([':INVALID_TYPE']);
  });
});
