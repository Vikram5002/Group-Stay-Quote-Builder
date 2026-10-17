import { InventoryImportRow, parseWith, RateImportRow } from '@c32/core';
import type { ImportKind, ImportReport, ImportRowIssue } from '@c32/core';
import { parseImportText } from '../lib/imports';
import type { ImportRecord } from '../lib/imports';
import { mockHash } from './store';
import type { MockStore, StoredUpload } from './store';

const keyOf = (row: ImportRecord) => `${String(row.date)}|${String(row.room_type)}`;

interface Checked {
  report: ImportReport;
  rows: ImportRecord[];
}

/**
 * Dry run: read the file, check every row with the contract's row schema, and report problems by
 * row number (the first data row is row 1). Nothing is written. Empty cells are unknown (null)
 * and only produce a warning, never a zero.
 */
export function checkImport(importId: string, upload: StoredUpload): Checked {
  const { kind, format, text } = upload;
  const base = { import_id: importId, kind, content_sha256: mockHash(text ?? '') };
  const parsed = parseImportText(kind, format, text ?? '');

  if (!parsed.ok) {
    const issue: ImportRowIssue = {
      row: 1,
      field: 'file',
      code: parsed.code,
      message: parsed.message,
      severity: 'error',
    };
    return {
      rows: [],
      report: {
        ...base,
        status: 'REJECTED',
        rows_total: 0,
        rows_accepted: 0,
        rows_rejected: 0,
        issues: [issue],
      },
    };
  }

  const schema = kind === 'inventory' ? InventoryImportRow : RateImportRow;
  const issues: ImportRowIssue[] = [];
  const accepted: ImportRecord[] = [];
  const firstSeen = new Map<string, number>();

  parsed.rows.forEach((record, index) => {
    const row = index + 1;
    const result = parseWith(schema, record);
    if (!result.ok) {
      for (const issue of result.issues) {
        issues.push({
          row,
          field: issue.path || 'row',
          code: issue.code,
          message: issue.message,
          severity: 'error',
        });
      }
      return;
    }
    const key = keyOf(record);
    const earlier = firstSeen.get(key);
    if (earlier !== undefined) {
      issues.push({
        row,
        field: 'date',
        code: 'INCONSISTENT',
        message: `Duplicate of row ${earlier}: the same date and room type appear twice`,
        severity: 'error',
      });
      return;
    }
    firstSeen.set(key, row);

    if (kind === 'inventory' && record.rooms === null) {
      issues.push({
        row,
        field: 'rooms',
        code: 'REQUIRED',
        message: 'Empty: availability is unknown, so no rooms can be held on this night',
        severity: 'warning',
      });
    }
    if (kind === 'rates') {
      for (const field of ['rate_per_room_night_inr', 'variable_cost_per_room_night_inr']) {
        if (record[field] === null) {
          issues.push({
            row,
            field,
            code: 'REQUIRED',
            message: 'Empty: treated as unknown, so quotes that need it go to review',
            severity: 'warning',
          });
        }
      }
    }
    accepted.push(record);
  });

  const rejected = new Set(issues.filter((i) => i.severity === 'error').map((i) => i.row)).size;
  const hash = mockHash(JSON.stringify(accepted));
  return {
    rows: accepted,
    report: {
      ...base,
      content_sha256: hash,
      // Like the real service: rows with errors are skipped, only an unreadable file is rejected.
      status: 'VALIDATED',
      rows_total: parsed.rows.length,
      rows_accepted: accepted.length,
      rows_rejected: rejected,
      issues,
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
