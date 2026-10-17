/** Small RFC 4180 reader and writer: quoted cells, doubled quotes, CRLF, BOM, trailing newline. */

export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let sawAny = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    sawAny = true;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += c;
      }
    } else if (c === '"' && cell === '') {
      quoted = true;
    } else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      sawAny = false;
    } else {
      cell += c;
    }
  }
  if (sawAny || cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // A blank line is not a row.
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function escapeCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Null is written as an empty cell, which reads back as unknown. */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number | null>>): string {
  return rows
    .map((row) => row.map((v) => (v === null ? '' : escapeCell(String(v)))).join(','))
    .join('\r\n')
    .concat('\r\n');
}
