import type { ErrorCode, ValidationIssue } from '@c32/core';

/** A business-rule refusal from a service. The router maps `code` to problem+json (T1.09). */
export class ServiceError extends Error {
  constructor(
    readonly code: ErrorCode,
    detail: string,
    /** Field-level issues, for a VALIDATION_FAILED that needs the policy or the clock. */
    readonly issues?: ValidationIssue[],
  ) {
    super(detail);
    this.name = 'ServiceError';
  }
}
