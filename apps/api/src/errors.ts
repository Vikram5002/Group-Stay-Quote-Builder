import type { ErrorCode, ValidationIssue } from '@c32/core';
import {
  ContentionError,
  HoldConflictError,
  NotHeldError,
  TransactionConditionError,
  VersionConflictError,
} from './data/errors.js';
import { IdempotencyConflictError } from './data/idempotency.js';
import { InvalidCursorError } from './data/quotes.js';
import { ServiceError } from './services/errors.js';

/** Request input that failed validation; carries the field-level issues for the 422 body. */
export class ValidationFailure extends Error {
  constructor(readonly issues: ValidationIssue[]) {
    super(`${issues.length} field${issues.length === 1 ? '' : 's'} failed validation`);
    this.name = 'ValidationFailure';
  }
}

export interface KnownError {
  code: ErrorCode;
  detail: string;
  errors?: ValidationIssue[];
}

/**
 * Known errors and the contract code they become (blueprint 9.4). Anything else is a 500 whose
 * details stay in the logs.
 */
export function knownError(err: unknown): KnownError | null {
  if (err instanceof ValidationFailure) {
    return { code: 'VALIDATION_FAILED', detail: err.message, errors: err.issues };
  }
  if (err instanceof InvalidCursorError) {
    return {
      code: 'VALIDATION_FAILED',
      detail: '1 field failed validation',
      errors: [{ path: 'cursor', code: 'INVALID_FORMAT', message: 'Invalid cursor' }],
    };
  }
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
  if (err instanceof IdempotencyConflictError) {
    return { code: 'IDEMPOTENCY_CONFLICT', detail: err.message };
  }
  if (err instanceof NotHeldError || err instanceof TransactionConditionError) {
    return { code: 'INVALID_STATE', detail: 'The quote changed state; reload and try again' };
  }
  return null;
}
