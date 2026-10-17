import type { ImportKind } from '@c32/core';
import { parseCsv, toCsv } from './csv';

/** Columns of each file, in template order. They match the row schemas in @c32/core. */
export const IMPORT_COLUMNS: Record<ImportKind, readonly string[]> = {
  inventory: ['date', 'room_type', 'rooms'],
  rates: [
    'date',
    'room_type',
    'rate_per_room_night_inr',
    'variable_cost_per_room_night_inr',
    'rack_rate_inr',
  ],
};

/** The API refuses bigger files (MAX_IMPORT_BYTES in apps/api), so say so before uploading. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export const IMPORT_KIND_LABEL: Record<ImportKind, string> = {
  inventory: 'Inventory (rooms per night)',
  rates: 'Rates and costs',
};

const TEXT_COLUMNS = new Set(['date', 'room_type']);

export type ImportRecord = Record<string, string | number | null>;

export type ParsedImport =
  | { ok: true; rows: ImportRecord[]; columns: readonly string[] }
  | {
      ok: false;
      code: 'INVALID_JSON' | 'REQUIRED' | 'INVALID_TYPE' | 'UNKNOWN_FIELD' | 'INCONSISTENT';
      /** Why the file cannot be read, as one sentence for the file field. */
      message: string;
    };

/** Whole numbers become numbers; anything else stays text so the row schema can reject it. */
function cellValue(column: string, raw: string): string | number | null {
  const value = raw.trim();
  // An empty cell is unknown (null), never zero.
  if (value === '') return null;
  if (TEXT_COLUMNS.has(column)) return value;
  return /^-?\d+$/.test(value) ? Number(value) : value;
}

export function fileFormat(fileName: string): 'csv' | 'json' | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.json')) return 'json';
  return null;
}

const list = (names: readonly string[]) => names.join(', ');

/** The header problem, in one sentence, or null when the columns are right. */
function columnProblem(
  where: 'The header row' | 'The rows',
  expected: readonly string[],
  missing: readonly string[],
  unknown: readonly string[],
): string | null {
  if (missing.length === 0 && unknown.length === 0) return null;
  const tail = `Expected: ${list(expected)}.`;
  if (where === 'The rows') {
    const parts = [
      ...(missing.length > 0 ? [`are missing ${list(missing)}`] : []),
      ...(unknown.length > 0 ? [`have unknown columns ${list(unknown)}`] : []),
    ];
    return `The rows ${parts.join(' and ')}. ${tail}`;
  }
  if (unknown.length === 0) return `The header row is missing: ${list(missing)}. ${tail}`;
  if (missing.length === 0) return `The header row has unknown columns: ${list(unknown)}. ${tail}`;
  return `The header row is missing: ${list(missing)}, and has unknown columns: ${list(unknown)}. ${tail}`;
}

const NO_ROWS = { ok: false, code: 'REQUIRED', message: 'The file has no data rows.' } as const;

/**
 * Read a CSV or JSON import file into records for the preview. File-level problems (not JSON, the
 * wrong shape or columns, no rows) are returned as one sentence for the file field, with the
 * same rules as the server's parseImport; row-level problems are left to the server's check.
 */
export function parseImportText(
  kind: ImportKind,
  format: 'csv' | 'json',
  text: string,
): ParsedImport {
  const expected = IMPORT_COLUMNS[kind];

  if (format === 'json') {
    let data: unknown;
    try {
      data = JSON.parse(text.startsWith('﻿') ? text.slice(1) : text);
    } catch {
      return {
        ok: false,
        code: 'INVALID_JSON',
        message: 'The file is not valid JSON. Check for a missing comma, quote or bracket.',
      };
    }
    // Like the server: a list of rows, or { "rows": [...] }.
    const items: unknown = Array.isArray(data)
      ? data
      : data !== null && typeof data === 'object'
        ? (data as { rows?: unknown }).rows
        : undefined;
    if (!Array.isArray(items)) {
      return {
        ok: false,
        code: 'INVALID_TYPE',
        message: 'The JSON file must be a list of rows, or { "rows": [...] }.',
      };
    }
    if (items.length === 0) return NO_ROWS;
    const objects = items.filter(
      (item): item is Record<string, unknown> =>
        item !== null && typeof item === 'object' && !Array.isArray(item),
    );
    // Columns that are wrong for the whole file; a single odd row is the server's row check.
    if (objects.length > 0) {
      const inEvery = (key: string) => objects.every((o) => key in o);
      const missing = expected.filter((c) => !objects.some((o) => c in o));
      const unknown = Object.keys(objects[0] ?? {}).filter(
        (k) => !expected.includes(k) && inEvery(k),
      );
      const problem = columnProblem('The rows', expected, missing, unknown);
      if (problem) return { ok: false, code: 'REQUIRED', message: problem };
    }
    const rows = items.map((item): ImportRecord => {
      const record: ImportRecord = {};
      if (item && typeof item === 'object') {
        for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
          record[key] = (value ?? null) as string | number | null;
        }
      }
      return record;
    });
    return { ok: true, rows, columns: expected };
  }

  const table = parseCsv(text);
  const [header, ...body] = table;
  if (!header) return { ok: false, code: 'REQUIRED', message: 'The file is empty.' };
  const names = header.map((h) => h.trim());
  const missing = expected.filter((c) => !names.includes(c));
  const problem = columnProblem(
    'The header row',
    expected,
    missing,
    names.filter((c) => !expected.includes(c)),
  );
  if (problem) {
    return { ok: false, code: missing.length > 0 ? 'REQUIRED' : 'UNKNOWN_FIELD', message: problem };
  }
  const twice = names.filter((c, i) => names.indexOf(c) !== i);
  if (twice.length > 0) {
    return {
      ok: false,
      code: 'INCONSISTENT',
      message: `A column appears twice in the header row: ${list([...new Set(twice)])}.`,
    };
  }
  if (body.length === 0) return NO_ROWS;
  const rows = body.map((cells) => {
    const record: ImportRecord = {};
    names.forEach((name, index) => {
      record[name] = cellValue(name, cells[index] ?? '');
    });
    return record;
  });
  return { ok: true, rows, columns: names };
}

const EXAMPLE_ROWS: Record<ImportKind, Array<Array<string | number | null>>> = {
  inventory: [
    ['2026-11-01', 'standard', 10],
    ['2026-11-02', 'standard', null],
  ],
  rates: [
    ['2026-11-01', 'standard', 2000, 800, null],
    ['2026-11-02', 'standard', 2000, null, null],
  ],
};

/** A starter file. Empty cells are unknown values. */
export function templateCsv(kind: ImportKind): string {
  return toCsv([[...IMPORT_COLUMNS[kind]], ...EXAMPLE_ROWS[kind]]);
}

/** Read a chosen file as text, with a fallback for environments without Blob.text(). */
export function readFileText(file: Blob): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read'));
    reader.readAsText(file);
  });
}
