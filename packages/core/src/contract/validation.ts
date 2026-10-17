import type { z } from 'zod';
import { VALIDATION_ISSUE_CODES, type ValidationIssueCode } from './codes.js';
import type { ValidationIssue } from './problem.js';

export type ParseResult<T> = { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };

type ZodIssue = z.core.$ZodIssue;

function joinPath(path: readonly PropertyKey[]): string {
  return path.map(String).join('.');
}

function isIssueCode(value: unknown): value is ValidationIssueCode {
  return typeof value === 'string' && (VALIDATION_ISSUE_CODES as readonly string[]).includes(value);
}

function codeFor(issue: ZodIssue): ValidationIssueCode {
  switch (issue.code) {
    case 'invalid_type':
      if (issue.input === undefined) return 'REQUIRED';
      if (issue.expected === 'int' && typeof issue.input === 'number') return 'NOT_INTEGER';
      return 'INVALID_TYPE';
    case 'too_small':
    case 'too_big':
      return issue.origin === 'string' || issue.origin === 'array'
        ? 'INVALID_LENGTH'
        : 'OUT_OF_RANGE';
    case 'invalid_format':
      return issue.format === 'date' || issue.format === 'datetime'
        ? 'INVALID_DATE'
        : 'INVALID_FORMAT';
    case 'invalid_value':
      return 'INVALID_ENUM';
    case 'custom': {
      const code: unknown = issue.params?.['code'];
      return isIssueCode(code) ? code : 'INVALID_VALUE';
    }
    default:
      return 'INVALID_VALUE';
  }
}

/** Map Zod issues to the contract's stable field-level codes. One issue per unknown key. */
export function toValidationIssues(issues: readonly ZodIssue[]): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const issue of issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        out.push({
          path: joinPath([...issue.path, key]),
          code: 'UNKNOWN_FIELD',
          message: `Unknown field "${key}"`,
        });
      }
      continue;
    }
    const code = codeFor(issue);
    const message = code === 'REQUIRED' && issue.code !== 'custom' ? 'Required' : issue.message;
    out.push({ path: joinPath(issue.path), code, message });
  }
  return out;
}

/**
 * Validate untrusted input against a contract schema. Never throws.
 * `reportInput` lets the mapper tell a missing field (REQUIRED) from a wrong type; the input
 * itself is never copied into the returned issues.
 */
export function parseWith<S extends z.ZodType>(schema: S, input: unknown): ParseResult<z.infer<S>> {
  const result = schema.safeParse(input, { reportInput: true });
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, issues: toValidationIssues(result.error.issues) };
}
