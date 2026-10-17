import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ExtendRequest, LIMITS, parseWith } from '@c32/core';
import type { Quote, Role } from '@c32/core';
import { useApi } from '../../app/ApiProvider';
import { Alert, Button, Dialog, TextAreaField, TextField } from '../../components';
import { ApiError } from '../../lib/api';
import { friendlyIssue } from './form';
import { OPEN_STATUSES } from './labels';
import { useQuoteAction } from './queries';

const WRITE_ROLES: readonly Role[] = ['Sales', 'Owner'];

function downloadJson(quote: Quote) {
  const blob = new Blob([JSON.stringify(quote, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `quote-${quote.quote_id}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

/** Actions allowed for this role and status. The server still decides; this only hides the obvious. */
export function QuoteActions({ quote, role }: { quote: Quote; role: Role }) {
  const api = useApi();
  const id = quote.quote_id;
  const canWrite = WRITE_ROLES.includes(role);
  const isOpen = OPEN_STATUSES.includes(quote.status);

  const confirm = useQuoteAction<undefined>(id, (_input, o) => api.confirmQuote(id, o));
  const extend = useQuoteAction<{ hours: number }>(id, (input, o) => api.extendQuote(id, input, o));
  const cancel = useQuoteAction<{ reason?: string }>(id, (input, o) =>
    api.cancelQuote(id, input, o),
  );

  const [dialog, setDialog] = useState<'extend' | 'cancel' | null>(null);
  const [hours, setHours] = useState('24');
  const [hoursError, setHoursError] = useState<string | undefined>();
  const [reason, setReason] = useState('');

  const failed = [confirm, extend, cancel].find((m) => m.error instanceof ApiError);
  const error = failed?.error instanceof ApiError ? failed.error : null;

  function close() {
    setDialog(null);
    extend.reset();
    cancel.reset();
  }

  function submitExtend() {
    const parsed = parseWith(ExtendRequest, {
      hours: hours.trim() === '' ? undefined : Number(hours),
    });
    if (!parsed.ok) {
      setHoursError(
        parsed.issues[0]
          ? parsed.issues[0].code === 'OUT_OF_RANGE'
            ? `Must be between 1 and ${LIMITS.MAX_POLICY_HOURS}`
            : friendlyIssue(parsed.issues[0])
          : 'Check this value',
      );
      return;
    }
    setHoursError(undefined);
    extend.mutate(parsed.value, { onSuccess: close });
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert
          tone="danger"
          title={error.friendly.title}
          action={
            error.friendly.action === 're-quote' ? (
              <Link to="/quotes/new" className="font-semibold text-brand underline">
                Start a new quote
              </Link>
            ) : undefined
          }
        >
          {error.friendly.message} {error.friendly.nextStep}
          {error.requestId && <span className="block text-xs">Request id: {error.requestId}</span>}
        </Alert>
      )}

      {!canWrite && (
        <p className="text-sm text-ink-muted">Your role can view this quote but not change it.</p>
      )}
      {canWrite && quote.status === 'PENDING_REVIEW' && (
        <Alert tone="warning" title="Waiting for Owner approval">
          This quote is below the contribution floor or has an unknown value. An Owner who did not
          create it must approve it before it can be confirmed.
        </Alert>
      )}

      <div className="flex flex-wrap gap-3">
        {canWrite && quote.status === 'OFFERED' && (
          <Button loading={confirm.isPending} onClick={() => confirm.mutate(undefined)}>
            Confirm quote
          </Button>
        )}
        {canWrite && isOpen && (
          <Button variant="secondary" onClick={() => setDialog('extend')}>
            Extend validity
          </Button>
        )}
        {canWrite && (isOpen || quote.status === 'CONFIRMED') && (
          <Button variant="danger" onClick={() => setDialog('cancel')}>
            Cancel quote
          </Button>
        )}
        <Button variant="secondary" onClick={() => downloadJson(quote)}>
          Download JSON
        </Button>
      </div>

      <Dialog
        open={dialog === 'extend'}
        title="Extend validity"
        onClose={close}
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Keep as is
            </Button>
            <Button loading={extend.isPending} onClick={submitExtend}>
              Extend
            </Button>
          </>
        }
      >
        <TextField
          label="Extra hours"
          type="number"
          inputMode="numeric"
          min={1}
          max={LIMITS.MAX_POLICY_HOURS}
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          hint="Rooms stay held for this long after the current expiry. The server re-checks availability."
          {...(hoursError ? { error: hoursError } : {})}
        />
      </Dialog>

      <Dialog
        open={dialog === 'cancel'}
        title="Cancel this quote?"
        onClose={close}
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Keep the quote
            </Button>
            <Button
              variant="danger"
              loading={cancel.isPending}
              onClick={() =>
                cancel.mutate(reason.trim() ? { reason: reason.trim() } : {}, { onSuccess: close })
              }
            >
              Cancel quote
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm">
          The held or confirmed rooms are released. This cannot be undone.
        </p>
        <TextAreaField
          label="Reason (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Dialog>
    </div>
  );
}
