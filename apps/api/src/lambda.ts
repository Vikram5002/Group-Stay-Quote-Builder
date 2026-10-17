// The package is CommonJS; its named `configure` export resolves correctly under NodeNext.
import { configure } from '@codegenie/serverless-express';
import { createApp } from './app.js';

/** Lambda entry point behind API Gateway HTTP API. The app is created once per cold start. */
export const handler = configure({ app: createApp() });
