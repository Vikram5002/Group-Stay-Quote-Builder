import {
  CONTRACT_VERSION,
  checkLedger,
  toCsv,
  type ExportLink,
  type Quote,
  type QuoteEvent,
} from '@c32/core';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { getInventory } from '../data/catalog.js';
import { readLedgerState } from '../data/ledger.js';
import { getEvents, listQuotes } from '../data/quotes.js';
import type { FileStore } from '../files/store.js';
import { createZip, type ZipEntry } from '../files/zip.js';
import type { FileDeps } from './imports.js';

/**
 * Exports (FR-07, FR-08) and the evidence bundle (FR-15, US-09, T23). Files are written to the
 * file store and handed out as short-lived download links.
 */

const LINK_TTL_SEC = 15 * 60;
const HONESTY =
  'All data in this case is synthetic. No live revenue, market demand or production readiness is claimed.';

/** Track 4's evidence files that the case requires (blueprint 3.3). */
export const EXPECTED_EVIDENCE = ['00-baseline/', '01-negotiated-scope.md', 'ledger.csv'] as const;

export const QUOTE_CSV_COLUMNS = [
  'quote_id',
  'status',
  'created_at',
  'valid_until',
  'created_by',
  'room_type',
  'check_in',
  'nights',
  'requested_rooms',
  'offered_rooms',
  'decision',
  'reasons',
  'room_revenue_inr',
  'variable_cost_inr',
  'inclusions_revenue_inr',
  'inclusions_cost_inr',
  'contribution_inr',
  'contribution_floor_inr',
  'floor_headroom_inr',
  'review_required',
  'terms_hash',
] as const;

/** One flat CSV row per quote; unknown money stays an empty cell, never 0. */
export function quoteCsvRow(q: Quote): Record<string, unknown> {
  const t = q.evaluation.totals;
  return {
    quote_id: q.quote_id,
    status: q.status,
    created_at: q.created_at,
    valid_until: q.valid_until,
    created_by: q.created_by.user_id,
    room_type: q.request.room_type,
    check_in: q.request.stay.check_in,
    nights: q.evaluation.nights,
    requested_rooms: q.evaluation.requested_rooms,
    offered_rooms: q.evaluation.offered_rooms,
    decision: q.evaluation.decision,
    reasons: q.evaluation.reasons.join(' '),
    room_revenue_inr: t.room_revenue_inr,
    variable_cost_inr: t.variable_cost_inr,
    inclusions_revenue_inr: t.inclusions_revenue_inr,
    inclusions_cost_inr: t.inclusions_cost_inr,
    contribution_inr: t.contribution_inr,
    contribution_floor_inr: t.contribution_floor_inr,
    floor_headroom_inr: t.floor_headroom_inr,
    review_required: q.review_required,
    terms_hash: q.terms_hash,
  };
}

async function allQuotes(deps: FileDeps): Promise<Quote[]> {
  const quotes: Quote[] = [];
  let cursor: string | undefined;
  do {
    const page = await listQuotes(deps.data, { limit: 100, ...(cursor ? { cursor } : {}) });
    quotes.push(...page.items);
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  return quotes.reverse(); // oldest first reads better in a file
}

const stamp = (ms: number) => new Date(ms).toISOString().replace(/[:.]/g, '-');
const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

async function link(
  files: FileStore,
  key: string,
  format: ExportLink['format'],
  nowMs: number,
  name: string,
): Promise<ExportLink> {
  return {
    download_url: await files.downloadUrl(key, LINK_TTL_SEC, name),
    format,
    expires_at: new Date(nowMs + LINK_TTL_SEC * 1000).toISOString(),
  };
}

export async function exportQuotes(deps: FileDeps, format: 'csv' | 'json'): Promise<ExportLink> {
  const nowMs = deps.clock.now();
  const quotes = await allQuotes(deps);
  const body =
    format === 'csv'
      ? toCsv(QUOTE_CSV_COLUMNS, quotes.map(quoteCsvRow))
      : JSON.stringify(
          {
            exported_at: new Date(nowMs).toISOString(),
            contract_version: CONTRACT_VERSION,
            synthetic: true,
            quotes,
          },
          null,
          2,
        );
  const name = `quotes-${stamp(nowMs)}.${format}`;
  const key = `exports/${name}`;
  await deps.files.put(key, body, format === 'csv' ? 'text/csv' : 'application/json');
  return link(deps.files, key, format, nowMs, name);
}

/** Evidence files (Track 4) from a folder: the repo's evidence/ locally. */
export function evidenceFromDir(dir: string): () => Promise<ZipEntry[]> {
  return async () => {
    const out: ZipEntry[] = [];
    const walk = async (d: string) => {
      let entries;
      try {
        entries = await readdir(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = join(d, e.name);
        if (e.isDirectory()) await walk(full);
        else
          out.push({ path: relative(dir, full).split(sep).join('/'), data: await readFile(full) });
      }
    };
    await walk(dir);
    return out.sort((a, b) => a.path.localeCompare(b.path));
  };
}

/** Evidence files (Track 4) from the documents bucket under evidence/: in AWS. */
export function evidenceFromStore(files: FileStore): () => Promise<ZipEntry[]> {
  return async () => {
    const keys = await files.list('evidence/');
    const out: ZipEntry[] = [];
    for (const key of keys) {
      const data = await files.get(key);
      if (data) out.push({ path: key.slice('evidence/'.length), data });
    }
    return out;
  };
}

export interface EvidenceOptions {
  evidence: () => Promise<ZipEntry[]>;
  appVersion: string;
}

/**
 * T23: the evidence bundle. Track 4's files as they are, plus generated results from the live
 * table under 02-final/generated/, a manifest with versions and SHA-256 per file, a
 * sha256sum-style checksum list, and a ledger check. Missing required evidence is listed in the
 * manifest, never papered over.
 */
export async function exportEvidence(deps: FileDeps, opts: EvidenceOptions): Promise<ExportLink> {
  const nowMs = deps.clock.now();
  const quotes = await allQuotes(deps);
  const audit: Record<string, QuoteEvent[]> = {};
  for (const q of quotes) audit[q.quote_id] = await getEvents(deps.data, q.quote_id);
  const ledger = await readLedgerState(deps.data);
  const drift = checkLedger(ledger);
  const roomTypes = [...new Set([...ledger.nights.values()].map((n) => n.room_type))].sort();
  const inventory = [];
  for (const t of roomTypes)
    inventory.push(...(await getInventory(deps.data, t, '0000-01-01', '9999-12-31')));

  const generated: ZipEntry[] = [
    { path: '02-final/generated/quotes.json', data: JSON.stringify(quotes, null, 2) },
    {
      path: '02-final/generated/quotes.csv',
      data: toCsv(QUOTE_CSV_COLUMNS, quotes.map(quoteCsvRow)),
    },
    { path: '02-final/generated/audit.json', data: JSON.stringify(audit, null, 2) },
    { path: '02-final/generated/inventory.json', data: JSON.stringify(inventory, null, 2) },
    {
      path: '02-final/generated/ledger-check.json',
      data: JSON.stringify({ consistent: drift.length === 0, drift }, null, 2),
    },
  ];
  const evidence = await opts.evidence();
  const generatedPaths = new Set(generated.map((g) => g.path));
  const content = [...evidence.filter((e) => !generatedPaths.has(e.path)), ...generated];

  const files = content.map((e) => ({
    path: e.path,
    bytes: Buffer.byteLength(e.data),
    sha256: sha256(e.data),
  }));
  const missing = EXPECTED_EVIDENCE.filter((want) =>
    want.endsWith('/')
      ? !evidence.some((e) => e.path.startsWith(want))
      : !evidence.some((e) => e.path === want),
  );
  const manifest = {
    generated_at: new Date(nowMs).toISOString(),
    app_version: opts.appVersion,
    contract_version: CONTRACT_VERSION,
    property_id: deps.data.propertyId,
    synthetic: true,
    note: HONESTY,
    counts: { quotes: quotes.length, inventory_nights: inventory.length },
    ledger_consistent: drift.length === 0,
    missing_required_evidence: missing,
    files,
  };
  const checksums = files.map((f) => `${f.sha256}  ${f.path}`).join('\n') + '\n';
  const zip = createZip([
    ...content,
    { path: 'manifest.json', data: JSON.stringify(manifest, null, 2) },
    { path: 'checksums.sha256', data: checksums },
  ]);

  const name = `evidence-${stamp(nowMs)}.zip`;
  const key = `exports/${name}`;
  await deps.files.put(key, zip, 'application/zip');
  return link(deps.files, key, 'zip', nowMs, name);
}
