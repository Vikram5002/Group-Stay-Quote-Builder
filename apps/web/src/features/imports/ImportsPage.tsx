import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { IMPORT_KINDS } from '@c32/core';
import type { ImportKind, ImportReport } from '@c32/core';
import { useApi } from '../../app/ApiProvider';
import { Alert, Button, Card, SelectField, TextField } from '../../components';
import { ApiError, newIdempotencyKey } from '../../lib/api';
import {
  fileFormat,
  readFileText,
  IMPORT_COLUMNS,
  IMPORT_KIND_LABEL,
  parseImportText,
  templateCsv,
} from '../../lib/imports';
import type { ParsedImport } from '../../lib/imports';
import { useAuth } from '../auth/auth';
import { FilePreview } from './FilePreview';
import { ReportView } from './ReportView';
import { ExportsCard } from './ExportsCard';

interface Picked {
  name: string;
  format: 'csv' | 'json';
  text: string;
  parsed: ParsedImport;
}

function describeFailure(error: unknown): string {
  if (error instanceof ApiError) return `${error.friendly.message} ${error.friendly.nextStep}`;
  return 'Something went wrong. Try again.';
}

export function ImportsPage() {
  const api = useApi();
  const { session } = useAuth();
  const isOwner = session?.user.role === 'Owner';

  const [kind, setKind] = useState<ImportKind>('inventory');
  const [picked, setPicked] = useState<Picked | null>(null);
  const [fileError, setFileError] = useState<string | undefined>();
  const [busy, setBusy] = useState<string | null>(null);
  const [importId, setImportId] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const commitKey = useRef(newIdempotencyKey());

  function resetResult() {
    setReport(null);
    setImportId(null);
    setFailure(null);
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    resetResult();
    setPicked(null);
    setFileError(undefined);
    if (!file) return;
    const format = fileFormat(file.name);
    if (!format) {
      setFileError('Use a .csv or .json file.');
      return;
    }
    let text: string;
    try {
      text = await readFileText(file);
    } catch {
      setFileError('The file could not be read. Try choosing it again.');
      return;
    }
    setPicked({ name: file.name, format, text, parsed: parseImportText(kind, format, text) });
  }

  function changeKind(next: ImportKind) {
    setKind(next);
    resetResult();
    if (picked) setPicked({ ...picked, parsed: parseImportText(next, picked.format, picked.text) });
  }

  async function checkFile() {
    if (!picked) return;
    resetResult();
    commitKey.current = newIdempotencyKey();
    try {
      setBusy('Requesting an upload link…');
      const upload = await api.createImportUpload(
        kind,
        { format: picked.format, file_name: picked.name },
        { idempotencyKey: newIdempotencyKey() },
      );
      setBusy('Uploading the file…');
      await api.uploadFile(
        upload.upload_url,
        picked.text,
        picked.format === 'csv' ? 'text/csv' : 'application/json',
      );
      setBusy('Checking every row…');
      const checked = await api.validateImport(kind, upload.import_id, {
        idempotencyKey: newIdempotencyKey(),
      });
      setImportId(upload.import_id);
      setReport(checked);
    } catch (error) {
      setFailure(describeFailure(error));
    } finally {
      setBusy(null);
    }
  }

  async function commit() {
    if (!importId) return;
    setFailure(null);
    try {
      setBusy('Importing…');
      // Not optimistic: the report only changes once the server confirms.
      setReport(await api.commitImport(kind, importId, { idempotencyKey: commitKey.current }));
    } catch (error) {
      setFailure(describeFailure(error));
    } finally {
      setBusy(null);
    }
  }

  const columns = IMPORT_COLUMNS[kind];
  const canCheck = picked?.parsed.ok === true && busy === null;

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold">Imports and exports</h1>
      <p className="mt-1 text-ink-muted">
        Load inventory and rates from a file, or download quotes and the evidence bundle.
      </p>

      <div className="mt-6 flex flex-col gap-6">
        {isOwner ? (
          <Card title="Import a file">
            <div className="grid gap-4 md:grid-cols-2">
              <SelectField
                label="What are you importing?"
                value={kind}
                onChange={(e) => changeKind(e.target.value as ImportKind)}
                hint={`Columns: ${columns.join(', ')}.`}
              >
                {IMPORT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {IMPORT_KIND_LABEL[k]}
                  </option>
                ))}
              </SelectField>
              <TextField
                label="File (CSV or JSON)"
                type="file"
                accept=".csv,.json,text/csv,application/json"
                onChange={(e) => void onFile(e)}
                hint="Leave a cell empty if the value is unknown. It is imported as unknown, never as zero."
                {...(fileError ? { error: fileError } : {})}
              />
            </div>
            <p className="mt-3 text-sm">
              <a
                className="font-semibold text-brand underline"
                download={`${kind}-template.csv`}
                href={`data:text/csv;charset=utf-8,${encodeURIComponent(templateCsv(kind))}`}
              >
                Download a template
              </a>
            </p>

            {picked && !picked.parsed.ok && (
              <div className="mt-4">
                <Alert tone="danger" title="This file cannot be read">
                  {picked.parsed.message}
                </Alert>
              </div>
            )}
            {picked?.parsed.ok && (
              <div className="mt-4">
                <FilePreview columns={picked.parsed.columns} rows={picked.parsed.rows} />
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                loading={busy !== null && report === null}
                disabled={!canCheck}
                onClick={() => void checkFile()}
              >
                Check file
              </Button>
              <span role="status" aria-live="polite" className="text-sm text-ink-muted">
                {busy}
              </span>
            </div>
            <p className="mt-2 text-sm text-ink-muted">
              Checking is a dry run. Nothing is imported until you confirm.
            </p>

            {failure && (
              <div className="mt-4">
                <Alert tone="danger" title="That did not work">
                  {failure}
                </Alert>
              </div>
            )}
            {report && (
              <div className="mt-4">
                <ReportView report={report} busy={busy !== null} onCommit={() => void commit()} />
              </div>
            )}
          </Card>
        ) : (
          <Alert tone="info" title="Imports are for Owners">
            You can download exports below. Ask an Owner to import inventory or rates.
          </Alert>
        )}

        <ExportsCard />
      </div>
    </div>
  );
}
