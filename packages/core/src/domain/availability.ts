import type { InventoryNight } from '../contract/inventory.js';

/**
 * Sellable rooms for a stay (blueprint 5.7, BR-04).
 *
 * sellable = minimum over the stay's nights of available_units, for one room type.
 * - A night with no inventory row is not on sale: the result is `missing` (NO_INVENTORY_DATA).
 * - A night whose availability is null is unknown: the result is `unknown`
 *   (UNKNOWN_AVAILABILITY). Unknown is never read as 0 rooms or as unlimited rooms.
 * A missing night outranks an unknown one, because a night that is not on sale cannot be sold
 * whatever the other nights hold.
 */

export interface NightAvailability {
  date: string;
  available_units: number;
}

export type Availability =
  | { kind: 'known'; sellable: number; nights: NightAvailability[] }
  | { kind: 'unknown'; unknown_dates: string[] }
  | { kind: 'missing'; missing_dates: string[] };

export function sellableRooms(
  inventory: readonly InventoryNight[],
  roomType: string,
  nightDates: readonly string[],
): Availability {
  if (nightDates.length === 0) throw new RangeError('A stay needs at least one night');

  const byDate = new Map<string, InventoryNight>();
  for (const row of inventory) {
    if (row.room_type !== roomType) continue;
    if (byDate.has(row.date)) {
      throw new RangeError(`Duplicate inventory row for ${roomType} on ${row.date}`);
    }
    byDate.set(row.date, row);
  }

  const missing: string[] = [];
  const unknown: string[] = [];
  const nights: NightAvailability[] = [];
  for (const date of nightDates) {
    const row = byDate.get(date);
    if (row === undefined) missing.push(date);
    else if (row.available_units === null) unknown.push(date);
    else nights.push({ date, available_units: row.available_units });
  }

  if (missing.length > 0) return { kind: 'missing', missing_dates: missing };
  if (unknown.length > 0) return { kind: 'unknown', unknown_dates: unknown };
  return {
    kind: 'known',
    sellable: Math.min(...nights.map((n) => n.available_units)),
    nights,
  };
}
