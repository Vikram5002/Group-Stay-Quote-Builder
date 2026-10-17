/**
 * Minimal RFC 4180 CSV for imports and exports (blueprint 8.3): comma separator, double-quote
 * quoting with "" escapes, CRLF or LF line ends, UTF-8 with an optional BOM. An empty cell is
 * returned as an empty string; callers decide what it means (for numbers: unknown, never 0).
 */

export class CsvSyntaxError extends Error {
  constructor(
    readonly line: number,
    message: string,
  ) {
    super(`CSV line ${line}: ${message}`);
    this.name = 'CsvSyntaxError';
  }
}

/** Parse CSV text into rows of cells. Trailing blank lines are ignored. */
export function parseCsv(text: string): string[][] {
  const src = text.startsWith('﻿') ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let quoteLine = 1;
  let i = 0;

  const endCell = () => {
    row.push(cell);
    cell = '';
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };

  while (i < src.length) {
    const ch = src[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        const next = src[i];
        if (next !== undefined && next !== ',' && next !== '\n' && next !== '\r') {
          throw new CsvSyntaxError(line, 'unexpected character after a closing quote');
        }
        continue;
      }
      if (ch === '\n') line++;
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      if (cell !== '') throw new CsvSyntaxError(line, 'quote in the middle of an unquoted cell');
      quoted = true;
      quoteLine = line;
      i++;
    } else if (ch === ',') {
      endCell();
      i++;
    } else if (ch === '\r' || ch === '\n') {
      endRow();
      i += ch === '\r' && src[i + 1] === '\n' ? 2 : 1;
      line++;
    } else {
      cell += ch;
      i++;
    }
  }
  if (quoted) throw new CsvSyntaxError(quoteLine, 'unterminated quoted cell');
  if (cell !== '' || row.length > 0) endRow();

  while (rows.length > 0 && rows.at(-1)?.every((c) => c === '')) rows.pop();
  return rows;
}

function quote(value: string): string {
  return /[",\r\n]/.test(value) || /^\s|\s$/.test(value)
    ? `"${value.replaceAll('"', '""')}"`
    : value;
}

/** Write rows as CSV with a header. null and undefined become empty cells (unknown). */
export function toCsv(
  columns: readonly string[],
  rows: readonly Record<string, unknown>[],
): string {
  const lines = [columns.map(quote).join(',')];
  for (const r of rows) {
    lines.push(
      columns
        .map((c) => {
          const v = r[c];
          if (v === null || v === undefined) return '';
          return quote(typeof v === 'object' ? JSON.stringify(v) : String(v));
        })
        .join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}
