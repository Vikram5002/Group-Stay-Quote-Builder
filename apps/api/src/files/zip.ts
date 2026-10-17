import { crc32 } from 'node:zlib';

/**
 * A minimal ZIP writer (stored entries, no compression) for the evidence bundle. Evidence files
 * are small, and a stored zip opens everywhere and is trivially verifiable. Uses the
 * runtime's crc32, so no dependency.
 */

export interface ZipEntry {
  /** Forward-slash path inside the archive, for example "02-final/quotes.json". */
  path: string;
  data: Buffer | string;
}

/** DOS date/time for a fixed instant, so the same inputs always produce the same bytes. */
function dosDateTime(d: Date): { date: number; time: number } {
  return {
    date: ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
  };
}

export function createZip(
  entries: readonly ZipEntry[],
  modified = new Date(Date.UTC(2026, 0, 1)),
): Buffer {
  const { date, time } = dosDateTime(modified);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  const seen = new Set<string>();

  for (const entry of entries) {
    if (
      !entry.path ||
      entry.path.startsWith('/') ||
      entry.path.includes('..') ||
      entry.path.includes('\\')
    ) {
      throw new RangeError(`Unsafe zip path: ${entry.path}`);
    }
    if (seen.has(entry.path)) throw new RangeError(`Duplicate zip path: ${entry.path}`);
    seen.add(entry.path);

    const name = Buffer.from(entry.path, 'utf8');
    const data = Buffer.from(entry.data);
    const crc = crc32(data) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/** Read a stored zip back (tests and verification). */
export function readZip(zip: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let p = 0;
  while (zip.readUInt32LE(p) === 0x04034b50) {
    const size = zip.readUInt32LE(p + 18);
    const nameLen = zip.readUInt16LE(p + 26);
    const extra = zip.readUInt16LE(p + 28);
    const name = zip.subarray(p + 30, p + 30 + nameLen).toString('utf8');
    const start = p + 30 + nameLen + extra;
    const data = zip.subarray(start, start + size);
    if (crc32(data) >>> 0 !== zip.readUInt32LE(p + 14)) throw new Error(`CRC mismatch in ${name}`);
    out.set(name, data);
    p = start + size;
  }
  return out;
}
