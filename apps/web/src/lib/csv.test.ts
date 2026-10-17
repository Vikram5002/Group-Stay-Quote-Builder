import { parseCsv, toCsv } from './csv';

describe('csv', () => {
  it('reads plain rows, with or without a trailing newline', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles CRLF, a BOM and blank lines', () => {
    expect(parseCsv('﻿a,b\r\n\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps empty cells as empty text so the caller can treat them as unknown', () => {
    expect(parseCsv('a,b,c\n1,,3\n,,')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
      ['', '', ''],
    ]);
  });

  it('reads quoted cells with commas, quotes and line breaks', () => {
    expect(parseCsv('name,note\n"Acme, Inc","say ""hi""\nthere"')).toEqual([
      ['name', 'note'],
      ['Acme, Inc', 'say "hi"\nthere'],
    ]);
  });

  it('writes null as an empty cell and quotes where needed', () => {
    expect(
      toCsv([
        ['a', 'b'],
        ['x,y', null],
        ['say "hi"', 3],
      ]),
    ).toBe('a,b\r\n"x,y",\r\n"say ""hi""",3\r\n');
  });

  it('round-trips', () => {
    const rows = [
      ['a', 'b'],
      ['x,y', '"q"'],
      ['', 'line\nbreak'],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});
