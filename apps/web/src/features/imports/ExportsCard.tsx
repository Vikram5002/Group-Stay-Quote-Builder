import { useState } from 'react';
import type { ExportLink } from '@c32/core';
import { useApi } from '../../app/ApiProvider';
import { Alert, Button, Card, SelectField } from '../../components';
import { ApiError } from '../../lib/api';
import { formatIst } from '../../lib/format';

type Kind = 'quotes' | 'evidence';

/** Download links are short-lived, so a fresh link is requested each time. */
export function ExportsCard() {
  const api = useApi();
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const [busy, setBusy] = useState<Kind | null>(null);
  const [links, setLinks] = useState<Partial<Record<Kind, ExportLink>>>({});
  const [error, setError] = useState<string | null>(null);

  async function request(kind: Kind) {
    setBusy(kind);
    setError(null);
    try {
      const link = kind === 'quotes' ? await api.exportQuotes(format) : await api.exportEvidence();
      setLinks((current) => ({ ...current, [kind]: link }));
    } catch (e) {
      setError(
        e instanceof ApiError
          ? `${e.friendly.message} ${e.friendly.nextStep}`
          : 'Something went wrong. Try again.',
      );
    } finally {
      setBusy(null);
    }
  }

  const linkView = (link: ExportLink | undefined, label: string) =>
    link && (
      <p className="mt-3 text-sm">
        <a href={link.download_url} download className="font-semibold text-brand underline">
          Download {label} ({link.format})
        </a>
        <span className="block text-ink-muted">
          Link works until{' '}
          <time dateTime={link.expires_at} title={`UTC: ${link.expires_at}`}>
            {formatIst(link.expires_at)}
          </time>
          .
        </span>
      </p>
    );

  return (
    <Card title="Export">
      {error && (
        <div className="mb-4">
          <Alert tone="danger" title="That did not work">
            {error}
          </Alert>
        </div>
      )}
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="font-semibold">Quotes</h3>
          <p className="mt-1 text-sm text-ink-muted">
            Every quote with its status and contribution. An unknown contribution is an empty cell.
          </p>
          <div className="mt-3">
            <SelectField
              label="Format"
              value={format}
              onChange={(e) => setFormat(e.target.value as 'csv' | 'json')}
            >
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
            </SelectField>
          </div>
          <Button
            className="mt-3"
            variant="secondary"
            loading={busy === 'quotes'}
            onClick={() => void request('quotes')}
          >
            Get quotes download link
          </Button>
          {linkView(links.quotes, 'quotes')}
        </div>
        <div>
          <h3 className="font-semibold">Evidence bundle</h3>
          <p className="mt-1 text-sm text-ink-muted">
            Baseline, negotiated scope, results and the ledger, as one archive.
          </p>
          <Button
            className="mt-3"
            variant="secondary"
            loading={busy === 'evidence'}
            onClick={() => void request('evidence')}
          >
            Get evidence download link
          </Button>
          {linkView(links.evidence, 'evidence bundle')}
        </div>
      </div>
    </Card>
  );
}
