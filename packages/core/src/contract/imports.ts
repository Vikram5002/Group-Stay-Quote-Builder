import { z } from 'zod';
import { ValidationIssueCode } from './codes.js';
import { Instant, IsoDate, RoomType, Ulid, UnitInr, Units } from './primitives.js';

/**
 * Inventory CSV/JSON row. Column names follow the fixture (date, room_type, rooms).
 * An empty CSV cell imports as null (unknown), never zero (blueprint 8.3).
 */
export const InventoryImportRow = z.strictObject({
  date: IsoDate,
  room_type: RoomType,
  rooms: Units.nullable(),
});
export type InventoryImportRow = z.infer<typeof InventoryImportRow>;

export const RateImportRow = z.strictObject({
  date: IsoDate,
  room_type: RoomType,
  rate_per_room_night_inr: UnitInr.nullable(),
  variable_cost_per_room_night_inr: UnitInr.nullable(),
  rack_rate_inr: UnitInr.nullable(),
});
export type RateImportRow = z.infer<typeof RateImportRow>;

export const IMPORT_KINDS = ['inventory', 'rates'] as const;
export const ImportKind = z.enum(IMPORT_KINDS);
export type ImportKind = z.infer<typeof ImportKind>;

export const ImportUploadRequest = z.strictObject({
  format: z.enum(['csv', 'json']),
  file_name: z.string().min(1).max(200),
});
export type ImportUploadRequest = z.infer<typeof ImportUploadRequest>;

export const ImportUploadResponse = z.strictObject({
  import_id: Ulid,
  upload_url: z.url(),
  expires_at: Instant,
});
export type ImportUploadResponse = z.infer<typeof ImportUploadResponse>;

export const ImportRowIssue = z.strictObject({
  /** 1-based data row number (the CSV header is row 0). */
  row: z.int().min(1),
  field: z.string(),
  code: ValidationIssueCode,
  message: z.string(),
  severity: z.enum(['error', 'warning']),
  /**
   * The value as written in the file (CSV cell text, or JSON), when the issue is about one cell.
   * An empty CSV cell is "". Absent for header, shape and missing-field issues.
   */
  value: z.string().optional(),
});
export type ImportRowIssue = z.infer<typeof ImportRowIssue>;

export const ImportReport = z.strictObject({
  import_id: Ulid,
  kind: ImportKind,
  /** Content hash; re-importing identical content changes nothing (idempotent). */
  content_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  status: z.enum(['VALIDATED', 'COMMITTED', 'UNCHANGED', 'REJECTED']),
  rows_total: Units,
  rows_accepted: Units,
  rows_rejected: Units,
  issues: z.array(ImportRowIssue),
});
export type ImportReport = z.infer<typeof ImportReport>;

export const ExportLink = z.strictObject({
  download_url: z.url(),
  format: z.enum(['csv', 'json', 'zip']),
  expires_at: Instant,
});
export type ExportLink = z.infer<typeof ExportLink>;
