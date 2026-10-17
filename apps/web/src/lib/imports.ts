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
  | { ok: false; code: 'INVALID_JSON' | 'REQUIRED' | 'INVALID_TYPE'; message: string };

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

/** Read a CSV or JSON import file into records. Header and shape problems are returned, not thrown. */
export function parseImportText(
  kind: ImportKind,
  format: 'csv' | 'json',
  text: string,
): ParsedImport {
  const expected = IMPORT_COLUMNS[kind];

  if (format === 'json') {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, code: 'INVALID_JSON', message: 'The file is not valid JSON.' };
    }
    if (!Array.isArray(data)) {
      return { ok: false, code: 'INVALID_TYPE', message: 'The JSON file must be a list of rows.' };
    }
    const rows = data.map((item): ImportRecord => {
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
  if (missing.length > 0) {
    return {
      ok: false,
      code: 'REQUIRED',
      message: `The header row is missing: ${missing.join(', ')}. Expected: ${expected.join(', ')}.`,
    };
  }
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
