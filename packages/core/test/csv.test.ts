import { describe, expect, it } from 'vitest';
import { CsvSyntaxError, parseCsv, toCsv } from '../src/index.js';

describe('parseCsv', () => {
  it('reads the blueprint inventory sample, keeping the empty cell empty', () => {
    const text =
      'date,room_type,rooms\n2026-11-01,standard,10\n2026-11-02,standard,10\n2026-11-03,standard,\n';
    expect(parseCsv(text)).toEqual([
      ['date', 'room_type', 'rooms'],
      ['2026-11-01', 'standard', '10'],
      ['2026-11-02', 'standard', '10'],
      ['2026-11-03', 'standard', ''],
    ]);
  });

  it('handles CRLF, a BOM, quotes, embedded commas, quotes and newlines', () => {
    const text = '﻿a,b\r\n"x, y","say ""hi"""\r\n"multi\nline",z\r\n';
    expect(parseCsv(text)).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['multi\nline', 'z'],
    ]);
  });

  it('keeps a last line without a newline and drops trailing blank lines', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('a\n1\n\n\n')).toEqual([['a'], ['1']]);
    expect(parseCsv('')).toEqual([]);
  });

  it.each([
    ['unterminated quote', 'a\n"open', 2],
    ['quote mid cell', 'a\nab"c', 2],
    ['text after a closing quote', 'a\n"x"y', 2],
  ])('rejects %s with the line number', (_label, text, line) => {
    expect(() => parseCsv(text)).toThrow(CsvSyntaxError);
    try {
      parseCsv(text);
    } catch (e) {
      expect((e as CsvSyntaxError).line).toBe(line);
    }
  });
});

describe('toCsv', () => {
  it('writes null as an empty cell (unknown) and quotes only when needed', () => {
    const csv = toCsv(
      ['date', 'rooms', 'note'],
      [
        { date: '2026-11-01', rooms: 10, note: 'plain' },
        { date: '2026-11-03', rooms: null, note: 'has, comma "and quote"' },
      ],
    );
    expect(csv).toBe(
      'date,rooms,note\r\n2026-11-01,10,plain\r\n2026-11-03,,"has, comma ""and quote"""\r\n',
    );
  });

  it('round-trips through parseCsv', () => {
    const rows = [{ a: 'x\ny', b: ' lead', c: 0 }];
    const parsed = parseCsv(toCsv(['a', 'b', 'c'], rows));
    expect(parsed).toEqual([
      ['a', 'b', 'c'],
      ['x\ny', ' lead', '0'],
    ]);
  });

  it('serialises objects as JSON', () => {
    expect(toCsv(['r'], [{ r: ['FLOOR_BREACH'] }])).toBe('r\r\n"[""FLOOR_BREACH""]"\r\n');
  });
});
