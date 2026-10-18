import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ExtendRequest, LIMITS, parseWith, startOfDayUtc } from '@c32/core';
import type { Policy, Quote, Role } from '@c32/core';
import { useApi } from '../../app/ApiProvider';
import { Alert, Button, Dialog, ProblemAlert, TextAreaField, TextField } from '../../components';
import { ApiError } from '../../lib/api';
import { usePolicy } from '../policy/queries';
import { friendlyIssue } from './form';
import { OPEN_STATUSES } from './labels';
import { useQuoteAction } from './queries';
import { counted } from '../../lib/plural';

const WRITE_ROLES: readonly Role[] = ['Sales', 'Owner'];
const HOUR_MS = 3_600_000;

/**
 * The most hours the server accepts for this quote (apps/api extendQuote): one validity window
 * per call, and never past the stay cutoff. Null when the policy cannot be read by this role.
 */
export function maxExtensionHours(quote: Quote, policy: Policy | undefined): number | null {
  if (!policy || quote.valid_until === null) return null;
  const cutoffMs =
    startOfDayUtc(quote.request.stay.check_in, policy.timezone) -
    policy.stay_cutoff_hours * HOUR_MS;
  const toCutoff = Math.floor((cutoffMs - Date.parse(quote.valid_until)) / HOUR_MS);
  return Math.min(policy.validity_hours, toCutoff);
}

/** A link to start again when the hold is gone; the refusal itself says why. */
function requoteLink(error: unknown) {
  return error instanceof ApiError && error.friendly.action === 're-quote' ? (
    <Link to="/quotes/new" className="font-semibold text-brand underline">
      Start a new quote
    </Link>
  ) : undefined;
}

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
  const emailQuote = useQuoteAction<{ to?: string }>(id, (input, o) =>
    api.emailQuote(id, input, o),
  );
  const payment = useQuoteAction<{ reference?: string }>(id, (input, o) =>
    api.recordPayment(id, input, o),
  );
  const emailInvoice = useQuoteAction<{ to?: string }>(id, (input, o) =>
    api.emailInvoice(id, input, o),
  );
  const [emailTo, setEmailTo] = useState(quote.request.organiser.email ?? '');
  const [paymentRef, setPaymentRef] = useState('');
  const canEmailQuote = quote.status === 'OFFERED' || quote.status === 'CONFIRMED';

  const [dialog, setDialog] = useState<
    'extend' | 'cancel' | 'email-quote' | 'email-invoice' | 'payment' | null
  >(null);
  const sendEmail = dialog === 'email-invoice' ? emailInvoice : emailQuote;
  const [hours, setHours] = useState('24');
  const [hoursError, setHoursError] = useState<string | undefined>();
  const [reason, setReason] = useState('');

  const policy = usePolicy();
  const maxHours = maxExtensionHours(quote, policy.data);
  const cannotExtend = maxHours !== null && maxHours < 1;
  const hoursLimit = maxHours ?? LIMITS.MAX_POLICY_HOURS;

  function close() {
    setDialog(null);
    setHoursError(undefined);
    extend.reset();
    cancel.reset();
    emailQuote.reset();
    emailInvoice.reset();
    payment.reset();
  }

  function submitExtend() {
    const parsed = parseWith(ExtendRequest, {
      hours: hours.trim() === '' ? undefined : Number(hours),
    });
    const tooMany = parsed.ok && parsed.value.hours > hoursLimit;
    if (!parsed.ok || tooMany) {
      const issue = parsed.ok ? undefined : parsed.issues[0];
      setHoursError(
        tooMany || issue?.code === 'OUT_OF_RANGE'
          ? `Must be between 1 and ${hoursLimit}`
          : issue
            ? friendlyIssue(issue)
            : 'Check this value',
      );
      return;
    }
    setHoursError(undefined);
    extend.mutate(parsed.value, { onSuccess: close });
  }

  return (
    <div className="flex flex-col gap-4">
      <ProblemAlert
        error={confirm.error}
        title="Could not confirm the quote"
        action={requoteLink(confirm.error)}
      />

      {!canWrite && (
        <p className="text-sm text-ink-muted">Your role can view this quote but not change it.</p>
      )}
      {canWrite && quote.status === 'PENDING_REVIEW' && (
        <Alert tone="warning" title="Waiting for Owner approval">
          This quote is below the contribution floor or has an unknown value. An Owner who did not
          create it must approve it before it can be confirmed.
          {role === 'Owner' && (
            <span className="mt-2 block">
              <Link to={`/review?quote=${id}`} className="font-semibold text-brand underline">
                Review this quote
              </Link>
            </span>
          )}
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

      {canWrite && (canEmailQuote || quote.payment) && (
        <section aria-labelledby="documents" className="flex flex-col gap-3">
          <h2 id="documents" className="text-lg font-semibold">
            Quote and invoice
          </h2>
          <div className="flex flex-wrap gap-3">
            {canEmailQuote && (
              <Button variant="secondary" onClick={() => setDialog('email-quote')}>
                Email quote
              </Button>
            )}
            {quote.status === 'CONFIRMED' && !quote.payment && (
              <Button variant="secondary" onClick={() => setDialog('payment')}>
                Record payment
              </Button>
            )}
            {quote.payment && (
              <Button onClick={() => setDialog('email-invoice')}>Email invoice</Button>
            )}
          </div>
          {quote.payment ? (
            <p className="text-sm">
              Payment recorded {quote.payment.received_at.slice(0, 10)}
              {quote.payment.reference ? ` (${quote.payment.reference})` : ''}.
            </p>
          ) : quote.status === 'CONFIRMED' ? (
            <p className="text-sm text-ink-muted">
              The invoice can be emailed once the payment is recorded.
            </p>
          ) : null}
          {(quote.emails?.length ?? 0) > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {quote.emails?.map((e) => (
                <li key={`${e.kind}-${e.sent_at}`}>
                  {e.kind === 'quote' ? 'Quote' : 'Invoice'} emailed to {e.to} on{' '}
                  {e.sent_at.slice(0, 10)}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <Dialog
        open={dialog === 'extend'}
        title="Extend validity"
        onClose={close}
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Keep as is
            </Button>
            <Button loading={extend.isPending} disabled={cannotExtend} onClick={submitExtend}>
              Extend
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <ProblemAlert
            error={extend.error}
            title="Could not extend the validity"
            action={requoteLink(extend.error)}
          />
          {cannotExtend ? (
            <Alert tone="info" title="This quote cannot be extended">
              Its hold already runs to the stay cutoff,{' '}
              {counted(policy.data?.stay_cutoff_hours ?? 0, 'hour')} before check-in.
            </Alert>
          ) : (
            <TextField
              label="Extra hours"
              type="number"
              inputMode="numeric"
              min={1}
              max={hoursLimit}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              hint={
                maxHours === null
                  ? 'Rooms stay held for this long after the current expiry. The server checks the policy limit and availability.'
                  : `Rooms stay held for this long after the current expiry, up to ${counted(maxHours, 'hour')} under the policy. The server re-checks availability.`
              }
              {...(hoursError ? { error: hoursError } : {})}
            />
          )}
        </div>
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
        {cancel.error && (
          <div className="mb-3">
            <ProblemAlert error={cancel.error} title="Could not cancel the quote" />
          </div>
        )}
        <p className="mb-3 text-sm">
          The held or confirmed rooms are released. This cannot be undone.
        </p>
        <TextAreaField
          label="Reason (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Dialog>

      <Dialog
        open={dialog === 'email-quote' || dialog === 'email-invoice'}
        title={dialog === 'email-invoice' ? 'Email the invoice' : 'Email the quote'}
        onClose={close}
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Not now
            </Button>
            <Button
              loading={sendEmail.isPending}
              disabled={emailTo.trim() === ''}
              onClick={() => sendEmail.mutate({ to: emailTo.trim() }, { onSuccess: close })}
            >
              Send PDF
            </Button>
          </>
        }
      >
        {sendEmail.error && (
          <div className="mb-3">
            <ProblemAlert error={sendEmail.error} title="The email was not sent" />
          </div>
        )}
        <p className="mb-3 text-sm">
          The {dialog === 'email-invoice' ? 'invoice' : 'quote'} is sent as a PDF with the hotel's
          details.
        </p>
        <TextField
          label="Send to"
          type="email"
          value={emailTo}
          onChange={(e) => setEmailTo(e.target.value)}
          hint="The organiser's email from the quote. You can change it for this one send."
        />
      </Dialog>

      <Dialog
        open={dialog === 'payment'}
        title="Record the payment"
        onClose={close}
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Not now
            </Button>
            <Button
              loading={payment.isPending}
              onClick={() =>
                payment.mutate(paymentRef.trim() ? { reference: paymentRef.trim() } : {}, {
                  onSuccess: close,
                })
              }
            >
              Record payment
            </Button>
          </>
        }
      >
        {payment.error && (
          <div className="mb-3">
            <ProblemAlert error={payment.error} title="Could not record the payment" />
          </div>
        )}
        <p className="mb-3 text-sm">Confirm that the organiser has paid for this booking.</p>
        <TextField
          label="Payment reference (optional)"
          value={paymentRef}
          onChange={(e) => setPaymentRef(e.target.value)}
          hint="For example a bank or UPI transaction id."
        />
      </Dialog>
    </div>
  );
}
