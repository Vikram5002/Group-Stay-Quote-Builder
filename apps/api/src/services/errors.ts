import type { ErrorCode } from '@c32/core';

/** A business-rule refusal from a service. The router maps `code` to problem+json (T1.09). */
export class ServiceError extends Error {
  constructor(
    readonly code: ErrorCode,
    detail: string,
  ) {
    super(detail);
    this.name = 'ServiceError';
  }
}
