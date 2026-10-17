// Adds a demo calendar to a table: 10 standard rooms per night at 2000 (cost 800), like the
// fixture, for every night in a range. Nights that already exist are never touched, so holds
// and bookings stay intact. Synthetic data.
// Run: SEED_ALLOW_AWS=1 TABLE_NAME=c32-dev-main npx tsx apps/api/scripts/demo-calendar.ts 2026-10-18 2027-03-31
import { addDays, daysBetween } from '@c32/core';
import { getInventory, getRatePlan, putInventory, putRatePlan } from '../src/data/catalog.js';
import { depsFromEnv } from '../src/runtime.js';

const [from, to] = process.argv.slice(2);
if (!from || !to) throw new Error('usage: demo-calendar.ts <from> <to>');
const toAws = process.env['SEED_ALLOW_AWS'] === '1';
const env: NodeJS.ProcessEnv = {
  ...process.env,
  DYNAMODB_ENDPOINT: toAws
    ? undefined
    : (process.env['DYNAMODB_ENDPOINT'] ?? 'http://localhost:8100'),
};
const { data } = depsFromEnv(env);

const dates = Array.from({ length: daysBetween(from, to) + 1 }, (_, i) => addDays(from, i));
const haveInv = new Set((await getInventory(data, 'standard', from, to)).map((n) => n.date));
const haveRate = new Set((await getRatePlan(data, 'standard', from, to)).map((r) => r.date));

const inv = dates.filter((d) => !haveInv.has(d));
const rates = dates.filter((d) => !haveRate.has(d));
await putInventory(
  data,
  inv.map((date) => ({
    date,
    room_type: 'standard',
    total_units: 10,
    available_units: 10,
    held_units: 0,
    confirmed_units: 0,
  })),
);
await putRatePlan(
  data,
  rates.map((date) => ({
    date,
    room_type: 'standard',
    rate_per_room_night_inr: 2000,
    variable_cost_per_room_night_inr: 800,
    rack_rate_inr: 2600,
  })),
);
console.log(
  `added ${inv.length} inventory nights and ${rates.length} rate nights; kept ${haveInv.size} existing nights`,
);
