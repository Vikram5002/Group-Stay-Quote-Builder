/** Typed errors from the data layer. Services map them to problem+json codes. */

export type HoldConflictReason =
  'NO_INVENTORY_DATA' | 'UNKNOWN_AVAILABILITY' | 'INSUFFICIENT' | 'ALREADY_HELD';

/** A hold could not be taken; nothing was written (the transaction is all or nothing). */
export class HoldConflictError extends Error {
  readonly code = 'HOLD_CONFLICT';
  constructor(
    readonly date: string,
    readonly reason: HoldConflictReason,
    readonly available: number | null = null,
  ) {
    super(
      `Hold failed on ${date}: ${reason}${available === null ? '' : ` (available ${available})`}`,
    );
    this.name = 'HoldConflictError';
  }
}

/** A caller-supplied condition in the same transaction failed (for example the quote's status). */
export class TransactionConditionError extends Error {
  readonly code = 'INVALID_STATE';
  constructor(readonly index: number) {
    super(`Condition on extra transaction item ${index} failed`);
    this.name = 'TransactionConditionError';
  }
}

/** The quote has no held room-nights to confirm. */
export class NotHeldError extends Error {
  readonly code = 'INVALID_STATE';
  constructor(readonly quoteId: string) {
    super(`Quote ${quoteId} holds no rooms`);
    this.name = 'NotHeldError';
  }
}

/** Optimistic concurrency check failed: someone else changed the record first. */
export class VersionConflictError extends Error {
  readonly code = 'VERSION_CONFLICT';
  constructor(readonly expected: number) {
    super(`Record changed since version ${expected}`);
    this.name = 'VersionConflictError';
  }
}

/** Transient contention that did not clear after retries. */
export class ContentionError extends Error {
  readonly code = 'HOLD_CONFLICT';
  constructor(readonly attempts: number) {
    super(`Transaction still conflicting after ${attempts} attempts`);
    this.name = 'ContentionError';
  }
}
