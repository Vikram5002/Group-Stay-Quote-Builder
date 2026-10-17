import { ROUTES, problem, type Actor } from '@c32/core';
import type { Express, Request, Response } from 'express';
import { requireActor, requireRole, type Authenticate } from '../auth.js';
import {
  IDEMPOTENCY_KEY_PATTERN,
  requestHash,
  withIdempotency,
  type StoredResponse,
} from '../data/idempotency.js';
import { knownError, ValidationFailure } from '../errors.js';
import type { ServiceDeps } from '../services/create-quote.js';

/**
 * Mounts contract operations on the app (blueprint 11.1: routes do HTTP mapping, auth and
 * validation only). Path, roles and idempotency for every operation come from the contract's
 * ROUTES table, so the router and docs/api/openapi.json cannot drift apart.
 */

export interface HandlerContext {
  req: Request;
  actor: Actor;
  deps: ServiceDeps;
}

export type OperationHandler = (ctx: HandlerContext) => Promise<StoredResponse>;

/** Handlers by contract operationId. Operations without a handler are not mounted yet. */
export type Handlers = Readonly<Record<string, OperationHandler>>;

export interface MountOptions {
  authenticate: Authenticate;
  deps: ServiceDeps;
  handlers: Handlers;
}

/** /v1/quotes/{id} -> /v1/quotes/:id */
export const expressPath = (path: string) => path.replace(/\{(\w+)\}/g, ':$1');

/** Turn a known refusal into a stored response, so an idempotent retry replays the same 4xx. */
async function runCatchingKnown(
  run: () => Promise<StoredResponse>,
  req: Request,
  res: Response,
): Promise<StoredResponse> {
  try {
    return await run();
  } catch (err) {
    const known = knownError(err);
    if (!known) throw err;
    const body = problem(known.code, {
      detail: known.detail,
      instance: req.path,
      requestId: res.locals['requestId'] as string,
      ...(known.errors ? { errors: known.errors } : {}),
    });
    return { status: body.status, body };
  }
}

function send(res: Response, out: StoredResponse): void {
  res.status(out.status);
  if (out.status >= 400) res.type('application/problem+json');
  res.set('cache-control', 'no-store').json(out.body);
}

export function mountOperations(app: Express, opts: MountOptions): string[] {
  const mounted: string[] = [];
  for (const route of ROUTES) {
    const handler = opts.handlers[route.operationId];
    if (!handler || route.roles === 'public') continue;

    app[route.method](
      expressPath(route.path),
      requireActor(opts.authenticate),
      requireRole(route.roles),
      async (req, res, next) => {
        try {
          const actor = res.locals['actor'] as Actor;
          const run = () => handler({ req, actor, deps: opts.deps });
          const key = req.get('idempotency-key');

          if (!route.idempotent || key === undefined) {
            send(res, await runCatchingKnown(run, req, res));
            return;
          }
          if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
            throw new ValidationFailure([
              {
                path: 'headers.idempotency-key',
                code: 'INVALID_FORMAT',
                message: 'Idempotency-Key must be 8 to 128 characters of A-Z, a-z, 0-9, _ or -',
              },
            ]);
          }
          const out = await withIdempotency(
            opts.deps.data,
            {
              scope: `${actor.user_id}:${route.operationId}:${req.path}`,
              key,
              requestHash: requestHash({
                method: req.method,
                path: req.path,
                body: req.body ?? null,
              }),
              nowMs: opts.deps.clock.now(),
            },
            () => runCatchingKnown(run, req, res),
          );
          if (out.replayed) res.set('idempotent-replayed', 'true');
          send(res, out);
        } catch (err) {
          next(err);
        }
      },
    );
    mounted.push(route.operationId);
  }
  return mounted;
}
