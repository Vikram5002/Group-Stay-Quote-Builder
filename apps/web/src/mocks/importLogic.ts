import { parseImport } from '@c32/core';
import type { ImportKind, ImportReport } from '@c32/core';
import type { ImportRecord } from '../lib/imports';
import { mockHash } from './store';
import type { MockStore, StoredUpload } from './store';

interface Checked {
  report: ImportReport;
  rows: ImportRecord[];
}

/**
 * Dry run with the same parser the API uses (parseImport in @c32/core), so the mock reports the
 * same row problems, messages and values: row numbers from 1, unknown room types rejected, rows
 * with errors skipped, and empty cells imported as unknown (null) with a warning, never zero.
 * Nothing is written. Only the ledger checks against held rooms are left to the real API.
 */
export function checkImport(importId: string, upload: StoredUpload): Checked {
  const { kind, format, text } = upload;
  const parsed = parseImport(kind, format, text ?? '');
  const rows = parsed.rows as ImportRecord[];
  const rejected = new Set(parsed.issues.filter((i) => i.severity === 'error').map((i) => i.row));
  return {
    rows,
    report: {
      import_id: importId,
      kind,
      content_sha256: mockHash(parsed.rejected ? (text ?? '') : JSON.stringify(rows)),
      status: parsed.rejected ? 'REJECTED' : 'VALIDATED',
      rows_total: parsed.rows_total,
      rows_accepted: parsed.rejected ? 0 : rows.length,
      rows_rejected: parsed.rejected ? parsed.rows_total : rejected.size,
      issues: parsed.issues,
    },
  };
}

/** Commit a checked file. Identical content to the last commit changes nothing. */
export function commitImport(store: MockStore, kind: ImportKind, checked: Checked): ImportReport {
  const { report, rows } = checked;
  if (store.loaded[kind] === report.content_sha256) return { ...report, status: 'UNCHANGED' };

  for (const record of rows) {
    const date = String(record.date);
    const roomType = String(record.room_type);
    if (kind === 'inventory') {
      const rooms = record.rooms as number | null;
      const existing = store.inventory.find((r) => r.date === date && r.room_type === roomType);
      const held = existing?.held_units ?? 0;
      const confirmed = existing?.confirmed_units ?? 0;
      const next = {
        date,
        room_type: roomType,
        total_units: rooms,
        available_units: rooms === null ? null : Math.max(0, rooms - held - confirmed),
        held_units: held,
        confirmed_units: confirmed,
      };
      if (existing) Object.assign(existing, next);
      else store.inventory.push(next);
    } else {
      const next = {
        date,
        room_type: roomType,
        rate_per_room_night_inr: record.rate_per_room_night_inr as number | null,
        variable_cost_per_room_night_inr: record.variable_cost_per_room_night_inr as number | null,
        rack_rate_inr: (record.rack_rate_inr ?? null) as number | null,
      };
      const existing = store.ratePlan.find((r) => r.date === date && r.room_type === roomType);
      if (existing) Object.assign(existing, next);
      else store.ratePlan.push(next);
    }
  }
  store.loaded[kind] = report.content_sha256;
  return { ...report, status: 'COMMITTED' };
}
