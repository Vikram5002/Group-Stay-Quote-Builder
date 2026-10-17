import type { z } from 'zod';
import {
  InventoryImportRow,
  RateImportRow,
  type ImportKind,
  type ImportRowIssue,
} from '../contract/imports.js';
import { parseWith } from '../contract/validation.js';
import { CsvSyntaxError, parseCsv } from './csv.js';

/**
 * Parse an inventory or rate-plan file (FR-07, blueprint 8.3) into typed rows and a row-level
 * report. Rules:
 * - An empty number cell (CSV) or explicit null (JSON) imports as null, unknown, never 0, and
 *   the row gets a warning saying so (T21).
 * - Invalid rows are rejected with their 1-based data row number and field (T22); valid rows
 *   are still accepted, so one typo does not block a whole calendar.
 * - A night (date and room type) may appear once per file.
 * - Header problems (missing or unknown columns), bad CSV syntax or bad JSON reject the file.
 */

export const IMPORT_COLUMNS = {
  inventory: ['date', 'room_type', 'rooms'],
  rates: [
    'date',
    'room_type',
    'rate_per_room_night_inr',
    'variable_cost_per_room_night_inr',
    'rack_rate_inr',
  ],
} as const satisfies Record<ImportKind, readonly string[]>;

const NUMERIC: Record<ImportKind, ReadonlySet<string>> = {
  inventory: new Set(['rooms']),
  rates: new Set(['rate_per_room_night_inr', 'variable_cost_per_room_night_inr', 'rack_rate_inr']),
};

export const MAX_IMPORT_ROWS = 5000;

export type ImportRow = InventoryImportRow | RateImportRow;

export interface ParsedImport<R extends ImportRow = ImportRow> {
  /** Accepted rows, in file order. */
  rows: R[];
  /** The 1-based data row number of each accepted row, for later row-level issues. */
  row_numbers: number[];
  issues: ImportRowIssue[];
  rows_total: number;
  /** True when the file as a whole is unusable (header, syntax, JSON, size). */
  rejected: boolean;
}

const issue = (
  row: number,
  field: string,
  code: ImportRowIssue['code'],
  message: string,
  severity: ImportRowIssue['severity'] = 'error',
): ImportRowIssue => ({ row, field, code, message, severity });

function fileRejected(issues: ImportRowIssue[], total = 0): ParsedImport {
  return { rows: [], row_numbers: [], issues, rows_total: total, rejected: true };
}

/** CSV cell -> value. '' -> null for numbers; integers only; anything else is kept for Zod. */
function cellValue(raw: string, numeric: boolean): unknown {
  const v = raw.trim();
  if (!numeric) return v;
  if (v === '') return null;
  if (/^-?\d+$/.test(v)) return Number(v);
  if (/^-?\d*\.\d+$/.test(v)) return Number(v); // Zod reports NOT_INTEGER
  return v; // Zod reports INVALID_TYPE
}

function schemaFor(kind: ImportKind): z.ZodType<ImportRow> {
  return (kind === 'inventory' ? InventoryImportRow : RateImportRow) as z.ZodType<ImportRow>;
}

/** Validate candidate row objects (from CSV or JSON) into accepted rows and issues. */
function validateRows(kind: ImportKind, candidates: unknown[]): ParsedImport {
  const schema = schemaFor(kind);
  const rows: ImportRow[] = [];
  const rowNumbers: number[] = [];
  const issues: ImportRowIssue[] = [];
  const seen = new Map<string, number>();

  candidates.forEach((candidate, i) => {
    const rowNo = i + 1;
    const parsed = parseWith(schema, candidate);
    if (!parsed.ok) {
      for (const p of parsed.issues) issues.push(issue(rowNo, p.path || '*', p.code, p.message));
      return;
    }
    const r = parsed.value;
    const key = `${r.room_type}#${r.date}`;
    const first = seen.get(key);
    if (first !== undefined) {
      issues.push(
        issue(
          rowNo,
          'date',
          'INCONSISTENT',
          `${r.room_type} on ${r.date} already appears on row ${first}`,
        ),
      );
      return;
    }
    seen.set(key, rowNo);
    for (const field of NUMERIC[kind]) {
      if ((r as Record<string, unknown>)[field] === null) {
        issues.push(
          issue(rowNo, field, 'REQUIRED', 'Empty: imported as unknown (null), not 0', 'warning'),
        );
      }
    }
    rows.push(r);
    rowNumbers.push(rowNo);
  });
  return { rows, row_numbers: rowNumbers, issues, rows_total: candidates.length, rejected: false };
}

function parseCsvImport(kind: ImportKind, text: string): ParsedImport {
  let table: string[][];
  try {
    table = parseCsv(text);
  } catch (e) {
    if (e instanceof CsvSyntaxError) {
      return fileRejected([issue(Math.max(1, e.line - 1), '*', 'INVALID_FORMAT', e.message)]);
    }
    throw e;
  }
  const [header, ...body] = table;
  if (!header) return fileRejected([issue(1, '*', 'REQUIRED', 'The file is empty')]);

  const columns = header.map((h) => h.trim());
  const expected: readonly string[] = IMPORT_COLUMNS[kind];
  const headerIssues: ImportRowIssue[] = [
    ...expected
      .filter((c) => !columns.includes(c))
      .map((c) => issue(1, c, 'REQUIRED', `Missing column "${c}"`)),
    ...columns
      .filter((c) => !expected.includes(c))
      .map((c) => issue(1, c, 'UNKNOWN_FIELD', `Unknown column "${c}"`)),
  ];
  if (new Set(columns).size !== columns.length) {
    headerIssues.push(issue(1, '*', 'INCONSISTENT', 'A column appears twice'));
  }
  if (headerIssues.length > 0) return fileRejected(headerIssues, body.length);
  if (body.length > MAX_IMPORT_ROWS) {
    return fileRejected(
      [issue(1, '*', 'OUT_OF_RANGE', `At most ${MAX_IMPORT_ROWS} rows`)],
      body.length,
    );
  }

  const shapeIssues: ImportRowIssue[] = [];
  const candidates: unknown[] = body.map((cells, i) => {
    if (cells.length !== columns.length) {
      shapeIssues.push(
        issue(
          i + 1,
          '*',
          'INCONSISTENT',
          `Expected ${columns.length} cells, found ${cells.length}`,
        ),
      );
      return undefined;
    }
    return Object.fromEntries(
      columns.map((c, j) => [c, cellValue(cells[j] ?? '', NUMERIC[kind].has(c))]),
    );
  });
  const result = validateRows(kind, candidates);
  // A row with the wrong cell count is reported once, as a shape problem.
  const badShape = new Set(shapeIssues.map((s) => s.row));
  return {
    ...result,
    issues: [...shapeIssues, ...result.issues.filter((x) => !badShape.has(x.row))].sort(
      (a, b) => a.row - b.row,
    ),
  };
}

function parseJsonImport(kind: ImportKind, text: string): ParsedImport {
  let data: unknown;
  try {
    data = JSON.parse(text.startsWith('﻿') ? text.slice(1) : text);
  } catch {
    return fileRejected([issue(1, '*', 'INVALID_JSON', 'The file is not valid JSON')]);
  }
  const rows = Array.isArray(data)
    ? data
    : typeof data === 'object' && data !== null && Array.isArray((data as { rows?: unknown }).rows)
      ? (data as { rows: unknown[] }).rows
      : null;
  if (rows === null) {
    return fileRejected([
      issue(1, '*', 'INVALID_TYPE', 'Expected an array of rows or { "rows": [...] }'),
    ]);
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    return fileRejected(
      [issue(1, '*', 'OUT_OF_RANGE', `At most ${MAX_IMPORT_ROWS} rows`)],
      rows.length,
    );
  }
  return validateRows(kind, rows);
}

export function parseImport(kind: ImportKind, format: 'csv' | 'json', text: string): ParsedImport {
  return format === 'csv' ? parseCsvImport(kind, text) : parseJsonImport(kind, text);
}
