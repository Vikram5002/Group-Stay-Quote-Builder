// The package is CommonJS; its named exports resolve correctly under NodeNext.
import { configure, getCurrentInvoke } from '@codegenie/serverless-express';
import { createApp } from './app.js';
import { jwtAuthenticate } from './auth.js';
import { evidenceFromStore } from './services/exports.js';
import { corsOriginsFromEnv, depsFromEnv, s3FilesFromEnv } from './runtime.js';

/**
 * Lambda entry point behind API Gateway HTTP API with a Cognito JWT authorizer. The app and its
 * DynamoDB client are created once per cold start; the actor comes from the verified JWT claims.
 */
const files = s3FilesFromEnv();

export const handler = configure({
  app: createApp({
    ...(files ? { files: { files, evidence: evidenceFromStore(files) } } : {}),
    deps: depsFromEnv(),
    authenticate: jwtAuthenticate(() => getCurrentInvoke().event),
    corsOrigins: corsOriginsFromEnv(),
  }),
});
