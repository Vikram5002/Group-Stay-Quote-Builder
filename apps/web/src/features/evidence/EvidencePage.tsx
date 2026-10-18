import { useMemo } from 'react';
import { Alert } from '../../components';
import { BundleDownload } from './BundleDownload';
import { verifyDerivedClaims } from './checks';
import { LedgerTable } from './LedgerTable';
import { PublicChecks } from './PublicChecks';
import { StageComparison } from './StageComparison';

export function EvidencePage() {
  const checks = useMemo(() => verifyDerivedClaims(), []);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-[1.875rem] leading-tight font-semibold md:text-[2.125rem]">Evidence</h1>
      <p className="mt-1 text-ink-muted">
        The starting state, the negotiated change and the final results, with a ledger that says
        what each claim rests on.
      </p>
      <div className="mt-4">
        <Alert tone="info" title="All data is synthetic">
          Nothing here is live revenue, market demand or production readiness. Results from
          role-play are process evidence only.
        </Alert>
      </div>

      <div className="mt-8 flex flex-col gap-10">
        <StageComparison />
        <PublicChecks />
        <LedgerTable checks={checks} />
        <BundleDownload />
      </div>
    </div>
  );
}
