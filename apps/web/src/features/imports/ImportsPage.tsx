import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { IMPORT_KINDS } from '@c32/core';
import type { ImportKind, ImportReport } from '@c32/core';
import { useApi } from '../../app/ApiProvider';
import { Alert, Button, Card, ProblemAlert, SelectField, TextField } from '../../components';
import { newIdempotencyKey } from '../../lib/api';
import { cn } from '../../lib/cn';
import {
  fileFormat,
  MAX_IMPORT_BYTES,
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
import { ADMINS, can } from '../../lib/roles';

interface Picked {
  name: string;
  format: 'csv' | 'json';
  text: string;
  parsed: ParsedImport;
}

export function ImportsPage() {
  const api = useApi();
  const { session } = useAuth();
  const isOwner = can(ADMINS, session?.user.role);

  const [kind, setKind] = useState<ImportKind>('inventory');
  const [picked, setPicked] = useState<Picked | null>(null);
  const [fileError, setFileError] = useState<string | undefined>();
  const [busy, setBusy] = useState<string | null>(null);
  const [importId, setImportId] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [failure, setFailure] = useState<{ title: string; error: unknown } | null>(null);
  const commitKey = useRef(newIdempotencyKey());
  // A new key empties the file field, to start again after an import.
  const [inputKey, setInputKey] = useState(0);
  const [dragging, setDragging] = useState(false);

  function resetResult() {
    setReport(null);
    setImportId(null);
    setFailure(null);
  }

  async function onFile(file: File | undefined) {
    resetResult();
    setPicked(null);
    setFileError(undefined);
    if (!file) return;
    const format = fileFormat(file.name);
    if (!format) {
      setFileError('Use a .csv or .json file.');
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      setFileError(
        'That file is over 2 MB. Split it into smaller files and import them one by one.',
      );
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
      setFailure({ title: 'Could not check the file', error });
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
      setFailure({ title: 'Could not import the file', error });
    } finally {
      setBusy(null);
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void onFile(event.dataTransfer.files[0]);
  }

  function startAgain() {
    resetResult();
    setPicked(null);
    setFileError(undefined);
    setInputKey((k) => k + 1);
  }

  const columns = IMPORT_COLUMNS[kind];
  const canCheck = picked?.parsed.ok === true && busy === null;
  // Why the chosen file cannot be checked, shown under the file field itself.
  const fileProblem =
    fileError ?? (picked && !picked.parsed.ok ? picked.parsed.message : undefined);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-[1.875rem] leading-tight font-semibold md:text-[2.125rem]">
        Imports and exports
      </h1>
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
              {/* The field also takes a file dropped anywhere on this area. */}
              <div
                data-testid="drop-zone"
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={cn(
                  'rounded-card border-2 border-dashed p-3',
                  dragging ? 'border-brand bg-brand-soft' : 'border-border',
                )}
              >
                <TextField
                  key={inputKey}
                  label="File (CSV or JSON)"
                  type="file"
                  accept=".csv,.json,text/csv,application/json"
                  onChange={(e) => void onFile(e.target.files?.[0])}
                  hint="Choose a file or drop it here. Leave a cell empty if the value is unknown: it is imported as unknown, never as zero."
                  {...(fileProblem ? { error: fileProblem } : {})}
                />
                {picked && !fileProblem && (
                  <p className="mt-2 text-sm font-semibold">Chosen: {picked.name}</p>
                )}
              </div>
            </div>
            <p className="mt-3 text-sm">
              <a
                className="font-semibold text-ink underline decoration-ink/25 underline-offset-4 hover:decoration-ink"
                download={`${kind}-template.csv`}
                href={`data:text/csv;charset=utf-8,${encodeURIComponent(templateCsv(kind))}`}
              >
                Download a template
              </a>
            </p>

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
                <ProblemAlert error={failure.error} title={failure.title} />
              </div>
            )}
            {report && (
              <div className="mt-4">
                <ReportView report={report} busy={busy !== null} onCommit={() => void commit()} />
              </div>
            )}
            {report && (report.status === 'COMMITTED' || report.status === 'UNCHANGED') && (
              <div className="mt-4 flex flex-wrap items-center gap-4">
                <Link
                  to="/availability"
                  className="font-semibold text-ink underline decoration-ink/25 underline-offset-4 hover:decoration-ink"
                >
                  {kind === 'inventory'
                    ? 'See the rooms on the availability calendar'
                    : 'See the nights on the availability calendar'}
                </Link>
                <Button variant="secondary" onClick={startAgain}>
                  Import another file
                </Button>
              </div>
            )}
          </Card>
        ) : (
          <Alert tone="info" title="Imports are for Service Managers">
            You can download exports below. Ask a Service Manager to import inventory or rates.
          </Alert>
        )}

        <ExportsCard />
      </div>
    </div>
  );
}
