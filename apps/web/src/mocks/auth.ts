import { ROLES } from '@c32/core';
import type { Actor, Role } from '@c32/core';

/** Mock access tokens look like "mock.<Role>.<userId>". Real Cognito tokens replace them in T3-03. */
export function makeMockToken(actor: Actor): string {
  return `mock.${actor.role}.${actor.user_id}`;
}

export function parseMockToken(header: string | null): Actor | null {
  const token = header?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const [prefix, role, ...rest] = token.split('.');
  const userId = rest.join('.');
  if (prefix !== 'mock' || !userId || !(ROLES as readonly string[]).includes(role ?? ''))
    return null;
  return { user_id: userId, role: role as Role };
}
