import { createApp } from './app.js';
import { devAuthenticate } from './auth.js';
import { log } from './log.js';
import { corsOriginsFromEnv, depsFromEnv } from './runtime.js';

/**
 * Local API: DynamoDB Local plus dev authentication (`x-dev-user: sales-1:Sales`).
 * Start the database with `npm run db:up -w @c32/api`, seed it with `npm run seed -w @c32/api`.
 */
const env = {
  ...process.env,
  DYNAMODB_ENDPOINT: process.env['DYNAMODB_ENDPOINT'] ?? 'http://localhost:8100',
  CORS_ORIGINS: process.env['CORS_ORIGINS'] ?? 'http://localhost:5173',
};
const port = Number(process.env['PORT'] ?? 3000);

createApp({
  deps: depsFromEnv(env),
  authenticate: devAuthenticate,
  corsOrigins: corsOriginsFromEnv(env),
}).listen(port, () => {
  log('info', 'api_listening', {
    url: `http://localhost:${port}`,
    dynamodb: env.DYNAMODB_ENDPOINT,
  });
});
