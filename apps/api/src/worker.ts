import { depsFromEnv, s3FilesFromEnv } from './runtime.js';
import { handleWorkerEvent } from './worker-events.js';

/** Worker Lambda entry point; see worker-events.ts for the three triggers. */
const deps = depsFromEnv();
const files = s3FilesFromEnv();

export const handler = (event: unknown) => handleWorkerEvent(deps, files, event);
