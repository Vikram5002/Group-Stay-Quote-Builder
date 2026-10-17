import express, { type Express } from 'express';
import { CONTRACT_VERSION, type HealthResponse } from '@c32/core';
import { errorHandler, notFound, requestId } from './http.js';

export interface AppOptions {
  /** Build or release version reported by /health. */
  version?: string;
  /** Mounts extra routes before the 404 and error handlers (routers in T1.09, tests). */
  register?: (app: Express) => void;
}

/**
 * The single Express app used locally (app.listen) and in Lambda (serverless-express), so local
 * behaviour equals deployed behaviour (blueprint 11.2). Business routes arrive in T1.09.
 */
export function createApp(opts: AppOptions = {}): Express {
  const version = opts.version ?? process.env['APP_VERSION'] ?? 'dev';
  const app = express();

  app.disable('x-powered-by');
  app.set('etag', false);
  app.use(requestId);
  app.use(express.json({ limit: '100kb', type: ['application/json', 'application/*+json'] }));

  app.get('/health', (_req, res) => {
    const body: HealthResponse = {
      status: 'ok',
      service: 'c32-api',
      version,
      contract_version: CONTRACT_VERSION,
    };
    res.set('cache-control', 'no-store').json(body);
  });

  opts.register?.(app);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
