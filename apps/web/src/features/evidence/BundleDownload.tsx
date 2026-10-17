import { useState } from 'react';
import type { ExportLink } from '@c32/core';
import { useApi } from '../../app/ApiProvider';
import { Alert, Button, Card } from '../../components';
import { ApiError } from '../../lib/api';
import { formatIst } from '../../lib/format';

/** Evidence bundle download. The link is short-lived, so a fresh one is requested on demand. */
export function BundleDownload() {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<ExportLink | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function request() {
    setBusy(true);
    setError(null);
    try {
      setLink(await api.exportEvidence());
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

  return (
    <Card title="Evidence bundle">
      <p className="text-sm">
        One archive with the baseline, negotiated scope, test results, saved quote results and the
        ledger, with checksums.
      </p>
      {error && (
        <div className="mt-3">
          <Alert tone="danger" title="That did not work">
            {error}
          </Alert>
        </div>
      )}
      <Button className="mt-3" variant="secondary" loading={busy} onClick={() => void request()}>
        Get the bundle download link
      </Button>
      {link && (
        <p className="mt-3 text-sm">
          <a href={link.download_url} download className="font-semibold text-brand underline">
            Download the evidence bundle ({link.format})
          </a>
          <span className="block text-ink-muted">
            Link works until{' '}
            <time dateTime={link.expires_at} title={`UTC: ${link.expires_at}`}>
              {formatIst(link.expires_at)}
            </time>
            .
          </span>
        </p>
      )}
    </Card>
  );
}
