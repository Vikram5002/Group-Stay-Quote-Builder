import { S3Client } from '@aws-sdk/client-s3';
import { systemClock } from '@c32/core';
import { monotonicFactory } from 'ulid';
import type { DataContext } from './data/catalog.js';
import { createDocClient, dataConfigFromEnv } from './data/client.js';
import { S3FileStore } from './files/store.js';
import type { ServiceDeps } from './services/create-quote.js';

/**
 * Production wiring from the environment. CDK (Track 3) sets TABLE_NAME, AWS_REGION, PROPERTY_ID,
 * CORS_ORIGINS, APP_VERSION and DOCS_BUCKET on the Lambda; locally DYNAMODB_ENDPOINT points at DynamoDB Local.
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

/** The documents bucket in AWS (DOCS_BUCKET, set by Track 3's DataStack), or null if unset. */
export function s3FilesFromEnv(env: NodeJS.ProcessEnv = process.env): S3FileStore | null {
  const bucket = env['DOCS_BUCKET'];
  if (!bucket) return null;
  return new S3FileStore(new S3Client({ region: env['AWS_REGION'] ?? 'ap-south-1' }), bucket);
}
