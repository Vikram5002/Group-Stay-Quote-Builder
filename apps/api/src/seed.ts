import { CreateTableCommand, ResourceInUseException } from '@aws-sdk/client-dynamodb';
import { mapC32Fixture } from '@c32/core';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { putInventory, putRatePlan } from './data/catalog.js';
import { createTableInput } from './data/table.js';
import { log } from './log.js';
import { depsFromEnv } from './runtime.js';

/**
 * Create the table (DynamoDB Local) and load the C32 fixture: 10 standard rooms on
 * 2026-11-01 and 2026-11-02 at 2000 with cost 800. Run: npm run seed -w @c32/api
 * Refuses to write to real AWS unless SEED_ALLOW_AWS=1 (Track 3's dev seeding step sets it).
 */
const toAws = process.env['SEED_ALLOW_AWS'] === '1';
const endpoint = toAws ? undefined : (process.env['DYNAMODB_ENDPOINT'] ?? 'http://localhost:8100');
const env: NodeJS.ProcessEnv = { ...process.env, DYNAMODB_ENDPOINT: endpoint };

const { data } = depsFromEnv(env);
const fixturePath = fileURLToPath(new URL('../../../data/fixtures/fixture.json', import.meta.url));
const fx = mapC32Fixture(JSON.parse(readFileSync(fixturePath, 'utf8')));

if (endpoint) {
  try {
    await data.doc.send(new CreateTableCommand(createTableInput(data.tableName)));
    log('info', 'table_created', { table: data.tableName });
  } catch (err) {
    if (!(err instanceof ResourceInUseException)) throw err;
  }
}
await putInventory(data, fx.inventory);
await putRatePlan(data, fx.ratePlan);
log('info', 'seeded', {
  table: data.tableName,
  inventory_nights: fx.inventory.length,
  rate_nights: fx.ratePlan.length,
});
