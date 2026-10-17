import { ExportLink, ImportReport, ImportUploadResponse, ROUTES } from '@c32/core';
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { devAuthenticate } from '../../src/auth.js';
import { MemoryFileStore } from '../../src/files/store.js';
import { readZip } from '../../src/files/zip.js';
import { fileHandlers } from '../../src/routes/files.js';
import { hasDb } from '../data/local-db.js';
import { serviceHarness } from '../services/harness.js';

process.env['LOG_SILENT'] = '1';

describe('file handlers are contract operations', () => {
  it('every file handler name is a ROUTES operationId', () => {
    const ids = new Set(ROUTES.map((r) => r.operationId));
    const names = Object.keys(
      fileHandlers({ files: new MemoryFileStore(), evidence: async () => [], appVersion: 'x' }),
    );
    expect(names).toHaveLength(5);
    for (const n of names) expect(ids.has(n)).toBe(true);
  });
});

describe.skipIf(!hasDb)('imports and exports over HTTP (DynamoDB Local)', () => {
  let app: Express;
  let files: MemoryFileStore;
  let drop: () => Promise<void>;
  beforeEach(async () => {
    const h = await serviceHarness();
    drop = h.drop;
    files = new MemoryFileStore();
    app = createApp({
      deps: h.deps,
      authenticate: devAuthenticate,
      files: { files, evidence: async () => [{ path: 'README.md', data: '# evidence' }] },
    });
  });
  afterEach(async () => drop());

  const owner = (method: 'get' | 'post', path: string) =>
    request(app)[method](path).set('x-dev-user', 'owner-1:Owner');

  async function uploaded(text: string) {
    const res = await owner('post', '/v1/imports/inventory/uploads')
      .send({ format: 'csv', file_name: 'nov.csv' })
      .expect(200);
    const u = ImportUploadResponse.parse(res.body);
    await files.put(u.upload_url.replace('https://files.test/upload/', ''), text, 'text/csv');
    return u.import_id;
  }

  it('upload, validate, commit; identical content again is UNCHANGED (T21, T22)', async () => {
    const csv = 'date,room_type,rooms\n2026-11-03,standard,\n2026-11-04,standard,8\n';
    const id = await uploaded(csv);
    const v = ImportReport.parse(
      (await owner('post', `/v1/imports/inventory/${id}/validate`).expect(200)).body,
    );
    expect(v).toMatchObject({ status: 'VALIDATED', rows_accepted: 2 });
    expect(v.issues[0]).toMatchObject({ row: 1, field: 'rooms', severity: 'warning' });
    const c = ImportReport.parse(
      (await owner('post', `/v1/imports/inventory/${id}/commit`).expect(200)).body,
    );
    expect(c.status).toBe('COMMITTED');

    const again = await uploaded(csv);
    const u = ImportReport.parse(
      (await owner('post', `/v1/imports/inventory/${again}/commit`).expect(200)).body,
    );
    expect(u.status).toBe('UNCHANGED');
  });

  it('validation errors and unknown ids', async () => {
    const res = await owner('post', '/v1/imports/inventory/uploads')
      .send({ format: 'xml', file_name: 'a' })
      .expect(422);
    expect(res.body.errors[0].path).toBe('format');
    await owner('post', '/v1/imports/nope/01JZZZZZZZZZZZZZZZZZZZZZZZ/validate').expect(404);
    await owner('post', '/v1/imports/inventory/not-an-id/commit').expect(404);
    const empty = ImportUploadResponse.parse(
      (
        await owner('post', '/v1/imports/inventory/uploads').send({
          format: 'csv',
          file_name: 'a.csv',
        })
      ).body,
    );
    expect(
      (await owner('post', `/v1/imports/inventory/${empty.import_id}/validate`).expect(409)).body
        .code,
    ).toBe('INVALID_STATE');
  });

  it('exports quotes and the evidence bundle as download links', async () => {
    const q = ExportLink.parse(
      (await owner('get', '/v1/exports/quotes?format=json').expect(200)).body,
    );
    expect(q.format).toBe('json');
    await owner('get', '/v1/exports/quotes?format=xml').expect(422);
    await owner('get', '/v1/exports/quotes').expect(422);

    const e = ExportLink.parse((await owner('get', '/v1/exports/evidence').expect(200)).body);
    const zip = await files.get(e.download_url.replace('https://files.test/download/', ''));
    const entries = readZip(zip as Buffer);
    expect(entries.get('README.md')?.toString()).toBe('# evidence');
    expect(entries.has('manifest.json')).toBe(true);
  });

  it('imports are Owner-only; exports are open to every signed-in role', async () => {
    for (const user of ['s-1:Sales', 'v-1:Viewer']) {
      await request(app)
        .post('/v1/imports/inventory/uploads')
        .set('x-dev-user', user)
        .send({ format: 'csv', file_name: 'a.csv' })
        .expect(403);
    }
    await request(app).get('/v1/exports/evidence').set('x-dev-user', 'v-1:Viewer').expect(200);
    await request(app).get('/v1/exports/evidence').expect(401);
  });

  it('without a file store the file routes are not mounted', async () => {
    const h = await serviceHarness();
    try {
      const bare = createApp({ deps: h.deps, authenticate: devAuthenticate });
      await request(bare).get('/v1/exports/evidence').set('x-dev-user', 'v-1:Viewer').expect(404);
    } finally {
      await h.drop();
    }
  });
});
