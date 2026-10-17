import { ExportLink, parseCsv } from '@c32/core';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryFileStore } from '../../src/files/store.js';
import { readZip } from '../../src/files/zip.js';
import { confirmQuote } from '../../src/services/confirm-quote.js';
import { createQuote } from '../../src/services/create-quote.js';
import {
  EXPECTED_EVIDENCE,
  evidenceFromDir,
  evidenceFromStore,
  exportEvidence,
  exportQuotes,
} from '../../src/services/exports.js';
import type { FileDeps } from '../../src/services/imports.js';
import { hasDb } from '../data/local-db.js';
import { request, sales, serviceHarness } from './harness.js';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

describe.skipIf(!hasDb)('exports and the evidence bundle (DynamoDB Local)', () => {
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
    const q1 = await createQuote(deps, request({ rooms: 9 }), sales);
    await confirmQuote(deps, q1.quote_id, sales);
    const q2 = await createQuote(deps, request({ rooms: 1, rate_per_room_night_inr: 1500 }), sales);
    const fetch = async (link: ExportLink) => {
      const key = link.download_url.replace('https://files.test/download/', '');
      const body = await files.get(key);
      if (!body) throw new Error(`no file at ${key}`);
      return body;
    };
    return { ...h, deps, files, fetch, q1, q2 };
  }

  it('exports quotes as JSON, oldest first, labelled synthetic', async () => {
    const h = await setup();
    const link = ExportLink.parse(await exportQuotes(h.deps, 'json'));
    expect(link.format).toBe('json');
    const doc = JSON.parse((await h.fetch(link)).toString());
    expect(doc.synthetic).toBe(true);
    expect(doc.quotes.map((q: { quote_id: string }) => q.quote_id)).toEqual([
      h.q1.quote_id,
      h.q2.quote_id,
    ]);
  });

  it('exports quotes as CSV with one flat row each', async () => {
    const h = await setup();
    const rows = parseCsv((await h.fetch(await exportQuotes(h.deps, 'csv'))).toString());
    const [header, first, second] = rows;
    expect(header?.slice(0, 3)).toEqual(['quote_id', 'status', 'created_at']);
    const col = (r: string[] | undefined, name: string) => r?.[header?.indexOf(name) ?? -1];
    expect(col(first, 'status')).toBe('CONFIRMED');
    expect(col(first, 'contribution_inr')).toBe('21600');
    expect(col(second, 'reasons')).toBe('FLOOR_BREACH');
  });

  it('T23: the evidence bundle has Track 4 evidence, results, ledger check, versions and checksums', async () => {
    const h = await setup();
    const evidence = evidenceFromDir(
      fileURLToPath(new URL('../../../../evidence', import.meta.url)),
    );
    const link = ExportLink.parse(await exportEvidence(h.deps, { evidence, appVersion: 'test-1' }));
    expect(link.format).toBe('zip');
    const zip = readZip(await h.fetch(link));

    for (const path of [
      'README.md',
      '02-final/generated/quotes.json',
      '02-final/generated/quotes.csv',
      '02-final/generated/audit.json',
      '02-final/generated/inventory.json',
      '02-final/generated/ledger-check.json',
      'manifest.json',
      'checksums.sha256',
    ]) {
      expect(zip.has(path), path).toBe(true);
    }

    const manifest = JSON.parse(zip.get('manifest.json')!.toString());
    expect(manifest).toMatchObject({
      app_version: 'test-1',
      contract_version: '0.2.0',
      synthetic: true,
      ledger_consistent: true,
      counts: { quotes: 2, inventory_nights: 2 },
    });
    expect(manifest.note).toMatch(/synthetic/);

    // Every file's checksum matches, in the manifest and in checksums.sha256.
    const sums = new Map(
      zip
        .get('checksums.sha256')!
        .toString()
        .trim()
        .split('\n')
        .map((l) => [l.slice(66), l.slice(0, 64)] as const),
    );
    for (const f of manifest.files as { path: string; sha256: string; bytes: number }[]) {
      expect(sha(zip.get(f.path)!), f.path).toBe(f.sha256);
      expect(sums.get(f.path)).toBe(f.sha256);
      expect(zip.get(f.path)!.length).toBe(f.bytes);
    }

    // Honest about what Track 4 has not produced yet.
    const present = [...zip.keys()];
    const expectedMissing = EXPECTED_EVIDENCE.filter((p) =>
      p.endsWith('/') ? !present.some((k) => k.startsWith(p)) : !present.includes(p),
    );
    expect(manifest.missing_required_evidence).toEqual(expectedMissing);

    const audit = JSON.parse(zip.get('02-final/generated/audit.json')!.toString());
    expect(audit[h.q1.quote_id].map((e: { type: string }) => e.type)).toEqual([
      'QUOTE_CREATED',
      'CONFIRMED',
    ]);
  });

  it('reads evidence from the documents bucket in AWS and reports nothing missing when complete', async () => {
    const h = await setup();
    await h.files.put('evidence/00-baseline/baseline.json', '{"v":0}', 'application/json');
    await h.files.put('evidence/01-negotiated-scope.md', '# Scope', 'text/markdown');
    await h.files.put('evidence/ledger.csv', 'id,claim\n', 'text/csv');
    const link = await exportEvidence(h.deps, {
      evidence: evidenceFromStore(h.files),
      appVersion: 'x',
    });
    const zip = readZip(await h.fetch(link));
    const manifest = JSON.parse(zip.get('manifest.json')!.toString());
    expect(manifest.missing_required_evidence).toEqual([]);
    expect(zip.get('01-negotiated-scope.md')?.toString()).toBe('# Scope');
  });
});
