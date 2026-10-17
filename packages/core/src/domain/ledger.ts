import type { InventoryNight } from '../contract/inventory.js';

/**
 * Pure reference model of the room-night ledger (blueprint 1.1, 8.2). The DynamoDB repository
 * (T1.07) implements the same moves with conditional transactions and is tested against this
 * model; the nightly reconciliation (T1.13) uses `checkLedger` to detect drift.
 *
 * - BR-13 holds are taken for every night of a quote or for none.
 * - BR-14 a hold is released exactly once (release, cancel and expiry all go through here).
 * - BR-15 every night keeps total = available + held + confirmed, with available >= 0.
 *
 * State is never mutated: every move returns a new state or an error.
 */

export type BookingState = 'held' | 'confirmed';

export interface Booking {
  quote_id: string;
  room_type: string;
  dates: readonly string[];
  units: number;
  /** Rooms per night when they differ by night (a multi-line quote, D-058); else `units`. */
  units_by_date?: Readonly<Record<string, number>>;
  state: BookingState;
}

/** Rooms a booking takes on one of its nights. */
export function bookingUnits(b: Booking, date: string): number {
  return b.units_by_date?.[date] ?? b.units;
}

export interface LedgerState {
  nights: ReadonlyMap<string, InventoryNight>;
  bookings: ReadonlyMap<string, Booking>;
}

export type LedgerError =
  | { code: 'ALREADY_BOOKED'; quote_id: string }
  | { code: 'NOT_FOUND'; quote_id: string }
  | { code: 'INVALID_STATE'; quote_id: string; state: BookingState }
  | { code: 'NO_INVENTORY_DATA'; date: string }
  | { code: 'UNKNOWN_AVAILABILITY'; date: string }
  | { code: 'INSUFFICIENT'; date: string; available: number; requested: number }
  | { code: 'INVALID_UNITS'; units: number };

export type LedgerResult = { ok: true; state: LedgerState } | { ok: false; error: LedgerError };

export const nightKey = (roomType: string, date: string) => `${roomType}#${date}`;

export function createLedger(inventory: readonly InventoryNight[]): LedgerState {
  const nights = new Map<string, InventoryNight>();
  for (const n of inventory) {
    const key = nightKey(n.room_type, n.date);
    if (nights.has(key)) throw new RangeError(`Duplicate inventory row ${key}`);
    nights.set(key, { ...n });
  }
  return { nights, bookings: new Map() };
}

const fail = (error: LedgerError): LedgerResult => ({ ok: false, error });

/** Apply a per-night change to every night of a booking. Counters are known by construction. */
function shift(
  state: LedgerState,
  roomType: string,
  dates: readonly string[],
  delta: { available: number; held: number; confirmed: number },
): Map<string, InventoryNight> {
  const nights = new Map(state.nights);
  for (const date of dates) {
    const key = nightKey(roomType, date);
    const n = nights.get(key) as InventoryNight;
    nights.set(key, {
      ...n,
      available_units: (n.available_units as number) + delta.available,
      held_units: n.held_units + delta.held,
      confirmed_units: n.confirmed_units + delta.confirmed,
    });
  }
  return nights;
}

function withBooking(state: LedgerState, booking: Booking | null, quoteId: string) {
  const bookings = new Map(state.bookings);
  if (booking === null) bookings.delete(quoteId);
  else bookings.set(quoteId, booking);
  return bookings;
}

/** Hold `units` rooms on every night, or nothing at all (BR-13). */
export function hold(
  state: LedgerState,
  quoteId: string,
  roomType: string,
  dates: readonly string[],
  units: number,
): LedgerResult {
  if (!Number.isSafeInteger(units) || units < 1) return fail({ code: 'INVALID_UNITS', units });
  if (state.bookings.has(quoteId)) return fail({ code: 'ALREADY_BOOKED', quote_id: quoteId });
  for (const date of dates) {
    const n = state.nights.get(nightKey(roomType, date));
    if (n === undefined) return fail({ code: 'NO_INVENTORY_DATA', date });
    if (n.available_units === null) return fail({ code: 'UNKNOWN_AVAILABILITY', date });
    if (n.available_units < units) {
      return fail({ code: 'INSUFFICIENT', date, available: n.available_units, requested: units });
    }
  }
  return {
    ok: true,
    state: {
      nights: shift(state, roomType, dates, { available: -units, held: units, confirmed: 0 }),
      bookings: withBooking(
        state,
        { quote_id: quoteId, room_type: roomType, dates: [...dates], units, state: 'held' },
        quoteId,
      ),
    },
  };
}

function find(state: LedgerState, quoteId: string, expected?: BookingState) {
  const b = state.bookings.get(quoteId);
  if (b === undefined) return { error: { code: 'NOT_FOUND', quote_id: quoteId } as LedgerError };
  if (expected !== undefined && b.state !== expected) {
    return { error: { code: 'INVALID_STATE', quote_id: quoteId, state: b.state } as LedgerError };
  }
  return { booking: b };
}

/** Give a held quote's rooms back (expiry, decline, reject). Exactly once (BR-14). */
export function release(state: LedgerState, quoteId: string): LedgerResult {
  const f = find(state, quoteId, 'held');
  if (f.error) return fail(f.error);
  const b = f.booking;
  return {
    ok: true,
    state: {
      nights: shift(state, b.room_type, b.dates, {
        available: b.units,
        held: -b.units,
        confirmed: 0,
      }),
      bookings: withBooking(state, null, quoteId),
    },
  };
}

/** Move a held quote's rooms to confirmed. */
export function confirm(state: LedgerState, quoteId: string): LedgerResult {
  const f = find(state, quoteId, 'held');
  if (f.error) return fail(f.error);
  const b = f.booking;
  return {
    ok: true,
    state: {
      nights: shift(state, b.room_type, b.dates, {
        available: 0,
        held: -b.units,
        confirmed: b.units,
      }),
      bookings: withBooking(state, { ...b, state: 'confirmed' }, quoteId),
    },
  };
}

/** Partial cancellation of a confirmed booking: release the difference first (BR-16). */
export function amend(state: LedgerState, quoteId: string, newUnits: number): LedgerResult {
  const f = find(state, quoteId, 'confirmed');
  if (f.error) return fail(f.error);
  const b = f.booking;
  if (!Number.isSafeInteger(newUnits) || newUnits < 1 || newUnits >= b.units) {
    return fail({ code: 'INVALID_UNITS', units: newUnits });
  }
  const freed = b.units - newUnits;
  return {
    ok: true,
    state: {
      nights: shift(state, b.room_type, b.dates, { available: freed, held: 0, confirmed: -freed }),
      bookings: withBooking(state, { ...b, units: newUnits }, quoteId),
    },
  };
}

/** Full cancellation of a held or confirmed booking. */
export function cancel(state: LedgerState, quoteId: string): LedgerResult {
  const f = find(state, quoteId);
  if (f.error) return fail(f.error);
  const b = f.booking;
  const heldDelta = b.state === 'held' ? -b.units : 0;
  const confirmedDelta = b.state === 'confirmed' ? -b.units : 0;
  return {
    ok: true,
    state: {
      nights: shift(state, b.room_type, b.dates, {
        available: b.units,
        held: heldDelta,
        confirmed: confirmedDelta,
      }),
      bookings: withBooking(state, null, quoteId),
    },
  };
}

export interface LedgerDrift {
  key: string;
  problem: string;
}

/**
 * Check BR-15 on every night, and that the held and confirmed counters equal the sum of the
 * bookings on that night. Returns an empty list when the ledger is consistent.
 */
export function checkLedger(state: LedgerState): LedgerDrift[] {
  const drift: LedgerDrift[] = [];
  const held = new Map<string, number>();
  const confirmed = new Map<string, number>();
  for (const b of state.bookings.values()) {
    const target = b.state === 'held' ? held : confirmed;
    for (const date of b.dates) {
      const key = nightKey(b.room_type, date);
      target.set(key, (target.get(key) ?? 0) + bookingUnits(b, date));
    }
  }
  for (const [key, n] of state.nights) {
    if (n.available_units !== null) {
      if (n.available_units < 0) drift.push({ key, problem: 'available_units below 0' });
      if (n.total_units !== n.available_units + n.held_units + n.confirmed_units) {
        drift.push({ key, problem: 'total != available + held + confirmed' });
      }
    }
    if (n.held_units !== (held.get(key) ?? 0)) {
      drift.push({ key, problem: `held_units ${n.held_units} != holds ${held.get(key) ?? 0}` });
    }
    if (n.confirmed_units !== (confirmed.get(key) ?? 0)) {
      drift.push({
        key,
        problem: `confirmed_units ${n.confirmed_units} != bookings ${confirmed.get(key) ?? 0}`,
      });
    }
  }
  return drift;
}
