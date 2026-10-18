import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { devAuthenticate } from './auth.js';
import { LocalEmailSender } from './email/sender.js';
import { LocalFileStore, localFilesRouter } from './files/store.js';
import { log } from './log.js';
import { evidenceFromDir } from './services/exports.js';
import { corsOriginsFromEnv, depsFromEnv } from './runtime.js';

/**
 * Local API: DynamoDB Local, dev authentication (`x-dev-user: sales-1:Sales`) and a local folder
 * (.local-files) standing in for the S3 documents bucket.
 * Start the database with `npm run db:up -w @c32/api`, seed it with `npm run seed -w @c32/api`.
 */
const env = {
  ...process.env,
  DYNAMODB_ENDPOINT: process.env['DYNAMODB_ENDPOINT'] ?? 'http://localhost:8100',
  CORS_ORIGINS: process.env['CORS_ORIGINS'] ?? 'http://localhost:5173',
};
const port = Number(process.env['PORT'] ?? 3000);

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const files = new LocalFileStore(
  process.env['LOCAL_FILES_DIR'] ?? join(repo, '.local-files'),
  `http://localhost:${port}`,
);

createApp({
  // Emails land in .local-files/outbox as .eml files instead of being sent.
  deps: { ...depsFromEnv(env), email: new LocalEmailSender(files, 'quotes@localhost') },
  files: { files, evidence: evidenceFromDir(join(repo, 'evidence')) },
  register: (app) => app.use('/local-files', localFilesRouter(files)),
  authenticate: devAuthenticate,
  corsOrigins: corsOriginsFromEnv(env),
}).listen(port, () => {
  log('info', 'api_listening', {
    url: `http://localhost:${port}`,
    dynamodb: env.DYNAMODB_ENDPOINT,
  });
});
