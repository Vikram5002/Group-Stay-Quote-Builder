import express from 'express';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalFileStore, MemoryFileStore, localFilesRouter } from '../src/files/store.js';

describe('MemoryFileStore', () => {
  it('puts, gets and lists by prefix', async () => {
    const s = new MemoryFileStore();
    await s.put('imports/a.csv', 'x', 'text/csv');
    await s.put('exports/b.json', '{}', 'application/json');
    expect((await s.get('imports/a.csv'))?.toString()).toBe('x');
    expect(await s.get('missing')).toBeNull();
    expect(await s.list('imports/')).toEqual(['imports/a.csv']);
    expect(await s.uploadUrl('imports/a.csv')).toBe('https://files.test/upload/imports/a.csv');
  });

  it('refuses unsafe keys', async () => {
    const s = new MemoryFileStore();
    for (const bad of ['../etc/passwd', '/abs', 'a b', 'x/../../y']) {
      await expect(s.put(bad, 'x', 'text/plain')).rejects.toBeInstanceOf(RangeError);
    }
  });
});

describe('LocalFileStore and its dev router', () => {
  let dir: string;
  let store: LocalFileStore;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'c32-files-'));
    store = new LocalFileStore(dir, 'http://localhost:3000');
  });
  afterAll(async () => rm(dir, { recursive: true, force: true }));

  it('writes nested keys and lists them with forward slashes', async () => {
    await store.put('evidence/00-baseline/a.json', '{"a":1}', 'application/json');
    await store.put('evidence/ledger.csv', 'id\n', 'text/csv');
    expect(await store.list('evidence/')).toEqual([
      'evidence/00-baseline/a.json',
      'evidence/ledger.csv',
    ]);
    expect(await store.downloadUrl('evidence/ledger.csv')).toBe(
      'http://localhost:3000/local-files/evidence/ledger.csv',
    );
  });

  it('cannot be tricked outside its folder', () => {
    expect(() => store.path('../outside.txt')).toThrow(RangeError);
  });

  it('serves uploads and downloads like presigned URLs', async () => {
    const app = express();
    app.use('/local-files', localFilesRouter(store));
    await request(app)
      .put('/local-files/imports/up.csv')
      .set('content-type', 'text/csv')
      .send('date\n')
      .expect(200);
    expect((await store.get('imports/up.csv'))?.toString()).toBe('date\n');
    const res = await request(app)
      .get('/local-files/imports/up.csv')
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect((res.body as Buffer).toString()).toBe('date\n');
    await request(app).get('/local-files/imports/none.csv').expect(404);
  });
});
