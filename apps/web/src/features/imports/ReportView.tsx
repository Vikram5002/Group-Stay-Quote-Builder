import type { ImportReport, ImportRowIssue } from '@c32/core';
import { Alert, Badge, Button, DataTable } from '../../components';

const HEADLINE: Record<
  ImportReport['status'],
  { tone: 'success' | 'info' | 'danger'; title: string }
> = {
  VALIDATED: { tone: 'success', title: 'The file passed the check' },
  REJECTED: { tone: 'danger', title: 'The file has problems, so nothing can be imported' },
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
  const head = HEADLINE[report.status];
  const errors = report.issues.filter((i) => i.severity === 'error').length;
  const warnings = report.issues.length - errors;

  return (
    <section aria-label="Check result" className="flex flex-col gap-4">
      <Alert tone={head.tone} title={head.title}>
        {report.rows_total} row{report.rows_total === 1 ? '' : 's'} read: {report.rows_accepted}{' '}
        accepted, {report.rows_rejected} rejected. {errors} error{errors === 1 ? '' : 's'},{' '}
        {warnings} warning
        {warnings === 1 ? '' : 's'}.
        <span className="mt-1 block text-xs">
          File fingerprint: {report.content_sha256.slice(0, 12)}
        </span>
      </Alert>

      <DataTable
        caption="Problems found, by row"
        rows={sortIssues(report.issues)}
        rowKey={(i) => `${i.row}-${i.field}-${i.code}-${i.severity}`}
        empty={<p className="text-sm text-ink-muted">No problems found.</p>}
        columns={[
          { header: 'Row', numeric: true, render: (i) => i.row },
          { header: 'Field', render: (i) => i.field },
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
          <Button loading={busy} onClick={onCommit}>
            Import {report.rows_accepted} row{report.rows_accepted === 1 ? '' : 's'}
          </Button>
          {warnings > 0 && (
            <p className="mt-2 text-sm text-ink-muted">
              Warnings do not block the import. Empty values are stored as unknown.
            </p>
          )}
        </div>
      )}
      {report.status === 'REJECTED' && (
        <p className="text-sm">
          Fix the rows listed above, then choose the file and check it again.
        </p>
      )}
    </section>
  );
}
