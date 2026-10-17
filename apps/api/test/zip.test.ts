import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createZip, readZip } from '../src/files/zip.js';

describe('zip writer', () => {
  const entries = [
    { path: 'manifest.json', data: '{"ok":true}' },
    { path: '02-final/quotes.csv', data: 'id\r\n1\r\n' },
    { path: 'unicode-é.txt', data: Buffer.from([0, 1, 2, 255]) },
  ];

  it('round-trips with CRC checks', () => {
    const files = readZip(createZip(entries));
    expect([...files.keys()]).toEqual(entries.map((e) => e.path));
    expect(files.get('manifest.json')?.toString()).toBe('{"ok":true}');
    expect([...(files.get('unicode-é.txt') ?? [])]).toEqual([0, 1, 2, 255]);
  });

  it('is deterministic for the same inputs', () => {
    expect(createZip(entries).equals(createZip(entries))).toBe(true);
  });

  it('refuses unsafe or duplicate paths', () => {
    for (const path of ['', '/abs', '../x', 'a\\b']) {
      expect(() => createZip([{ path, data: 'x' }])).toThrow(RangeError);
    }
    expect(() =>
      createZip([
        { path: 'a', data: '1' },
        { path: 'a', data: '2' },
      ]),
    ).toThrow(/Duplicate/);
  });

  it('opens with an independent reader (Python zipfile) when Python is installed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'c32-zip-'));
    try {
      const file = join(dir, 'b.zip');
      await writeFile(file, createZip(entries));
      const script =
        'import zipfile,sys,json; z=zipfile.ZipFile(sys.argv[1]); ' +
        'print(json.dumps({"bad": z.testzip(), "names": z.namelist()}))';
      // The first interpreter that actually runs (Windows has a non-working python3 alias).
      const python = ['python3', 'python'].find((cmd) => {
        try {
          execFileSync(cmd, ['--version'], { stdio: 'ignore' });
          return true;
        } catch {
          return false;
        }
      });
      if (!python) return; // no Python here; the round-trip test still covers the format
      const out = execFileSync(python, ['-c', script, file], { encoding: 'utf8' });
      const result = JSON.parse(out) as { bad: string | null; names: string[] };
      expect(result.bad).toBeNull();
      expect(result.names).toEqual(entries.map((e) => e.path));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
