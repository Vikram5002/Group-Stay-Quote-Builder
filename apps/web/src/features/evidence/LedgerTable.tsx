import { useMemo, useState } from 'react';
import { Badge, Card, DataTable, SelectField } from '../../components';
import type { Tone } from '../../components';
import { CLAIM_TYPES, LEDGER } from './ledger';
import type { ClaimType } from './ledger';
import type { ClaimCheck } from './checks';

const TONE: Record<ClaimType, Tone> = {
  Observed: 'success',
  Derived: 'info',
  Assumption: 'warning',
  'Not yet measured': 'unknown',
  'Observed after experiment': 'neutral',
};

/** Every claim with its type and source. Derived claims can be recomputed on the spot. */
export function LedgerTable({ checks }: { checks: readonly ClaimCheck[] }) {
  const [filter, setFilter] = useState<ClaimType | 'all'>('all');
  const rows = useMemo(() => LEDGER.filter((e) => filter === 'all' || e.type === filter), [filter]);
  const byId = new Map(checks.map((c) => [c.id, c] as const));
  const counts = CLAIM_TYPES.map((t) => [t, LEDGER.filter((e) => e.type === t).length] as const);

  return (
    <section aria-labelledby="ledger" className="flex flex-col gap-4">
      <h2 id="ledger" className="text-lg font-semibold">
        Evidence ledger
      </h2>
      <p className="text-sm text-ink-muted">
        Every claim is tagged so a reviewer can tell what was measured from what is arithmetic and
        what is only assumed.
      </p>
      <ul className="flex flex-wrap gap-2" aria-label="Claims by type">
        {counts.map(([type, count]) => (
          <li key={type}>
            <Badge tone={TONE[type]}>{`${type}: ${count}`}</Badge>
          </li>
        ))}
      </ul>
      <div className="max-w-xs">
        <SelectField
          label="Show"
          value={filter}
          onChange={(e) => setFilter(e.target.value as ClaimType | 'all')}
        >
          <option value="all">All claims</option>
          {CLAIM_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </SelectField>
      </div>
      <DataTable
        caption="Evidence ledger"
        rows={rows}
        rowKey={(e) => e.id}
        columns={[
          { header: 'ID', render: (e) => e.id },
          {
            header: 'Claim',
            render: (e) => {
              const check = byId.get(e.id);
              return (
                <>
                  {e.claim}
                  {check && (
                    <span className="mt-1 block text-xs">
                      {check.matches ? '✓' : '✕'} Recomputed now: {check.recomputed}.{' '}
                      {check.matches ? 'Matches the claim.' : 'Does not match the claim.'}
                    </span>
                  )}
                </>
              );
            },
          },
          { header: 'Type', render: (e) => <Badge tone={TONE[e.type]}>{e.type}</Badge> },
          { header: 'Source', render: (e) => e.source },
          { header: 'Confidence', render: (e) => e.confidence },
          { header: 'Next test', render: (e) => e.nextTest },
        ]}
        empty={<Card>No claims of this type.</Card>}
      />
    </section>
  );
}
