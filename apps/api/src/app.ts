import express, { type Express, type RequestHandler } from 'express';
import { CONTRACT_VERSION, type HealthResponse } from '@c32/core';
import type { Authenticate } from './auth.js';
import { errorHandler, notFound, requestId } from './http.js';
import { mountOperations, type Handlers } from './routes/operations.js';
import { propertyHandlers } from './routes/property.js';
import { quoteHandlers } from './routes/quotes.js';
import type { ServiceDeps } from './services/create-quote.js';

export interface AppOptions {
  /** Build or release version reported by /health. */
  version?: string;
  /** Data, clock and ids for the business routes. Without them only /health is served. */
  deps?: ServiceDeps;
  /** How a request becomes an actor: JWT claims in AWS, the dev header locally. */
  authenticate?: Authenticate;
  /** Browser origins allowed to call the API (the CloudFront domain, the Vite dev server). */
  corsOrigins?: readonly string[];
  /** Mounts extra routes before the 404 and error handlers (tests). */
  register?: (app: Express) => void;
}

/** Every business operation implemented so far, by contract operationId. */
export const HANDLERS: Handlers = { ...quoteHandlers, ...propertyHandlers };

const securityHeaders: RequestHandler = (_req, res, next) => {
  res.set({
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
  });
  next();
};

/** CORS with an explicit allowlist (blueprint 12.2). Unknown origins get no CORS headers. */
function cors(origins: readonly string[]): RequestHandler {
  const allowed = new Set(origins);
  return (req, res, next) => {
    const origin = req.get('origin');
    if (origin && allowed.has(origin)) {
      res.set({
        'access-control-allow-origin': origin,
        'access-control-allow-headers':
          'authorization, content-type, idempotency-key, x-request-id, x-dev-user',
        'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
        'access-control-expose-headers': 'x-request-id, idempotent-replayed',
        'access-control-max-age': '600',
        vary: 'Origin',
      });
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
    }
    next();
  };
}

/**
 * The single Express app used locally (app.listen) and in Lambda (serverless-express), so local
 * behaviour equals deployed behaviour (blueprint 11.2).
 */
export function createApp(opts: AppOptions = {}): Express {
  const version = opts.version ?? process.env['APP_VERSION'] ?? 'dev';
  const app = express();

  app.disable('x-powered-by');
  app.set('etag', false);
  app.use(requestId);
  app.use(securityHeaders);
  app.use(cors(opts.corsOrigins ?? []));
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

  if (opts.deps) {
    if (!opts.authenticate) throw new Error('Business routes need an authenticate function');
    mountOperations(app, { deps: opts.deps, authenticate: opts.authenticate, handlers: HANDLERS });
  }

  opts.register?.(app);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
