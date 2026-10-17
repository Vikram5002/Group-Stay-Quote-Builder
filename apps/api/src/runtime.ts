import { systemClock } from '@c32/core';
import { monotonicFactory } from 'ulid';
import type { DataContext } from './data/catalog.js';
import { createDocClient, dataConfigFromEnv } from './data/client.js';
import type { ServiceDeps } from './services/create-quote.js';

/**
 * Production wiring from the environment. CDK (Track 3) sets TABLE_NAME, AWS_REGION, PROPERTY_ID,
 * CORS_ORIGINS and APP_VERSION on the Lambda; locally DYNAMODB_ENDPOINT points at DynamoDB Local.
 */
export function depsFromEnv(env: NodeJS.ProcessEnv = process.env): ServiceDeps {
  const config = dataConfigFromEnv(env);
  const data: DataContext = {
    doc: createDocClient(config),
    tableName: config.tableName,
    propertyId: env['PROPERTY_ID'] ?? 'p1',
  };
  return { data, clock: systemClock, newId: monotonicFactory() };
}

export function corsOriginsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env['CORS_ORIGINS'] ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}
