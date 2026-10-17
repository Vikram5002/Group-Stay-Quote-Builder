import {
  counted,
  parseImport,
  plural,
  type Actor,
  type ImportKind,
  type ImportReport,
  type ImportRowIssue,
  type ImportUploadRequest,
  type ImportUploadResponse,
  type InventoryImportRow,
  type RateImportRow,
} from '@c32/core';
import { createHash } from 'node:crypto';
import { getInventory, putRatePlan } from '../data/catalog.js';
import {
  getImport,
  markCommitted,
  putImport,
  saveImportReport,
  setInventoryTotal,
  wasCommitted,
  type ImportRecord,
} from '../data/imports.js';
import type { FileStore } from '../files/store.js';
import type { ServiceDeps } from './create-quote.js';
import { ServiceError } from './errors.js';

/**
 * Inventory and rate imports (FR-07, US-07, blueprint 8.3), two-step:
 *   1. POST uploads  -> a short-lived URL; the browser PUTs the file straight to storage.
 *   2. POST validate -> dry run: row-level report against the live ledger, nothing written.
 *   3. POST commit   -> re-validates and writes the accepted rows; identical content that was
 *                       already committed is UNCHANGED and writes nothing (T22).
 */

export interface FileDeps extends ServiceDeps {
  files: FileStore;
}

const UPLOAD_TTL_SEC = 15 * 60;
/** 5000 rows of CSV are well under 1 MiB; anything far bigger is a mistake or abuse. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const CONTENT_TYPE = { csv: 'text/csv', json: 'application/json' } as const;

export async function createUpload(
  deps: FileDeps,
  kind: ImportKind,
  req: ImportUploadRequest,
  actor: Actor,
): Promise<ImportUploadResponse> {
  const nowMs = deps.clock.now();
  const importId = deps.newId();
  const rec: ImportRecord = {
    import_id: importId,
    kind,
    format: req.format,
    file_name: req.file_name,
    file_key: `imports/${kind}/${importId}.${req.format}`,
    created_by: actor.user_id,
    created_at: new Date(nowMs).toISOString(),
    report: null,
  };
  await putImport(deps.data, rec, nowMs);
  return {
    import_id: importId,
    upload_url: await deps.files.uploadUrl(rec.file_key, CONTENT_TYPE[req.format], UPLOAD_TTL_SEC),
    expires_at: new Date(nowMs + UPLOAD_TTL_SEC * 1000).toISOString(),
  };
}

interface Analysis {
  report: ImportReport;
  /** Rows to write, with their data row numbers. */
  accepted: { row: number; value: InventoryImportRow | RateImportRow }[];
}

async function load(deps: FileDeps, kind: ImportKind, importId: string): Promise<ImportRecord> {
  const rec = await getImport(deps.data, importId);
  if (!rec || rec.kind !== kind)
    throw new ServiceError('NOT_FOUND', `Import ${importId} not found`);
  return rec;
}

const rowsWithErrors = (issues: ImportRowIssue[]) =>
  new Set(issues.filter((i) => i.severity === 'error').map((i) => i.row)).size;

/** A row the ledger refuses; `rooms` is the row's value (null for an empty cell). */
function ledgerIssue(row: number, message: string, rooms: number | null): ImportRowIssue {
  const value = rooms === null ? '' : String(rooms);
  return { row, field: 'rooms', code: 'INCONSISTENT', message, severity: 'error', value };
}

/** Parse the uploaded file and check inventory rows against what is already held or sold. */
async function analyse(deps: FileDeps, rec: ImportRecord): Promise<Analysis> {
  const file = await deps.files.get(rec.file_key);
  if (!file)
    throw new ServiceError('INVALID_STATE', 'No file has been uploaded for this import yet');
  const sha = createHash('sha256').update(file).digest('hex');
  if (file.length > MAX_IMPORT_BYTES) {
    // Presigned uploads cannot cap size, so refuse oversized files before parsing them.
    return {
      accepted: [],
      report: {
        import_id: rec.import_id,
        kind: rec.kind,
        content_sha256: sha,
        status: 'REJECTED',
        rows_total: 0,
        rows_accepted: 0,
        rows_rejected: 0,
        issues: [
          {
            row: 1,
            field: '*',
            code: 'OUT_OF_RANGE',
            message: `The file is ${file.length} bytes; the limit is ${MAX_IMPORT_BYTES}`,
            severity: 'error',
          },
        ],
      },
    };
  }
  const parsed = parseImport(rec.kind, rec.format, file.toString('utf8'));
  const issues = [...parsed.issues];
  let accepted = parsed.rows.map((value, i) => ({ row: parsed.row_numbers[i] as number, value }));

  if (rec.kind === 'inventory' && accepted.length > 0) {
    const byType = new Map<string, string[]>();
    for (const a of accepted) {
      const dates = byType.get(a.value.room_type) ?? [];
      dates.push(a.value.date);
      byType.set(a.value.room_type, dates);
    }
    const sold = new Map<string, number>();
    for (const [type, dates] of byType) {
      const sorted = [...dates].sort();
      for (const n of await getInventory(
        deps.data,
        type,
        sorted[0] as string,
        sorted.at(-1) as string,
      )) {
        sold.set(`${type}#${n.date}`, n.held_units + n.confirmed_units);
      }
    }
    accepted = accepted.filter((a) => {
      const rooms = (a.value as InventoryImportRow).rooms;
      const s = sold.get(`${a.value.room_type}#${a.value.date}`) ?? 0;
      if (rooms === null && s > 0) {
        issues.push(
          ledgerIssue(
            a.row,
            `${counted(s, 'room')} ${plural(s, 'is', 'are')} held or confirmed; availability cannot become unknown`,
            rooms,
          ),
        );
        return false;
      }
      if (rooms !== null && rooms < s) {
        issues.push(
          ledgerIssue(
            a.row,
            `${counted(rooms, 'room')} is below the ${s} already held or confirmed`,
            rooms,
          ),
        );
        return false;
      }
      return true;
    });
  }

  issues.sort((a, b) => a.row - b.row);
  const unchanged = !parsed.rejected && (await wasCommitted(deps.data, rec.kind, sha));
  return {
    accepted,
    report: {
      import_id: rec.import_id,
      kind: rec.kind,
      content_sha256: sha,
      status: parsed.rejected ? 'REJECTED' : unchanged ? 'UNCHANGED' : 'VALIDATED',
      rows_total: parsed.rows_total,
      rows_accepted: parsed.rejected ? 0 : accepted.length,
      rows_rejected: parsed.rejected ? parsed.rows_total : rowsWithErrors(issues),
      issues,
    },
  };
}

export async function validateImport(deps: FileDeps, kind: ImportKind, importId: string) {
  const rec = await load(deps, kind, importId);
  const { report } = await analyse(deps, rec);
  await saveImportReport(deps.data, importId, report);
  return report;
}

export async function commitImport(
  deps: FileDeps,
  kind: ImportKind,
  importId: string,
): Promise<ImportReport> {
  const rec = await load(deps, kind, importId);
  if (rec.report?.status === 'COMMITTED') return rec.report; // committing twice is a no-op
  const { report, accepted } = await analyse(deps, rec);
  if (report.status !== 'VALIDATED') {
    await saveImportReport(deps.data, importId, report);
    return report;
  }

  const issues = [...report.issues];
  let written = 0;
  if (kind === 'rates') {
    await putRatePlan(
      deps.data,
      accepted.map(({ value }) => value as RateImportRow),
    );
    written = accepted.length;
  } else {
    for (const { row, value } of accepted) {
      const r = value as InventoryImportRow;
      const outcome = await setInventoryTotal(deps.data, r.room_type, r.date, r.rooms);
      if (outcome === 'below_sold' || outcome === 'unknown_with_holds') {
        // A hold landed between validation and commit.
        issues.push(
          ledgerIssue(row, 'Rooms were held or sold meanwhile; this row was not applied', r.rooms),
        );
      } else {
        written++;
      }
    }
  }
  await markCommitted(
    deps.data,
    kind,
    report.content_sha256,
    importId,
    new Date(deps.clock.now()).toISOString(),
  );

  const final: ImportReport = {
    ...report,
    status: 'COMMITTED',
    rows_accepted: written,
    rows_rejected: rowsWithErrors(issues),
    issues: issues.sort((a, b) => a.row - b.row),
  };
  await saveImportReport(deps.data, importId, final);
  return final;
}
