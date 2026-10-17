import { ImportReport, checkLedger } from '@c32/core';
import { afterEach, describe, expect, it } from 'vitest';
import { getInventory, getRatePlan } from '../../src/data/catalog.js';
import { MemoryFileStore } from '../../src/files/store.js';
import { createQuote } from '../../src/services/create-quote.js';
import { ServiceError } from '../../src/services/errors.js';
import {
  commitImport,
  MAX_IMPORT_BYTES,
  createUpload,
  validateImport,
  type FileDeps,
} from '../../src/services/imports.js';
import { hasDb, readLedger } from '../data/local-db.js';
import { owner, request, sales, serviceHarness } from './harness.js';

const T21_CSV =
  'date,room_type,rooms\n2026-11-01,standard,10\n2026-11-02,standard,10\n2026-11-03,standard,\n';

describe.skipIf(!hasDb)('imports (DynamoDB Local)', () => {
  let drop: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await drop?.();
    drop = undefined;
  });

  async function setup() {
    const h = await serviceHarness();
    drop = h.drop;
    const files = new MemoryFileStore();
    const deps: FileDeps = { ...h.deps, files };
    /** Simulate the browser: get an upload URL, then PUT the bytes to storage. */
    const upload = async (
      kind: 'inventory' | 'rates',
      text: string,
      format: 'csv' | 'json' = 'csv',
    ) => {
      const u = await createUpload(deps, kind, { format, file_name: `file.${format}` }, owner);
      const key = u.upload_url.replace('https://files.test/upload/', '');
      await files.put(key, text, 'text/csv');
      return u.import_id;
    };
    return { ...h, deps, files, upload };
  }

  it('gives a short-lived upload URL', async () => {
    const h = await setup();
    const u = await createUpload(
      h.deps,
      'inventory',
      { format: 'csv', file_name: 'nov.csv' },
      owner,
    );
    expect(u.upload_url).toMatch(/^https:\/\/files\.test\/upload\/imports\/inventory\/.+\.csv$/);
    expect(Date.parse(u.expires_at) - h.clock.now()).toBe(15 * 60 * 1000);
  });

  it('T21: an empty rooms cell imports as null (unknown) with a warning, not 0', async () => {
    const h = await setup();
    const id = await h.upload('inventory', T21_CSV);
    const v = ImportReport.parse(await validateImport(h.deps, 'inventory', id));
    expect(v).toMatchObject({
      status: 'VALIDATED',
      rows_total: 3,
      rows_accepted: 3,
      rows_rejected: 0,
    });
    expect(v.issues).toEqual([
      expect.objectContaining({ row: 3, field: 'rooms', severity: 'warning' }),
    ]);
    // Validation is a dry run: nothing written yet (fixture has only 11-01 and 11-02).
    expect(await getInventory(h.ctx, 'standard', '2026-11-03', '2026-11-03')).toEqual([]);

    const c = await commitImport(h.deps, 'inventory', id);
    expect(c).toMatchObject({ status: 'COMMITTED', rows_accepted: 3 });
    const night3 = await getInventory(h.ctx, 'standard', '2026-11-03', '2026-11-03');
    expect(night3).toEqual([
      {
        date: '2026-11-03',
        room_type: 'standard',
        total_units: null,
        available_units: null,
        held_units: 0,
        confirmed_units: 0,
      },
    ]);
    // And the engine treats it as unknown, not as 0 rooms.
    const q = await createQuote(
      h.deps,
      request({ stay: { check_in: '2026-11-03', nights: 1 } }),
      sales,
    );
    expect(q.evaluation.reasons).toContain('UNKNOWN_AVAILABILITY');
  });

  it('T22: re-importing identical content changes nothing', async () => {
    const h = await setup();
    const first = await h.upload('inventory', T21_CSV);
    await commitImport(h.deps, 'inventory', first);
    const before = await readLedger(h.ctx);

    const second = await h.upload('inventory', T21_CSV);
    expect((await validateImport(h.deps, 'inventory', second)).status).toBe('UNCHANGED');
    const c = await commitImport(h.deps, 'inventory', second);
    expect(c.status).toBe('UNCHANGED');
    expect(await readLedger(h.ctx)).toEqual(before);
    // Committing the same import twice is a no-op too.
    expect((await commitImport(h.deps, 'inventory', first)).status).toBe('COMMITTED');
  });

  it('T22: a file with bad rows lists them by row number and imports the good ones', async () => {
    const h = await setup();
    const csv =
      'date,room_type,rooms\n2026-11-05,standard,12\n2026-13-01,standard,4\n2026-11-06,standard,2.5\n2026-11-07,standard,9\n';
    const id = await h.upload('inventory', csv);
    const c = await commitImport(h.deps, 'inventory', id);
    expect(c).toMatchObject({
      status: 'COMMITTED',
      rows_total: 4,
      rows_accepted: 2,
      rows_rejected: 2,
    });
    expect(c.issues.map((i) => `${i.row}:${i.field}:${i.code}`)).toEqual([
      '2:date:INVALID_DATE',
      '3:rooms:NOT_INTEGER',
    ]);
    const nights = await getInventory(h.ctx, 'standard', '2026-11-05', '2026-11-07');
    expect(nights.map((n) => [n.date, n.total_units])).toEqual([
      ['2026-11-05', 12],
      ['2026-11-07', 9],
    ]);
  });

  it('never oversells: a total below the rooms already held is refused for that row', async () => {
    const h = await setup();
    await createQuote(h.deps, request({ rooms: 6 }), sales); // holds 6 on 11-01 and 11-02
    const id = await h.upload(
      'inventory',
      'date,room_type,rooms\n2026-11-01,standard,4\n2026-11-02,standard,15\n',
    );
    const v = await validateImport(h.deps, 'inventory', id);
    expect(v.issues.map((i) => i.message)).toEqual([
      '4 rooms is below the 6 already held or confirmed',
    ]);
    const c = await commitImport(h.deps, 'inventory', id);
    expect(c).toMatchObject({ rows_accepted: 1, rows_rejected: 1 });
    const nights = await getInventory(h.ctx, 'standard', '2026-11-01', '2026-11-02');
    expect(nights.map((n) => [n.total_units, n.available_units, n.held_units])).toEqual([
      [10, 4, 6],
      [15, 9, 6],
    ]);
    expect(checkLedger(await readLedger(h.ctx))).toEqual([]);
  });

  it('cannot make availability unknown while rooms are held', async () => {
    const h = await setup();
    await createQuote(h.deps, request({ rooms: 2 }), sales);
    const id = await h.upload('inventory', 'date,room_type,rooms\n2026-11-01,standard,\n');
    const c = await commitImport(h.deps, 'inventory', id);
    expect(c.rows_accepted).toBe(0);
    expect(c.issues.at(-1)?.message).toMatch(/cannot become unknown/);
  });

  it('rates import (JSON) keeps a null cost as unknown', async () => {
    const h = await setup();
    const rows = [
      {
        date: '2026-11-05',
        room_type: 'standard',
        rate_per_room_night_inr: 2200,
        variable_cost_per_room_night_inr: null,
        rack_rate_inr: 2600,
      },
    ];
    const id = await h.upload('rates', JSON.stringify(rows), 'json');
    expect((await commitImport(h.deps, 'rates', id)).status).toBe('COMMITTED');
    expect(await getRatePlan(h.ctx, 'standard', '2026-11-05', '2026-11-05')).toEqual(rows);
  });

  it('a broken file is REJECTED and writes nothing; missing files and ids are errors', async () => {
    const h = await setup();
    const id = await h.upload('inventory', 'date,rooms\n2026-11-01,5\n');
    expect(await commitImport(h.deps, 'inventory', id)).toMatchObject({
      status: 'REJECTED',
      rows_accepted: 0,
    });

    const empty = await createUpload(
      h.deps,
      'inventory',
      { format: 'csv', file_name: 'x.csv' },
      owner,
    );
    await expect(validateImport(h.deps, 'inventory', empty.import_id)).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
    await expect(validateImport(h.deps, 'rates', empty.import_id)).rejects.toBeInstanceOf(
      ServiceError,
    );
    await expect(
      validateImport(h.deps, 'inventory', '01JZZZZZZZZZZZZZZZZZZZZZZZ'),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('an oversized file is REJECTED before parsing (bug bash)', async () => {
    const h = await setup();
    const row = '2026-11-01,standard,1\n';
    const big =
      'date,room_type,rooms\n' + row.repeat(Math.ceil(MAX_IMPORT_BYTES / row.length) + 10);
    const id = await h.upload('inventory', big);
    const r = await commitImport(h.deps, 'inventory', id);
    expect(r).toMatchObject({ status: 'REJECTED', rows_accepted: 0 });
    expect(r.issues[0]?.message).toMatch(/the limit is 2097152/);
  });
});
