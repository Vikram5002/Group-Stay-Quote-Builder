import { useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AmendmentRequest,
  ExtendRequest,
  LIMITS,
  parseWith,
  PROPERTY_ROOM_TYPES,
  startOfDayUtc,
} from '@c32/core';
import type { Policy, Quote, Role } from '@c32/core';
import { useApi } from '../../app/ApiProvider';
import {
  Alert,
  Button,
  Dialog,
  ProblemAlert,
  SegmentedControl,
  TextAreaField,
  TextField,
  useToast,
} from '../../components';
import { ApiError } from '../../lib/api';
import { saveFile } from '../../lib/download';
import { formatIst, formatInr, formatStay } from '../../lib/format';
import { counted } from '../../lib/plural';
import { usePolicy } from '../policy/queries';
import { formFromQuote, friendlyIssue } from './form';
import type { QuoteForm } from './form';
import { OPEN_STATUSES } from './labels';
import { clientTotal, describePricing } from './pricingText';
import { quotationFileName, quotationPdf, quotationText } from './quotation';
import type { RequoteState } from './QuoteBuilderPage';
import { useQuoteAction } from './queries';
import { BOOKING, BUILDERS, can } from '../../lib/roles';

const WRITE_ROLES: readonly Role[] = BOOKING;
const HOUR_MS = 3_600_000;
const QUICK_HOURS = [12, 24, 48, 72];

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

/** Move focus to the screen's heading, after an action removed the button that had it. */
function focusHeading() {
  const heading = document.querySelector<HTMLElement>('main h1');
  if (!heading) return;
  heading.setAttribute('tabindex', '-1');
  heading.focus();
}

/** One line for the dialogs: "10 Standard rooms, Sun 01 Nov 2026 to Tue 03 Nov 2026". */
function termsLine(quote: Quote): string {
  const e = quote.evaluation;
  const type =
    PROPERTY_ROOM_TYPES.find((t) => t.code === quote.request.room_type)?.label ??
    quote.request.room_type;
  return `${counted(e.offered_rooms, `${type} room`)}, ${formatStay(e.check_in, e.check_out)}`;
}

/**
 * Re-quote: open the builder with this quote's details (and any changes, such as a suggested
 * rate). A quote that still holds rooms is cancelled first, after a confirm, so the new quote
 * can hold the same rooms; a closed or confirmed quote is only copied.
 */
export function useRequote(quote: Quote) {
  const api = useApi();
  const navigate = useNavigate();
  const cancel = useQuoteAction<{ reason?: string }>(quote.quote_id, (input, o) =>
    api.cancelQuote(quote.quote_id, input, o),
  );
  const [pending, setPending] = useState<{ changes: Partial<QuoteForm>; what: string } | null>(
    null,
  );
  const holds = OPEN_STATUSES.includes(quote.status);

  const open = (form: QuoteForm) => {
    const state: RequoteState = { prefill: form };
    navigate('/quotes/new', { state });
  };
  const start = (changes: Partial<QuoteForm> = {}, what = 'with these details') => {
    if (holds) setPending({ changes, what });
    else open(formFromQuote(quote, changes));
  };
  const close = () => {
    setPending(null);
    cancel.reset();
  };
  const go = () => open(formFromQuote(quote, pending?.changes ?? {}));

  const dialog = (
    <Dialog
      open={pending !== null}
      title="Replace this quote?"
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Keep this quote
          </Button>
          <Button
            loading={cancel.isPending}
            onClick={() =>
              cancel.mutate(
                { reason: 'Replaced by a new quote' },
                {
                  onSuccess: go,
                  // Already expired or closed: its rooms are released, so carry on.
                  onError: (error) => {
                    if (
                      error instanceof ApiError &&
                      (error.code === 'QUOTE_EXPIRED' || error.code === 'INVALID_STATE')
                    ) {
                      go();
                    }
                  },
                },
              )
            }
          >
            Cancel it and re-quote
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <ProblemAlert error={cancel.error} title="Could not cancel this quote" />
        <p>
          This quote holds {termsLine(quote)}. To re-quote {pending?.what}, it is cancelled first
          and its rooms are released, so the new quote can hold them.
        </p>
        <p>The new quote opens with the same details for you to check and issue.</p>
      </div>
    </Dialog>
  );
  return { start, dialog };
}

/** Actions allowed for this role and status. The server still decides; this only hides the obvious. */
export function QuoteActions({
  quote,
  role,
  onRequote,
}: {
  quote: Quote;
  role: Role;
  /** Opens the re-quote flow (see useRequote). */
  onRequote: () => void;
}) {
  const api = useApi();
  const id = quote.quote_id;
  const notify = useToast();
  const canWrite = WRITE_ROLES.includes(role);
  const isOpen = OPEN_STATUSES.includes(quote.status);

  const confirm = useQuoteAction<undefined>(id, (_input, o) => api.confirmQuote(id, o));
  const extend = useQuoteAction<{ hours: number }>(id, (input, o) => api.extendQuote(id, input, o));
  const amend = useQuoteAction<{ rooms: number; reason?: string }>(id, (input, o) =>
    api.amendQuote(id, input, o),
  );
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

  const policy = usePolicy();
  const maxHours = maxExtensionHours(quote, policy.data);
  const cannotExtend = maxHours !== null && maxHours < 1;
  const hoursLimit = maxHours ?? LIMITS.MAX_POLICY_HOURS;

  const [dialog, setDialog] = useState<
    'confirm' | 'extend' | 'amend' | 'cancel' | 'email-quote' | 'email-invoice' | 'payment' | null
  >(null);
  const sendEmail = dialog === 'email-invoice' ? emailInvoice : emailQuote;
  // Never start above what the policy allows, so the first try does not fail.
  const [hours, setHours] = useState(() => String(Math.max(1, Math.min(24, hoursLimit))));
  const [hoursError, setHoursError] = useState<string | undefined>();
  const [rooms, setRooms] = useState('');
  const [roomsError, setRoomsError] = useState<string | undefined>();
  const [reason, setReason] = useState('');

  function close() {
    setDialog(null);
    setHoursError(undefined);
    setRoomsError(undefined);
    confirm.reset();
    extend.reset();
    amend.reset();
    cancel.reset();
    emailQuote.reset();
    emailInvoice.reset();
    payment.reset();
  }
  const done = (message: string) => {
    close();
    notify(message);
    focusHeading();
  };

  const hoursValue = Number(hours);
  const newExpiry =
    quote.valid_until && Number.isInteger(hoursValue) && hoursValue >= 1
      ? new Date(Date.parse(quote.valid_until) + hoursValue * HOUR_MS).toISOString()
      : null;

  function submitExtend() {
    const parsed = parseWith(ExtendRequest, {
      hours: hours.trim() === '' ? undefined : hoursValue,
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
    extend.mutate(parsed.value, {
      onSuccess: (saved) => done(`Rooms are now held until ${formatIst(saved.valid_until)}.`),
    });
  }

  const current = quote.evaluation.offered_rooms;
  function submitAmend() {
    const value = rooms.trim() === '' ? undefined : Number(rooms);
    const parsed = parseWith(AmendmentRequest, {
      rooms: value,
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    });
    if (!parsed.ok || parsed.value.rooms >= current) {
      setRoomsError(`Enter a number of rooms from 1 to ${current - 1}`);
      return;
    }
    setRoomsError(undefined);
    amend.mutate(parsed.value, {
      onSuccess: (saved) =>
        done(
          saved.review_required
            ? `Booking reduced to ${counted(saved.evaluation.offered_rooms, 'room')}. It is now below the floor, so a Service Manager is asked to review it.`
            : `Booking reduced to ${counted(saved.evaluation.offered_rooms, 'room')}.`,
        ),
    });
  }

  const pricing = describePricing(quote.request, quote.evaluation.totals);
  const total = clientTotal(quote.evaluation.totals);
  const closedForRequote = !isOpen && quote.status !== 'CONFIRMED';
  const requoteLabel = closedForRequote
    ? 'Re-quote with these details'
    : quote.status === 'CONFIRMED'
      ? 'New quote from this one'
      : 'Change and re-quote';

  const dialogFooter = (
    onGo: () => void,
    label: string,
    busy: boolean,
    danger = false,
    disabled = false,
  ): ReactNode => (
    <>
      <Button variant="secondary" onClick={close}>
        {dialog === 'cancel' ? 'Keep the quote' : 'Not now'}
      </Button>
      <Button
        variant={danger ? 'danger' : 'primary'}
        loading={busy}
        disabled={disabled}
        onClick={onGo}
      >
        {label}
      </Button>
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      {!canWrite && (
        <p className="text-sm text-ink-muted">Your role can view this quote but not change it.</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {canWrite && quote.status === 'OFFERED' && (
          <Button onClick={() => setDialog('confirm')}>Confirm booking…</Button>
        )}
        {canWrite && isOpen && (
          <Button variant="secondary" onClick={() => setDialog('extend')}>
            Extend validity…
          </Button>
        )}
        {canWrite && quote.status === 'CONFIRMED' && current > 1 && (
          <Button
            variant="secondary"
            onClick={() => {
              setRooms(String(current - 1));
              setDialog('amend');
            }}
          >
            Reduce rooms…
          </Button>
        )}
        <Button
          variant="secondary"
          onClick={() => saveFile(quotationPdf(quote), quotationFileName(quote), 'application/pdf')}
        >
          Download quotation (PDF)
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(quotationText(quote))
              .then(() => notify('Quotation summary copied. Paste it into an email or a message.'))
              .catch(() =>
                notify('Copying is blocked in this browser. Use the PDF instead.', 'warning'),
              );
          }}
        >
          Copy summary
        </Button>
        {/* An expired quote offers this in its own warning, at the top of the page. */}
        {can(BUILDERS, role) && quote.status !== 'EXPIRED' && (
          <Button variant="ghost" onClick={onRequote}>
            {requoteLabel}
          </Button>
        )}
        {canWrite && (isOpen || quote.status === 'CONFIRMED') && (
          <Button variant="danger" className="sm:ml-auto" onClick={() => setDialog('cancel')}>
            Cancel {quote.status === 'CONFIRMED' ? 'booking' : 'quote'}…
          </Button>
        )}
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
        open={dialog === 'confirm'}
        title="Confirm this booking?"
        onClose={close}
        footer={dialogFooter(
          () =>
            confirm.mutate(undefined, {
              onSuccess: () => done('Booking confirmed. The held rooms are now booked.'),
            }),
          'Confirm booking',
          confirm.isPending,
        )}
      >
        <div className="flex flex-col gap-3 text-sm">
          <ProblemAlert
            error={confirm.error}
            title="Could not confirm the booking"
            action={requoteAction(confirm.error, () => {
              close();
              onRequote();
            })}
          />
          <p>
            <strong>{quote.request.organiser.name}</strong>: {termsLine(quote)}, at {pricing.text}.
          </p>
          <p>
            Total for the client: <strong>{formatInr(total)}</strong>.
          </p>
          <p>Confirm only once the client has accepted. The held rooms become booked.</p>
        </div>
      </Dialog>

      <Dialog
        open={dialog === 'extend'}
        title="Extend validity"
        onClose={close}
        footer={dialogFooter(submitExtend, 'Extend', extend.isPending, false, cannotExtend)}
      >
        <div className="flex flex-col gap-3">
          <ProblemAlert
            error={extend.error}
            title="Could not extend the validity"
            action={requoteAction(extend.error, () => {
              close();
              onRequote();
            })}
          />
          {cannotExtend ? (
            <Alert tone="info" title="This quote cannot be extended">
              Its hold already runs to the stay cutoff,{' '}
              {counted(policy.data?.stay_cutoff_hours ?? 0, 'hour')} before check-in.
            </Alert>
          ) : (
            <>
              {/* One radio group, so the choices are a single stop for the keyboard. */}
              {QUICK_HOURS.some((h) => h <= hoursLimit) && (
                <SegmentedControl
                  legend="Quick choice"
                  value={hours}
                  options={QUICK_HOURS.filter((h) => h <= hoursLimit).map((h) => ({
                    value: String(h),
                    label: counted(h, 'hour'),
                  }))}
                  onChange={setHours}
                />
              )}
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
                    : `Up to ${counted(maxHours, 'hour')} under the policy. The server re-checks availability.`
                }
                {...(hoursError ? { error: hoursError } : {})}
              />
              <p className="text-sm" role="status">
                Now held until <strong>{formatIst(quote.valid_until)}</strong>
                {newExpiry && (
                  <>
                    ; after this, until <strong>{formatIst(newExpiry)}</strong>
                  </>
                )}
                .
              </p>
            </>
          )}
        </div>
      </Dialog>

      <Dialog
        open={dialog === 'amend'}
        title="Reduce the rooms in this booking"
        onClose={close}
        footer={dialogFooter(submitAmend, 'Reduce rooms', amend.isPending)}
      >
        <div className="flex flex-col gap-3">
          <ProblemAlert error={amend.error} title="Could not reduce the rooms" />
          <p className="text-sm">
            The booking has {counted(current, 'room')}. The rooms you remove are released at once.
            If the smaller booking falls below the floor, a Service Manager is asked to review it.
          </p>
          <TextField
            label="Rooms to keep"
            type="number"
            inputMode="numeric"
            min={1}
            max={current - 1}
            required
            value={rooms}
            onChange={(e) => setRooms(e.target.value)}
            {...(roomsError ? { error: roomsError } : {})}
          />
          <TextAreaField
            label="Reason (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      </Dialog>

      <Dialog
        open={dialog === 'cancel'}
        title={quote.status === 'CONFIRMED' ? 'Cancel this booking?' : 'Cancel this quote?'}
        onClose={close}
        footer={dialogFooter(
          () =>
            cancel.mutate(reason.trim() ? { reason: reason.trim() } : {}, {
              onSuccess: () => done('Cancelled. The rooms were released.'),
            }),
          quote.status === 'CONFIRMED' ? 'Cancel booking' : 'Cancel quote',
          cancel.isPending,
          true,
        )}
      >
        {cancel.error && (
          <div className="mb-3">
            <ProblemAlert error={cancel.error} title="Could not cancel" />
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
              onClick={() =>
                sendEmail.mutate(
                  { to: emailTo.trim() },
                  {
                    onSuccess: () =>
                      done(
                        `The ${dialog === 'email-invoice' ? 'invoice' : 'quote'} PDF is on its way to ${emailTo.trim()}.`,
                      ),
                  },
                )
              }
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
                  onSuccess: () => done('Payment recorded. The invoice can now be emailed.'),
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

/** For an error that means the hold is gone: a way to start again with the same details. */
export function requoteAction(error: unknown, onRequote: () => void): ReactNode {
  return error instanceof ApiError && error.friendly.action === 're-quote' ? (
    <Button variant="secondary" onClick={onRequote}>
      Re-quote with these details
    </Button>
  ) : undefined;
}
