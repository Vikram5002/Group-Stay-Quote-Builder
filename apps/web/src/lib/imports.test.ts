import { InventoryImportRow, parseWith, RateImportRow } from '@c32/core';
import { fileFormat, IMPORT_COLUMNS, parseImportText, templateCsv } from './imports';

describe('import files', () => {
  it('reads an empty CSV cell as unknown (null), never zero', () => {
    const parsed = parseImportText(
      'inventory',
      'csv',
      'date,room_type,rooms\n2026-11-01,standard,10\n2026-11-02,standard,\n',
    );
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) return;
    expect(parsed.rows).toEqual([
      { date: '2026-11-01', room_type: 'standard', rooms: 10 },
      { date: '2026-11-02', room_type: 'standard', rooms: null },
    ]);
  });

  it('keeps text that is not a whole number as text, so the row check can reject it', () => {
    const parsed = parseImportText(
      'inventory',
      'csv',
      'date,room_type,rooms\n2026-11-01,standard,ten\n2026-11-02,standard,2.5',
    );
    if (!parsed.ok) throw new Error('expected a parse');
    expect(parsed.rows.map((r) => r.rooms)).toEqual(['ten', '2.5']);
  });

  it('names the missing header columns', () => {
    const parsed = parseImportText('rates', 'csv', 'date,room_type\n2026-11-01,standard');
    expect(parsed).toMatchObject({ ok: false, code: 'REQUIRED' });
    expect(parsed.ok ? '' : parsed.message).toMatch(/rate_per_room_night_inr/);
  });

  it('refuses a header the server would refuse: repeated or unknown columns', () => {
    expect(parseImportText('inventory', 'csv', 'date,room_type,rooms,rooms\n1,2,3,4')).toEqual({
      ok: false,
      code: 'INCONSISTENT',
      message: 'A column appears twice in the header row: rooms.',
    });
    expect(parseImportText('inventory', 'csv', 'date,room_type,rooms,x\n1,2,3,4')).toMatchObject({
      ok: false,
      code: 'UNKNOWN_FIELD',
    });
  });

  it('leaves a single odd JSON row to the server, which reports it by row number', () => {
    const parsed = parseImportText(
      'inventory',
      'json',
      '[{"date":"2026-11-01","room_type":"standard","rooms":1},{"date":"2026-11-02","room_type":"standard","rooms":2,"note":"x"}]',
    );
    expect(parsed).toMatchObject({ ok: true });
  });

  it('rejects an empty file and bad JSON', () => {
    expect(parseImportText('inventory', 'csv', '')).toMatchObject({ ok: false });
    expect(parseImportText('inventory', 'json', '{nope')).toMatchObject({
      ok: false,
      code: 'INVALID_JSON',
    });
    expect(parseImportText('inventory', 'json', '{"a":1}')).toMatchObject({
      ok: false,
      code: 'INVALID_TYPE',
    });
  });

  it('reads JSON rows and keeps null as null', () => {
    const parsed = parseImportText(
      'inventory',
      'json',
      '[{"date":"2026-11-01","room_type":"standard","rooms":null}]',
    );
    if (!parsed.ok) throw new Error('expected a parse');
    expect(parsed.rows[0]?.rooms).toBeNull();
  });

  it('templates parse and pass the contract row schemas', () => {
    for (const kind of ['inventory', 'rates'] as const) {
      const parsed = parseImportText(kind, 'csv', templateCsv(kind));
      if (!parsed.ok) throw new Error('template must parse');
      expect(parsed.columns).toEqual(IMPORT_COLUMNS[kind]);
      const schema = kind === 'inventory' ? InventoryImportRow : RateImportRow;
      for (const row of parsed.rows) expect(parseWith(schema, row).ok).toBe(true);
    }
  });

  it('works out the format from the file name', () => {
    expect(fileFormat('Rooms.CSV')).toBe('csv');
    expect(fileFormat('rooms.json')).toBe('json');
    expect(fileFormat('rooms.xlsx')).toBeNull();
  });
});
