import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const repoPath = (rel: string) => fileURLToPath(new URL(`../../../${rel}`, import.meta.url));

export const readJson = (rel: string): unknown => JSON.parse(readFileSync(repoPath(rel), 'utf8'));

/** The fixture-shaped request (10 standard rooms, 2 nights from 2026-11-01). */
export const fixtureRequest = () => ({
  organiser: { name: 'Fictional Events Pvt Ltd' },
  stay: { check_in: '2026-11-01', nights: 2 },
  room_type: 'standard',
  rooms: 10,
  rate_per_room_night_inr: 2000,
  inclusions: [],
});
