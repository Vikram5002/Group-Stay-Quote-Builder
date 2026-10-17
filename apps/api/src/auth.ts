import type { Actor, Role } from '@c32/core';
import type { Request, RequestHandler } from 'express';
import { sendProblem } from './http.js';

/**
 * Authentication and role checks (FR-09, blueprint 12).
 *
 * In AWS, API Gateway's JWT authorizer has already verified the Cognito token before Lambda
 * runs; we only read its claims: `sub` is the user id and `cognito:groups` the roles. Locally and
 * in tests, `dev` mode reads `x-dev-user: <user_id>:<Role>` instead. Dev mode is refused inside
 * Lambda, so it can never be switched on in a deployed stack.
 */

export type Authenticate = (req: Request) => Actor | null;

/** Highest role wins when a user is in several groups. */
const ROLE_ORDER: readonly Role[] = ['Owner', 'Sales', 'Viewer'];
const USER_ID = /^[A-Za-z0-9:@._-]{1,128}$/;

/** Cognito puts groups in the token as an array, or as "[Owner Sales]" via the HTTP API. */
export function groupsFromClaim(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw !== 'string') return [];
  return raw
    .replace(/^\[|\]$/g, '')
    .split(/[\s,]+/)
    .filter(Boolean);
}

export function actorFromClaims(claims: Record<string, unknown> | undefined): Actor | null {
  const sub = claims?.['sub'];
  if (typeof sub !== 'string' || !USER_ID.test(sub)) return null;
  const groups = groupsFromClaim(claims?.['cognito:groups']);
  const role = ROLE_ORDER.find((r) => groups.includes(r));
  return role ? { user_id: sub, role } : null;
}

/** Claims from API Gateway HTTP API (payload v2) via the serverless-express invoke context. */
export function jwtAuthenticate(getEvent: () => unknown): Authenticate {
  return () => {
    const event = getEvent() as
      | { requestContext?: { authorizer?: { jwt?: { claims?: Record<string, unknown> } } } }
      | undefined;
    return actorFromClaims(event?.requestContext?.authorizer?.jwt?.claims);
  };
}

/** Local development and tests only: `x-dev-user: sales-1:Sales`. */
export const devAuthenticate: Authenticate = (req) => {
  if (process.env['AWS_LAMBDA_FUNCTION_NAME']) {
    throw new Error('Dev authentication must never run inside Lambda');
  }
  const raw = req.get('x-dev-user');
  if (!raw) return null;
  const at = raw.lastIndexOf(':');
  const userId = raw.slice(0, at);
  const role = raw.slice(at + 1) as Role;
  if (at < 1 || !USER_ID.test(userId) || !ROLE_ORDER.includes(role)) return null;
  return { user_id: userId, role };
};

/** Attach res.locals.actor, or answer 401. */
export function requireActor(authenticate: Authenticate): RequestHandler {
  return (req, res, next) => {
    const actor = authenticate(req);
    if (!actor) {
      sendProblem(res, 'UNAUTHENTICATED', { instance: req.path });
      return;
    }
    res.locals['actor'] = actor;
    next();
  };
}

/** 403 unless the actor's role is allowed on this route. */
export function requireRole(roles: readonly Role[]): RequestHandler {
  return (req, res, next) => {
    const actor = res.locals['actor'] as Actor;
    if (!roles.includes(actor.role)) {
      sendProblem(res, 'FORBIDDEN', {
        detail: `Role ${actor.role} cannot call ${req.method} ${req.path}`,
        instance: req.path,
      });
      return;
    }
    next();
  };
}
