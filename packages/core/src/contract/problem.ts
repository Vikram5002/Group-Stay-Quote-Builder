import { z } from 'zod';
import {
  ERROR_HTTP_STATUS,
  ERROR_TITLES,
  ErrorCode,
  ValidationIssueCode,
  type ErrorCode as ErrorCodeT,
} from './codes.js';

export const PROBLEM_TYPE_BASE = 'https://c32.example/problems/';

export const ValidationIssue = z.strictObject({
  /** Dot path to the field, for example "stay.nights" or "inclusions.0.unit_cost_inr". */
  path: z.string(),
  code: ValidationIssueCode,
  message: z.string(),
});
export type ValidationIssue = z.infer<typeof ValidationIssue>;

/** RFC 9457 problem details with a stable machine-readable code (ADR 9). */
export const ProblemDetails = z.strictObject({
  type: z.string(),
  title: z.string(),
  status: z.int().min(400).max(599),
  code: ErrorCode,
  detail: z.string().optional(),
  instance: z.string().optional(),
  request_id: z.string().optional(),
  errors: z.array(ValidationIssue).optional(),
});
export type ProblemDetails = z.infer<typeof ProblemDetails>;

export interface ProblemOptions {
  detail?: string;
  instance?: string;
  requestId?: string;
  errors?: ValidationIssue[];
}

/** "APPROVAL_REQUIRED" -> "approval-required" */
export function problemSlug(code: ErrorCodeT): string {
  return code.toLowerCase().replaceAll('_', '-');
}

export function problem(code: ErrorCodeT, opts: ProblemOptions = {}): ProblemDetails {
  const p: ProblemDetails = {
    type: PROBLEM_TYPE_BASE + problemSlug(code),
    title: ERROR_TITLES[code],
    status: ERROR_HTTP_STATUS[code],
    code,
  };
  if (opts.detail !== undefined) p.detail = opts.detail;
  if (opts.instance !== undefined) p.instance = opts.instance;
  if (opts.requestId !== undefined) p.request_id = opts.requestId;
  if (opts.errors !== undefined) p.errors = opts.errors;
  return p;
}
