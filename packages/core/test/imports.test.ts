import { describe, expect, it } from 'vitest';
import { MAX_IMPORT_ROWS, PROPERTY_ROOM_TYPES, parseImport } from '../src/index.js';

const codes = (r: ReturnType<typeof parseImport>) =>
  r.issues.map((i) => `${i.row}:${i.field}:${i.code}:${i.severity}`);

describe('T21 inventory CSV with an empty rooms cell (blueprint 8.3 sample)', () => {
  const csv =
    'date,room_type,rooms\n2026-11-01,standard,10\n2026-11-02,standard,10\n2026-11-03,standard,\n';
  const r = parseImport('inventory', 'csv', csv);

  it('imports the empty cell as null (unknown), never 0', () => {
    expect(r.rows).toEqual([
      { date: '2026-11-01', room_type: 'standard', rooms: 10 },
      { date: '2026-11-02', room_type: 'standard', rooms: 10 },
      { date: '2026-11-03', room_type: 'standard', rooms: null },
    ]);
  });

  it('lists it as a warning, not an error', () => {
    expect(codes(r)).toEqual(['3:rooms:REQUIRED:warning']);
    expect(r.issues[0]?.message).toBe('Empty: imported as unknown (null), not 0');
    expect(r).toMatchObject({ rows_total: 3, rejected: false });
  });
});

describe('T22 bad rows are listed with row numbers; good rows still import', () => {
  it('rejects bad dates, decimals, text and negatives row by row', () => {
    const csv = [
      'date,room_type,rooms',
      '2026-11-01,standard,10',
      '2026-02-30,standard,10',
      '2026-11-03,standard,2.5',
      '2026-11-04,standard,ten',
      '2026-11-05,Standard Room,4',
      '2026-11-06,standard,-1',
      '2026-11-07,standard,6',
    ].join('\n');
    const r = parseImport('inventory', 'csv', csv);
    expect(r.rows.map((x) => x.date)).toEqual(['2026-11-01', '2026-11-07']);
    expect(r.row_numbers).toEqual([1, 7]);
    expect(codes(r)).toEqual([
      '2:date:INVALID_DATE:error',
      '3:rooms:NOT_INTEGER:error',
      '4:rooms:INVALID_TYPE:error',
      '5:room_type:INVALID_FORMAT:error',
      '6:rooms:OUT_OF_RANGE:error',
    ]);
  });

  it('rejects a repeated night and a row with the wrong number of cells', () => {
    const csv =
      'date,room_type,rooms\n2026-11-01,standard,10\n2026-11-01,standard,8\n2026-11-02,standard\n';
    const r = parseImport('inventory', 'csv', csv);
    expect(r.rows).toHaveLength(1);
    expect(codes(r)).toEqual(['2:date:INCONSISTENT:error', '3:*:INCONSISTENT:error']);
    expect(r.issues[0]?.message).toBe('standard on 2026-11-01 already appears on row 1');
  });

  it('accepts columns in any order and trims spaces', () => {
    const r = parseImport('inventory', 'csv', 'rooms, date ,room_type\n 7 ,2026-11-01,standard\n');
    expect(r.rows).toEqual([{ date: '2026-11-01', room_type: 'standard', rooms: 7 }]);
  });
});

describe('rate plan files', () => {
  it('reads the blueprint rate CSV sample with a missing cost as unknown', () => {
    const csv =
      'date,room_type,rate_per_room_night_inr,variable_cost_per_room_night_inr,rack_rate_inr\n' +
      '2026-11-01,standard,2000,800,2600\n2026-11-02,standard,2000,,2600\n';
    const r = parseImport('rates', 'csv', csv);
    expect(r.rows[1]).toEqual({
      date: '2026-11-02',
      room_type: 'standard',
      rate_per_room_night_inr: 2000,
      variable_cost_per_room_night_inr: null,
      rack_rate_inr: 2600,
    });
    expect(codes(r)).toEqual(['2:variable_cost_per_room_night_inr:REQUIRED:warning']);
  });
});

describe('file-level rejections', () => {
  it.each([
    ['missing column', 'date,room_type\n2026-11-01,standard\n', '1:rooms:REQUIRED:error'],
    ['unknown column', 'date,room_type,rooms,price\n', '1:price:UNKNOWN_FIELD:error'],
    ['duplicate column', 'date,room_type,rooms,rooms\n', '1:*:INCONSISTENT:error'],
    ['empty file', '', '1:*:REQUIRED:error'],
    [
      'bad CSV syntax',
      'date,room_type,rooms\n"2026-11-01,standard,10\n',
      '1:*:INVALID_FORMAT:error',
    ],
  ])('%s', (_label, csv, expected) => {
    const r = parseImport('inventory', 'csv', csv);
    expect(r.rejected).toBe(true);
    expect(r.rows).toEqual([]);
    expect(codes(r)).toContain(expected);
  });

  it('too many rows', () => {
    const csv = [
      'date,room_type,rooms',
      ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => '2026-11-01,standard,1'),
    ].join('\n');
    expect(parseImport('inventory', 'csv', csv)).toMatchObject({
      rejected: true,
      rows_total: MAX_IMPORT_ROWS + 1,
    });
  });
});

describe('JSON files', () => {
  it('accepts an array or { rows }, with explicit null as unknown', () => {
    const rows = [
      { date: '2026-11-01', room_type: 'standard', rooms: 10 },
      { date: '2026-11-03', room_type: 'standard', rooms: null },
    ];
    for (const text of [JSON.stringify(rows), JSON.stringify({ rows })]) {
      const r = parseImport('inventory', 'json', text);
      expect(r.rows).toEqual(rows);
      expect(codes(r)).toEqual(['2:rooms:REQUIRED:warning']);
    }
  });

  it('a missing field or unknown field is an error, not a silent default', () => {
    const r = parseImport(
      'inventory',
      'json',
      JSON.stringify([
        { date: '2026-11-01', room_type: 'standard' },
        { date: '2026-11-02', room_type: 'standard', rooms: 1, extra: 1 },
      ]),
    );
    expect(codes(r)).toEqual(['1:rooms:REQUIRED:error', '2:extra:UNKNOWN_FIELD:error']);
  });

  it('rejects invalid JSON and the wrong top-level shape', () => {
    expect(codes(parseImport('inventory', 'json', '{nope'))).toEqual(['1:*:INVALID_JSON:error']);
    expect(codes(parseImport('inventory', 'json', '{"items":[]}'))).toEqual([
      '1:*:INVALID_TYPE:error',
    ]);
  });
});

describe('room types the property does not sell are rejected', () => {
  it('a suite row is an error naming the room types on sale, with the value', () => {
    const r = parseImport('inventory', 'csv', 'date,room_type,rooms\n2026-11-22,suite,5\n');
    expect(r.rows).toEqual([]);
    expect(r.issues).toEqual([
      {
        row: 1,
        field: 'room_type',
        code: 'INVALID_ENUM',
        message: 'Room type "suite" is not sold here. Use one of: standard, deluxe',
        severity: 'error',
        value: 'suite',
      },
    ]);
  });

  it('the list can be given, for example for another property', () => {
    const csv = 'date,room_type,rooms\n2026-11-22,suite,5\n';
    expect(parseImport('inventory', 'csv', csv, ['suite']).rows).toHaveLength(1);
    expect(PROPERTY_ROOM_TYPES.map((t) => t.code)).toEqual(['standard', 'deluxe']);
  });
});

describe('row problems are in plain words and show the value as written', () => {
  const issue = (r: ReturnType<typeof parseImport>, row: number) =>
    r.issues.find((i) => i.row === row);

  it('CSV inventory rows', () => {
    const csv = [
      'date,room_type,rooms',
      '2026-02-30,standard,10',
      '2026-11-03,standard,2.5',
      '2026-11-04,standard,ten',
      '2026-11-05,Standard Room,4',
      '2026-11-06,standard,-1',
      '2026-11-07,standard,',
      '2026-11-07,standard,3',
    ].join('\n');
    const r = parseImport('inventory', 'csv', csv);
    expect(r.issues.map((i) => [i.row, i.message, i.value])).toEqual([
      [1, 'Date must be YYYY-MM-DD and a real calendar date', '2026-02-30'],
      [2, 'Rooms must be a whole number', '2.5'],
      [3, 'Rooms must be a whole number', 'ten'],
      [4, 'Room type must be a code such as standard', 'Standard Room'],
      [5, 'Rooms must be 0 or more', '-1'],
      [6, 'Empty: imported as unknown (null), not 0', ''],
      [7, 'standard on 2026-11-07 already appears on row 6', '2026-11-07'],
    ]);
    for (const i of r.issues) expect(i.message).not.toMatch(/Invalid input|Too small|Invalid ISO/);
  });

  it('CSV rate rows name the column and its range', () => {
    const csv =
      'date,room_type,rate_per_room_night_inr,variable_cost_per_room_night_inr,rack_rate_inr\n' +
      '2026-11-01,standard,2000000,-5,x\n';
    const r = parseImport('rates', 'csv', csv);
    expect(r.issues.map((i) => [i.field, i.message, i.value])).toEqual([
      ['rate_per_room_night_inr', 'Rate must be between 0 and 10,00,000', '2000000'],
      ['variable_cost_per_room_night_inr', 'Variable cost must be between 0 and 10,00,000', '-5'],
      ['rack_rate_inr', 'Rack rate must be a whole number', 'x'],
    ]);
  });

  it('JSON rows show the value as JSON, so text and numbers can be told apart', () => {
    const r = parseImport(
      'inventory',
      'json',
      JSON.stringify([
        { date: '2026-11-01', room_type: 'standard', rooms: '5' },
        { date: '2026-11-02', room_type: 'standard' },
        { date: '2026-11-03', room_type: 'standard', rooms: 1, extra: 1 },
        'not a row',
      ]),
    );
    expect(issue(r, 1)).toMatchObject({ message: 'Rooms must be a whole number', value: '"5"' });
    expect(issue(r, 2)).toMatchObject({
      message: 'Rooms is missing. Leave it empty (null) if it is unknown',
    });
    expect(issue(r, 2)).not.toHaveProperty('value');
    expect(issue(r, 3)).toMatchObject({ message: 'Unknown column "extra"', value: '1' });
    expect(issue(r, 4)).toMatchObject({
      field: '*',
      message: 'Each row must be an object with date, room_type, rooms',
    });
  });
});
