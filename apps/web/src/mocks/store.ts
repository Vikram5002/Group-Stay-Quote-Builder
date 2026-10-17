import { DEFAULT_POLICY, addDays } from '@c32/core';
import type {
  Actor,
  InventoryNight,
  Policy,
  Quote,
  QuoteEvent,
  QuoteEventType,
  RatePlanNight,
} from '@c32/core';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Sortable 26-character id in the ULID alphabet. Mock only. */
export function mockUlid(now: number, counter: number): string {
  let t = now;
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  let c = counter;
  let tail = '';
  for (let i = 0; i < 16; i++) {
    tail = CROCKFORD[c % 32] + tail;
    c = Math.floor(c / 32) + 7 * (i + 1);
  }
  return time + tail;
}

/** 64 hex characters derived from the input. Not cryptographic; mock only. */
export function mockHash(input: string): string {
  let out = '';
  let h = 2166136261;
  for (let block = 0; block < 8; block++) {
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i) + block;
      h = Math.imul(h, 16777619) >>> 0;
    }
    out += h.toString(16).padStart(8, '0');
  }
  return out;
}

export interface StoredResponse {
  fingerprint: string;
  status: number;
  body: unknown;
}

export interface MockStore {
  now: () => Date;
  policy: Policy;
  inventory: InventoryNight[];
  ratePlan: RatePlanNight[];
  quotes: Map<string, Quote>;
  events: QuoteEvent[];
  idempotency: Map<string, StoredResponse>;
  nextId: () => string;
  addEvent: (
    quote: Quote,
    type: QuoteEventType,
    actor: Actor,
    reason?: string,
    before?: Record<string, unknown> | null,
    after?: Record<string, unknown> | null,
  ) => void;
}

export const SEED_FIRST_DATE = '2026-11-01';
export const SEED_NIGHTS = 14;

/**
 * Seed data follows the case fixture: standard rooms, 10 per night from 2026-11-01, rate 2000,
 * variable cost 800, floor 20000. Deluxe has an unknown cost, and one standard night has
 * unknown availability, so the Unknown and review flows can be exercised.
 */
function seed(): { inventory: InventoryNight[]; ratePlan: RatePlanNight[] } {
  const inventory: InventoryNight[] = [];
  const ratePlan: RatePlanNight[] = [];
  for (let i = 0; i < SEED_NIGHTS; i++) {
    const date = addDays(SEED_FIRST_DATE, i);
    const unknownNight = date === '2026-11-10';
    inventory.push({
      date,
      room_type: 'standard',
      total_units: unknownNight ? null : 10,
      available_units: unknownNight ? null : 10,
      held_units: 0,
      confirmed_units: 0,
    });
    inventory.push({
      date,
      room_type: 'deluxe',
      total_units: 4,
      available_units: 4,
      held_units: 0,
      confirmed_units: 0,
    });
    ratePlan.push({
      date,
      room_type: 'standard',
      rate_per_room_night_inr: 2000,
      variable_cost_per_room_night_inr: 800,
      rack_rate_inr: null,
    });
    ratePlan.push({
      date,
      room_type: 'deluxe',
      rate_per_room_night_inr: 3500,
      variable_cost_per_room_night_inr: null,
      rack_rate_inr: null,
    });
  }
  return { inventory, ratePlan };
}

export function createMockStore(now: () => Date = () => new Date()): MockStore {
  const { inventory, ratePlan } = seed();
  let counter = 0;
  const store: MockStore = {
    now,
    policy: { ...DEFAULT_POLICY, version: 1 },
    inventory,
    ratePlan,
    quotes: new Map(),
    events: [],
    idempotency: new Map(),
    nextId: () => mockUlid(now().getTime(), ++counter),
    addEvent(quote, type, actor, reason, before = null, after = null) {
      store.events.push({
        event_id: store.nextId(),
        quote_id: quote.quote_id,
        type,
        actor,
        at: now().toISOString(),
        before,
        after,
        reason: reason ?? null,
      });
    },
  };
  return store;
}
