import { Count, DataTable, Money, Unknown } from '../../components';
import type { ImportRecord } from '../../lib/imports';
import { counted } from '../../lib/plural';

const PREVIEW_ROWS = 10;

function Cell({ column, value }: { column: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined) return <Unknown />;
  if (typeof value === 'number') {
    return column.endsWith('_inr') ? <Money value={value} /> : <Count value={value} />;
  }
  return <>{value}</>;
}

/** The file as it will be read. An empty cell shows as Unknown, not as zero or blank. */
export function FilePreview({
  columns,
  rows,
}: {
  columns: readonly string[];
  rows: readonly ImportRecord[];
}) {
  const shown = rows.slice(0, PREVIEW_ROWS).map((record, index) => ({ record, row: index + 1 }));
  return (
    <div>
      <p className="mb-2 text-sm font-semibold">
        {counted(rows.length, 'row')} read from the file
        {rows.length > PREVIEW_ROWS ? ` (showing the first ${PREVIEW_ROWS})` : ''}
      </p>
      <DataTable
        caption="First rows of the file as they will be read"
        rows={shown}
        rowKey={(r) => String(r.row)}
        empty={<p className="text-sm text-ink-muted">The file has no data rows.</p>}
        columns={[
          { header: 'Row', numeric: true, render: (r) => r.row },
          ...columns.map((column) => ({
            header: column,
            render: (r: { record: ImportRecord }) => (
              <Cell column={column} value={r.record[column]} />
            ),
          })),
        ]}
      />
    </div>
  );
}
