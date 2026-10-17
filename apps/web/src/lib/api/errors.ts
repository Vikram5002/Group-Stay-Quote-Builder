import { ERROR_CODES, ERROR_HTTP_STATUS, ERROR_TITLES } from '@c32/core';
import type { ErrorCode, ProblemDetails, ValidationIssue } from '@c32/core';

export interface FriendlyError {
  title: string;
  message: string;
  /** Plain-language next step. */
  nextStep: string;
  /** Machine action the UI can offer as a button. */
  action?: 'sign-in' | 're-quote' | 'refresh' | 'retry' | 'none';
}

const FRIENDLY: Readonly<Record<ErrorCode, Omit<FriendlyError, 'title'>>> = {
  UNAUTHENTICATED: {
    message: 'Your session has ended.',
    nextStep: 'Sign in again to continue.',
    action: 'sign-in',
  },
  FORBIDDEN: {
    message: 'Your role cannot do this.',
    nextStep: 'Ask an Owner to do it, or check you are signed in with the right role.',
    action: 'none',
  },
  NOT_FOUND: {
    message: 'We could not find that record.',
    nextStep: 'Go back to the list and open it again.',
    action: 'none',
  },
  APPROVAL_REQUIRED: {
    message: 'This quote is below the contribution floor, so it cannot be confirmed yet.',
    nextStep: 'Send it to an Owner for approval.',
    action: 'none',
  },
  HOLD_CONFLICT: {
    message: 'Someone else took some of these room-nights first.',
    nextStep: 'Re-quote to see what is still available.',
    action: 're-quote',
  },
  VERSION_CONFLICT: {
    message: 'Someone else changed this while you were editing.',
    nextStep: 'Reload to see the latest version, then apply your change again.',
    action: 'refresh',
  },
  INVALID_STATE: {
    message: 'This action is not allowed in the quote’s current status.',
    nextStep: 'Reload the quote to see its current status.',
    action: 'refresh',
  },
  IDEMPOTENCY_CONFLICT: {
    message: 'That request key was already used for a different request.',
    nextStep: 'Start the action again.',
    action: 'retry',
  },
  QUOTE_EXPIRED: {
    message: 'The validity window has passed and the rooms were released.',
    nextStep: 'Re-quote to hold the rooms again.',
    action: 're-quote',
  },
  PAYLOAD_TOO_LARGE: {
    message: 'That file or request is too large.',
    nextStep: 'Split it into smaller parts and try again.',
    action: 'none',
  },
  UNSUPPORTED_MEDIA_TYPE: {
    message: 'That file type is not supported.',
    nextStep: 'Use a CSV or JSON file.',
    action: 'none',
  },
  VALIDATION_FAILED: {
    message: 'Some fields need attention.',
    nextStep: 'Fix the highlighted fields and submit again.',
    action: 'none',
  },
  THROTTLED: {
    message: 'Too many requests in a short time.',
    nextStep: 'Wait a few seconds and try again.',
    action: 'retry',
  },
  INTERNAL: {
    message: 'Something went wrong on our side.',
    nextStep: 'Try again. If it keeps happening, share the request id with support.',
    action: 'retry',
  },
};

export function describeError(code: ErrorCode): FriendlyError {
  return { title: ERROR_TITLES[code], ...FRIENDLY[code] };
}

/** Error thrown by the API client. Always carries a stable code, never a raw status only. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly problem: ProblemDetails;

  constructor(problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
    this.code = problem.code;
    this.status = problem.status;
    this.problem = problem;
  }

  get requestId(): string | undefined {
    return this.problem.request_id;
  }

  /** Field-level issues keyed by dot path, for form display. */
  get fieldErrors(): Record<string, ValidationIssue[]> {
    const out: Record<string, ValidationIssue[]> = {};
    for (const issue of this.problem.errors ?? []) {
      (out[issue.path] ??= []).push(issue);
    }
    return out;
  }

  get friendly(): FriendlyError {
    return describeError(this.code);
  }
}

/**
 * What to tell the person when an action fails: the server's own explanation (problem+json
 * detail), else its title. Anything that is not an API error is never shown as it is.
 */
export function problemText(error: unknown): string {
  if (error instanceof ApiError) return error.problem.detail ?? error.problem.title;
  return 'Something went wrong. Try again.';
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

/** Build a problem for failures that never reached the API (offline, bad JSON, wrong shape). */
export function localProblem(code: ErrorCode, detail: string): ProblemDetails {
  return {
    type: `about:blank#${code.toLowerCase()}`,
    title: ERROR_TITLES[code],
    status: ERROR_HTTP_STATUS[code],
    code,
    detail,
  };
}
