import type { ErrorCode } from '@c32/core';
import {
  ContentionError,
  HoldConflictError,
  NotHeldError,
  TransactionConditionError,
  VersionConflictError,
} from './data/errors.js';
import { IdempotencyConflictError } from './data/idempotency.js';
import { ServiceError } from './services/errors.js';

/**
 * Known errors and the contract code they become (blueprint 9.4). Anything else is a 500 whose
 * details stay in the logs.
 */
export function knownError(err: unknown): { code: ErrorCode; detail: string } | null {
  if (err instanceof ServiceError) return { code: err.code, detail: err.message };
  if (err instanceof HoldConflictError) {
    return { code: 'HOLD_CONFLICT', detail: `Rooms are no longer available on ${err.date}` };
  }
  if (err instanceof ContentionError) {
    return { code: 'HOLD_CONFLICT', detail: 'Inventory is busy; please retry' };
  }
  if (err instanceof VersionConflictError) {
    return { code: 'VERSION_CONFLICT', detail: 'The record changed; reload and try again' };
  }
  if (err instanceof IdempotencyConflictError)
    return { code: 'IDEMPOTENCY_CONFLICT', detail: err.message };
  if (err instanceof NotHeldError || err instanceof TransactionConditionError) {
    return { code: 'INVALID_STATE', detail: 'The quote changed state; reload and try again' };
  }
  return null;
}
