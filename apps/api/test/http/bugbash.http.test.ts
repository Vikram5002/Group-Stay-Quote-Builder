import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { devAuthenticate } from '../../src/auth.js';
import { MemoryFileStore } from '../../src/files/store.js';
import { hasDb } from '../data/local-db.js';
import { serviceHarness } from '../services/harness.js';

process.env['LOG_SILENT'] = '1';

/** Regression tests for issues found in the T1.14 bug bash. */
describe.skipIf(!hasDb)('bug bash regressions (DynamoDB Local)', () => {
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
      files: { files, evidence: async () => [] },
    });
  });
  afterEach(async () => drop());

  it('a well-formed but bogus cursor is 422, not 500', async () => {
    for (const key of [{ a: 1 }, { PK: 'PROP#p1' }, { PK: 1, SK: 2 }]) {
      const cursor = Buffer.from(JSON.stringify(key)).toString('base64url');
      for (const q of [`cursor=${cursor}`, `status=OFFERED&cursor=${cursor}`]) {
        const res = await request(app).get(`/v1/quotes?${q}`).set('x-dev-user', 'v-1:Viewer');
        expect(res.status, q).toBe(422);
        expect(res.body.errors[0].path).toBe('cursor');
      }
    }
  });
});
