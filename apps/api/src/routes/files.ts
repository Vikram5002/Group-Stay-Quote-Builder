import { ImportKind, ImportUploadRequest, Ulid, parseWith } from '@c32/core';
import type { Request } from 'express';
import { z } from 'zod';
import { ValidationFailure } from '../errors.js';
import type { FileStore } from '../files/store.js';
import type { ZipEntry } from '../files/zip.js';
import { ServiceError } from '../services/errors.js';
import { exportEvidence, exportQuotes } from '../services/exports.js';
import { commitImport, createUpload, validateImport } from '../services/imports.js';
import type { Handlers } from './operations.js';

/** Import and export operations; mounted only when a file store is configured. */

export interface FileRouteOptions {
  files: FileStore;
  evidence: () => Promise<ZipEntry[]>;
  appVersion: string;
}

function kindOf(req: Request) {
  const k = ImportKind.safeParse(req.params['kind']);
  if (!k.success)
    throw new ServiceError('NOT_FOUND', `No import kind ${String(req.params['kind'])}`);
  return k.data;
}

function importIdOf(req: Request): string {
  const id = req.params['importId'];
  if (!Ulid.safeParse(id).success)
    throw new ServiceError('NOT_FOUND', `Import ${String(id)} not found`);
  return id as string;
}

const ExportQuery = z.strictObject({ format: z.enum(['csv', 'json']) });

export function fileHandlers(opts: FileRouteOptions): Handlers {
  return {
    createImportUpload: async ({ req, deps, actor }) => {
      const b = parseWith(ImportUploadRequest, req.body);
      if (!b.ok) throw new ValidationFailure(b.issues);
      return {
        status: 200,
        body: await createUpload({ ...deps, files: opts.files }, kindOf(req), b.value, actor),
      };
    },

    validateImport: async ({ req, deps }) => ({
      status: 200,
      body: await validateImport({ ...deps, files: opts.files }, kindOf(req), importIdOf(req)),
    }),

    commitImport: async ({ req, deps }) => ({
      status: 200,
      body: await commitImport({ ...deps, files: opts.files }, kindOf(req), importIdOf(req)),
    }),

    exportQuotes: async ({ req, deps }) => {
      const q = parseWith(ExportQuery, req.query);
      if (!q.ok) throw new ValidationFailure(q.issues);
      return {
        status: 200,
        body: await exportQuotes({ ...deps, files: opts.files }, q.value.format),
      };
    },

    exportEvidence: async ({ deps }) => ({
      status: 200,
      body: await exportEvidence(
        { ...deps, files: opts.files },
        { evidence: opts.evidence, appVersion: opts.appVersion },
      ),
    }),
  };
}
