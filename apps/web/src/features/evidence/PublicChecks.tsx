import { useState } from 'react';
import { useApi } from '../../app/ApiProvider';
import { Alert, Badge, Button, Card, DataTable } from '../../components';
import { ApiError } from '../../lib/api';
import { formatIst } from '../../lib/format';
import { useAuth } from '../auth/auth';
import { runPublicChecks } from './checks';
import type { CheckRun } from './checks';
import { counted } from '../../lib/plural';

const MODE = import.meta.env.VITE_API_MODE ?? (import.meta.env.DEV ? 'mock' : 'api');

function downloadRun(run: CheckRun) {
  const blob = new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'public-checks.json';
  link.click();
  URL.revokeObjectURL(url);
}

/** Runs the three public checks from the case fixture against the connected API. */
export function PublicChecks() {
  const api = useApi();
  const { session } = useAuth();
  const canRun = session?.user.role !== 'Viewer';
  const [run, setRun] = useState<CheckRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      setRun(await runPublicChecks(api));
    } catch (e) {
      setError(
        e instanceof ApiError
          ? `${e.friendly.message} ${e.friendly.nextStep}`
          : 'Something went wrong. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  const passed = run?.results.filter((r) => r.passed).length ?? 0;

  return (
    <Card title="Public checks">
      <p className="text-sm">
        Runs the three public checks from the case fixture against{' '}
        {MODE === 'mock' ? 'the practice API built into this app (mock mode)' : 'the connected API'}
        . They are previews, so no rooms are held and nothing is saved. They use today's
        availability, so rooms already held or confirmed on the fixture dates can make a check fail.
      </p>
      {!canRun && (
        <p className="mt-2 text-sm text-ink-muted">
          Your role cannot create previews. Sign in as Sales or Owner to run the checks.
        </p>
      )}
      {error && (
        <div className="mt-3">
          <Alert tone="danger" title="The checks could not run">
            {error}
          </Alert>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-3">
        <Button loading={busy} disabled={!canRun} onClick={() => void start()}>
          Run the public checks
        </Button>
        {run && (
          <Button variant="secondary" onClick={() => downloadRun(run)}>
            Download the result (JSON)
          </Button>
        )}
      </div>
      {run && (
        <div className="mt-4 flex flex-col gap-3" aria-live="polite">
          <Alert
            tone={passed === run.results.length ? 'success' : 'danger'}
            title={`${passed} of ${counted(run.results.length, 'check')} passed`}
          >
            Run at <time dateTime={run.ranAt}>{formatIst(run.ranAt)}</time>.
          </Alert>
          <DataTable
            caption="Public check results"
            rows={run.results}
            rowKey={(r) => r.id}
            columns={[
              { header: 'Check', render: (r) => r.statement },
              { header: 'Expected', render: (r) => r.expected },
              { header: 'Actual', render: (r) => r.actual },
              {
                header: 'Result',
                render: (r) =>
                  r.passed ? <Badge tone="success">Pass</Badge> : <Badge tone="danger">Fail</Badge>,
              },
            ]}
          />
        </div>
      )}
    </Card>
  );
}
