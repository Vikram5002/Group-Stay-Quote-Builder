// Local latency check (blueprint 4.2: quote preview and create p95 under 500 ms warm).
// Runs the real Express app over HTTP against DynamoDB Local. These are LOCAL numbers, not AWS.
// Run: DYNAMODB_ENDPOINT=http://localhost:8100 npx tsx apps/api/scripts/perf.ts
import { CreateTableCommand, DeleteTableCommand } from '@aws-sdk/client-dynamodb';
import { mapC32Fixture, systemClock } from '@c32/core';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { monotonicFactory } from 'ulid';
import { createApp } from '../src/app.js';
import { devAuthenticate } from '../src/auth.js';
import { putInventory, putRatePlan } from '../src/data/catalog.js';
import { createDocClient } from '../src/data/client.js';
import { createTableInput } from '../src/data/table.js';

process.env['LOG_SILENT'] = '1';
const endpoint = process.env['DYNAMODB_ENDPOINT'] ?? 'http://localhost:8100';
const N = Number(process.env['PERF_N'] ?? 200);

const fx = mapC32Fixture(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../data/fixtures/fixture.json', import.meta.url)),
      'utf8',
    ),
  ),
);
const tableName = `c32-perf-${Date.now()}`;
const doc = createDocClient({ tableName, region: 'ap-south-1', endpoint });
const data = { doc, tableName, propertyId: 'p1' };
await doc.send(new CreateTableCommand(createTableInput(tableName)));
// A long calendar with plenty of rooms, so every create holds rooms.
const dates = Array.from({ length: 60 }, (_, i) =>
  new Date(Date.UTC(2026, 10, 1 + i)).toISOString().slice(0, 10),
);
await putInventory(
  data,
  dates.map((date) => ({
    date,
    room_type: 'standard',
    total_units: 100_000,
    available_units: 100_000,
    held_units: 0,
    confirmed_units: 0,
  })),
);
await putRatePlan(
  data,
  dates.map((date) => ({
    date,
    room_type: 'standard',
    rate_per_room_night_inr: 2000,
    variable_cost_per_room_night_inr: 800,
    rack_rate_inr: null,
  })),
);

const app = createApp({
  deps: { data, clock: systemClock, newId: monotonicFactory() },
  authenticate: devAuthenticate,
});
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const headers = { 'content-type': 'application/json', 'x-dev-user': 'sales-1:Sales' };

async function timed(fn: () => Promise<Response>) {
  const t = performance.now();
  const res = await fn();
  const text = await res.text();
  return { ms: performance.now() - t, res, text };
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] ?? 0;
};
const summary = (name: string, xs: number[]) =>
  `${name.padEnd(9)} n=${xs.length}  p50 ${pct(xs, 50).toFixed(1)} ms  p95 ${pct(xs, 95).toFixed(1)} ms  max ${Math.max(...xs).toFixed(1)} ms`;

const preview: number[] = [];
const create: number[] = [];
const confirm: number[] = [];
const results = { preview, create, confirm };
const body = { ...fx.request, rooms: 10 };
// Warm up (the blueprint target is for warm requests).
for (let i = 0; i < 10; i++)
  await fetch(`${base}/v1/quotes/preview`, { method: 'POST', headers, body: JSON.stringify(body) });

for (let i = 0; i < N; i++) {
  const p = await timed(() =>
    fetch(`${base}/v1/quotes/preview`, { method: 'POST', headers, body: JSON.stringify(body) }),
  );
  preview.push(p.ms);
  const c = await timed(() =>
    fetch(`${base}/v1/quotes`, { method: 'POST', headers, body: JSON.stringify(body) }),
  );
  if (c.res.status !== 201) throw new Error(`create returned ${c.res.status}`);
  create.push(c.ms);
  const created = JSON.parse(c.text) as { quote_id?: string };
  const id = created.quote_id;
  if (!id) throw new Error('create returned no quote_id');
  const f = await timed(() =>
    fetch(`${base}/v1/quotes/${id}/confirm`, { method: 'POST', headers }),
  );
  if (f.res.status !== 200) throw new Error(`confirm returned ${f.res.status}`);
  confirm.push(f.ms);
}

console.log(`Local run, DynamoDB Local at ${endpoint}, Node ${process.version}, sequential, warm:`);
for (const [name, xs] of Object.entries(results)) console.log(summary(name, xs));
const worst = Math.max(...Object.values(results).map((xs) => pct(xs, 95)));
console.log(
  worst < 500 ? 'PASS: every p95 under 500 ms' : `FAIL: worst p95 ${worst.toFixed(1)} ms`,
);

server.close();
await doc.send(new DeleteTableCommand({ TableName: tableName }));
doc.destroy();
