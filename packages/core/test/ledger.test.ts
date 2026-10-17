import { describe, expect, it } from 'vitest';
import {
  amend,
  cancel,
  checkLedger,
  confirm,
  createLedger,
  hold,
  nightKey,
  release,
  type InventoryNight,
  type LedgerResult,
  type LedgerState,
} from '../src/index.js';

const STAY = ['2026-11-01', '2026-11-02'];
const night = (date: string, total: number | null): InventoryNight => ({
  date,
  room_type: 'standard',
  total_units: total,
  available_units: total,
  held_units: 0,
  confirmed_units: 0,
});
const fixture = () => createLedger([night('2026-11-01', 10), night('2026-11-02', 10)]);

function ok(r: LedgerResult): LedgerState {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  expect(checkLedger(r.state)).toEqual([]);
  return r.state;
}

const counters = (s: LedgerState, date: string) => {
  const n = s.nights.get(nightKey('standard', date))!;
  return [n.available_units, n.held_units, n.confirmed_units];
};

describe('hold (BR-13)', () => {
  it('moves units from available to held on every night', () => {
    const s = ok(hold(fixture(), 'A', 'standard', STAY, 4));
    expect(counters(s, '2026-11-01')).toEqual([6, 4, 0]);
    expect(counters(s, '2026-11-02')).toEqual([6, 4, 0]);
  });

  it('is all or nothing: one short night leaves every night untouched', () => {
    const start = createLedger([night('2026-11-01', 10), night('2026-11-02', 3)]);
    const r = hold(start, 'A', 'standard', STAY, 4);
    expect(r).toEqual({
      ok: false,
      error: { code: 'INSUFFICIENT', date: '2026-11-02', available: 3, requested: 4 },
    });
    expect(counters(start, '2026-11-01')).toEqual([10, 0, 0]);
  });

  it('T12 shape: once 10 are held, a second quote cannot over-hold', () => {
    const s = ok(hold(fixture(), 'A', 'standard', STAY, 10));
    expect(hold(s, 'B', 'standard', STAY, 1)).toMatchObject({
      ok: false,
      error: { code: 'INSUFFICIENT', available: 0 },
    });
  });

  it('rejects missing or unknown nights, double booking and bad units', () => {
    const partial = createLedger([night('2026-11-01', 10), night('2026-11-02', null)]);
    expect(hold(partial, 'A', 'standard', STAY, 1)).toMatchObject({
      error: { code: 'UNKNOWN_AVAILABILITY', date: '2026-11-02' },
    });
    expect(hold(fixture(), 'A', 'standard', ['2026-11-03'], 1)).toMatchObject({
      error: { code: 'NO_INVENTORY_DATA' },
    });
    const s = ok(hold(fixture(), 'A', 'standard', STAY, 1));
    expect(hold(s, 'A', 'standard', STAY, 1)).toMatchObject({ error: { code: 'ALREADY_BOOKED' } });
    expect(hold(fixture(), 'A', 'standard', STAY, 0)).toMatchObject({
      error: { code: 'INVALID_UNITS' },
    });
    expect(hold(fixture(), 'A', 'standard', STAY, 1.5)).toMatchObject({
      error: { code: 'INVALID_UNITS' },
    });
  });
});

describe('release is exactly once (BR-14)', () => {
  it('returns held units, and a second release is refused', () => {
    const held = ok(hold(fixture(), 'A', 'standard', STAY, 4));
    const released = ok(release(held, 'A'));
    expect(counters(released, '2026-11-01')).toEqual([10, 0, 0]);
    expect(release(released, 'A')).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', quote_id: 'A' },
    });
  });

  it('T13 shape: after A is released, B can hold the rooms', () => {
    const a = ok(hold(fixture(), 'A', 'standard', STAY, 10));
    expect(hold(a, 'B', 'standard', STAY, 5).ok).toBe(false);
    const b = ok(hold(ok(release(a, 'A')), 'B', 'standard', STAY, 5));
    expect(counters(b, '2026-11-02')).toEqual([5, 5, 0]);
  });

  it('a confirmed booking cannot be released, only cancelled or amended', () => {
    const c = ok(confirm(ok(hold(fixture(), 'A', 'standard', STAY, 4)), 'A'));
    expect(release(c, 'A')).toMatchObject({ error: { code: 'INVALID_STATE', state: 'confirmed' } });
  });
});

describe('confirm, amend and cancel', () => {
  it('confirm moves held to confirmed, once', () => {
    const c = ok(confirm(ok(hold(fixture(), 'A', 'standard', STAY, 4)), 'A'));
    expect(counters(c, '2026-11-01')).toEqual([6, 0, 4]);
    expect(confirm(c, 'A')).toMatchObject({ error: { code: 'INVALID_STATE' } });
    expect(confirm(fixture(), 'X')).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('amend 10 to 7 releases 3 rooms on each night (6 room-nights)', () => {
    const c = ok(confirm(ok(hold(fixture(), 'A', 'standard', STAY, 10)), 'A'));
    const a = ok(amend(c, 'A', 7));
    expect(counters(a, '2026-11-01')).toEqual([3, 0, 7]);
    expect(counters(a, '2026-11-02')).toEqual([3, 0, 7]);
    expect(a.bookings.get('A')!.units).toBe(7);
  });

  it('amend must reduce rooms and keep at least one, and only on a confirmed booking', () => {
    const held = ok(hold(fixture(), 'A', 'standard', STAY, 4));
    expect(amend(held, 'A', 2)).toMatchObject({ error: { code: 'INVALID_STATE' } });
    const c = ok(confirm(held, 'A'));
    for (const units of [0, 4, 5, 2.5]) {
      expect(amend(c, 'A', units)).toMatchObject({ error: { code: 'INVALID_UNITS' } });
    }
  });

  it('cancel returns everything, from held or confirmed', () => {
    const held = ok(hold(fixture(), 'A', 'standard', STAY, 4));
    expect(counters(ok(cancel(held, 'A')), '2026-11-01')).toEqual([10, 0, 0]);
    const c = ok(confirm(held, 'A'));
    expect(counters(ok(cancel(c, 'A')), '2026-11-01')).toEqual([10, 0, 0]);
    expect(cancel(fixture(), 'A')).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('never mutates the previous state', () => {
    const start = fixture();
    ok(hold(start, 'A', 'standard', STAY, 4));
    expect(counters(start, '2026-11-01')).toEqual([10, 0, 0]);
    expect(start.bookings.size).toBe(0);
  });
});

describe('checkLedger finds drift (reconciliation, T1.13)', () => {
  it('reports broken totals, negative availability and counters that do not match bookings', () => {
    const s = ok(hold(fixture(), 'A', 'standard', STAY, 4));
    const nights = new Map(s.nights);
    const k = nightKey('standard', '2026-11-01');
    nights.set(k, { ...nights.get(k)!, held_units: 5 });
    const k2 = nightKey('standard', '2026-11-02');
    nights.set(k2, { ...nights.get(k2)!, available_units: -1, total_units: 3 });
    const drift = checkLedger({ ...s, nights }).map((d) => `${d.key}: ${d.problem}`);
    expect(drift).toEqual([
      'standard#2026-11-01: total != available + held + confirmed',
      'standard#2026-11-01: held_units 5 != holds 4',
      'standard#2026-11-02: available_units below 0',
    ]);
  });

  it('flags confirmed counters that do not match bookings', () => {
    const c = ok(confirm(ok(hold(fixture(), 'A', 'standard', STAY, 4)), 'A'));
    const nights = new Map(c.nights);
    const k = nightKey('standard', '2026-11-01');
    nights.set(k, { ...nights.get(k)!, confirmed_units: 3, available_units: 7 });
    expect(checkLedger({ ...c, nights }).map((d) => d.problem)).toEqual([
      'confirmed_units 3 != bookings 4',
    ]);
  });

  it('rejects duplicate inventory rows', () => {
    expect(() => createLedger([night('2026-11-01', 1), night('2026-11-01', 2)])).toThrow(
      RangeError,
    );
  });
});
