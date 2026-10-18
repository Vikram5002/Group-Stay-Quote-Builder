import { useState } from 'react';
import type { ImportReport, ImportRowIssue } from '@c32/core';
import { Alert, Badge, Button, CheckboxField, DataTable } from '../../components';
import { counted, plural } from '../../lib/plural';

const HEADLINE: Record<
  ImportReport['status'],
  { tone: 'success' | 'info' | 'danger'; title: string }
> = {
  VALIDATED: { tone: 'success', title: 'The file passed the check' },
  REJECTED: { tone: 'danger', title: 'The file cannot be read, so nothing can be imported' },
  COMMITTED: { tone: 'success', title: 'Imported' },
  UNCHANGED: { tone: 'info', title: 'Nothing changed: this file matches what is already loaded' },
};

function sortIssues(issues: readonly ImportRowIssue[]): ImportRowIssue[] {
  return [...issues].sort(
    (a, b) =>
      a.row - b.row ||
      Number(b.severity === 'error') - Number(a.severity === 'error') ||
      a.field.localeCompare(b.field),
  );
}

/** The value as written in the file. An empty cell says so; a whole-file problem has none. */
function IssueValue({ value }: { value: string | undefined }) {
  if (value === undefined) {
    return (
      <>
        <span aria-hidden="true">—</span>
        <span className="sr-only">No single value</span>
      </>
    );
  }
  if (value === '') return <span className="text-ink-muted">(empty)</span>;
  return <code className="font-mono text-sm break-all">{value}</code>;
}

/** Dry-run or commit result with every problem listed by row number. */
export function ReportView({
  report,
  busy,
  onCommit,
}: {
  report: ImportReport;
  busy: boolean;
  onCommit: () => void;
}) {
  const partial = report.status === 'VALIDATED' && report.rows_rejected > 0;
  const head = partial
    ? { tone: 'info' as const, title: 'Some rows have errors and will be skipped' }
    : HEADLINE[report.status];
  const errors = report.issues.filter((i) => i.severity === 'error').length;
  const warnings = report.issues.length - errors;
  const [errorsOnly, setErrorsOnly] = useState(false);
  const shown =
    errorsOnly && errors > 0 ? report.issues.filter((i) => i.severity === 'error') : report.issues;

  return (
    <section aria-label="Check result" className="flex flex-col gap-4">
      <Alert tone={head.tone} title={head.title}>
        {counted(report.rows_total, 'row')} read: {report.rows_accepted} accepted,{' '}
        {report.rows_rejected} rejected. {counted(errors, 'error')}, {counted(warnings, 'warning')}.
        <details className="mt-1 text-xs">
          <summary className="cursor-pointer">Technical details</summary>
          File fingerprint (SHA-256): {report.content_sha256.slice(0, 12)}. The same file always has
          the same fingerprint.
        </details>
      </Alert>

      {errors > 0 && warnings > 0 && (
        <CheckboxField
          label={`Show errors only (${counted(errors, 'error')})`}
          checked={errorsOnly}
          onChange={(e) => setErrorsOnly(e.target.checked)}
        />
      )}
      <DataTable
        caption="Problems found, by row"
        rows={sortIssues(shown)}
        rowKey={(i) => `${i.row}-${i.field}-${i.code}-${i.severity}`}
        empty={<p className="text-sm text-ink-muted">No problems found.</p>}
        columns={[
          { header: 'Row', numeric: true, render: (i) => i.row },
          { header: 'Field', render: (i) => i.field },
          { header: 'Value', render: (i) => <IssueValue value={i.value} /> },
          { header: 'Problem', render: (i) => i.message },
          {
            header: 'Level',
            render: (i) =>
              i.severity === 'error' ? (
                <Badge tone="danger">Error</Badge>
              ) : (
                <Badge tone="warning">Warning</Badge>
              ),
          },
        ]}
      />

      {report.status === 'VALIDATED' && (
        <div>
          <Button loading={busy} disabled={report.rows_accepted === 0} onClick={onCommit}>
            Import {counted(report.rows_accepted, 'row')}
          </Button>
          {partial && (
            <p className="mt-2 text-sm">
              {counted(report.rows_rejected, 'row')} {plural(report.rows_rejected, 'has', 'have')}{' '}
              errors and will not be imported. Fix {plural(report.rows_rejected, 'it', 'them')} in
              the file and import again to add {plural(report.rows_rejected, 'it', 'them')}.
            </p>
          )}
          {warnings > 0 && (
            <p className="mt-2 text-sm text-ink-muted">
              Warnings do not block the import. Empty values are stored as unknown.
            </p>
          )}
        </div>
      )}
      {report.status === 'REJECTED' && (
        <p className="text-sm">
          Fix the problem listed above, then choose the file and check it again.
        </p>
      )}
    </section>
  );
}
