import { z } from 'zod';
import { DEFAULT_POLICY, type Policy } from '../contract/policy.js';
import type { InventoryNight, RatePlanNight } from '../contract/inventory.js';
import type { QuoteRequest } from '../contract/quote.js';
import { IsoDate, RoomType, UnitInr, Units } from '../contract/primitives.js';

/**
 * Schema of data/fixtures/fixture.json, the case's authoritative data (README: do not merge
 * other workbooks without an explicit, tested mapping). Unknown top-level keys are ignored.
 */
export const C32Fixture = z.object({
  case_id: z.literal('C32'),
  synthetic: z.literal(true),
  data_version: z.string(),
  records: z.object({
    inventory: z
      .array(z.strictObject({ date: IsoDate, rooms: Units.nullable(), room_type: RoomType }))
      .min(1),
    quote: z.strictObject({
      rooms: z.int().min(1),
      nights: z.int().min(1),
      rate_per_room_night_inr: UnitInr,
      variable_cost_per_room_night_inr: UnitInr.nullable(),
      contribution_floor_inr: z.int().min(0),
    }),
    expected_revenue_inr: z.int(),
    expected_contribution_inr: z.int(),
  }),
  public_checks: z.array(z.string()),
});
export type C32Fixture = z.infer<typeof C32Fixture>;

export interface MappedFixture {
  policy: Policy;
  inventory: InventoryNight[];
  ratePlan: RatePlanNight[];
  request: QuoteRequest;
  expected: { room_revenue_inr: number; contribution_inr: number };
  publicChecks: string[];
}

/**
 * Documented transform from the fixture into domain inputs:
 * - inventory rows -> InventoryNight with nothing held or confirmed; null rooms stay null.
 * - the quote's rate and variable cost -> a flat rate plan on every inventory night.
 * - contribution_floor_inr -> absolute package floor in the policy (decision G1 default).
 * - the quote -> a request starting on the earliest inventory date. No override rate is sent,
 *   so the engine prices from the rate plan.
 */
export function mapC32Fixture(raw: unknown): MappedFixture {
  const fx = C32Fixture.parse(raw);
  const rows = [...fx.records.inventory].sort((a, b) => a.date.localeCompare(b.date));
  const roomTypes = new Set(rows.map((r) => r.room_type));
  if (roomTypes.size !== 1) throw new Error('Fixture mapping supports exactly one room type');
  const first = rows[0];
  if (!first) throw new Error('Fixture has no inventory rows');
  const q = fx.records.quote;

  return {
    policy: { ...DEFAULT_POLICY, contribution_floor_inr: q.contribution_floor_inr },
    inventory: rows.map((r) => ({
      date: r.date,
      room_type: r.room_type,
      total_units: r.rooms,
      available_units: r.rooms,
      held_units: 0,
      confirmed_units: 0,
    })),
    ratePlan: rows.map((r) => ({
      date: r.date,
      room_type: r.room_type,
      rate_per_room_night_inr: q.rate_per_room_night_inr,
      variable_cost_per_room_night_inr: q.variable_cost_per_room_night_inr,
      rack_rate_inr: null,
    })),
    request: {
      organiser: { name: 'Fictional Events Pvt Ltd' },
      stay: { check_in: first.date, nights: q.nights },
      room_type: first.room_type,
      rooms: q.rooms,
      inclusions: [],
    },
    expected: {
      room_revenue_inr: fx.records.expected_revenue_inr,
      contribution_inr: fx.records.expected_contribution_inr,
    },
    publicChecks: fx.public_checks,
  };
}
