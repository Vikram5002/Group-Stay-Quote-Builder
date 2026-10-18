import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_POLICY, localDate } from '@c32/core';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApi } from '../../app/ApiProvider';
import { LEAVE_ALLOWED, LeaveGuard } from '../../app/LeaveGuard';
import {
  Alert,
  Button,
  Card,
  ProblemAlert,
  SegmentedControl,
  Spinner,
  Stepper,
  TextAreaField,
  useToast,
} from '../../components';
import { ApiError, newIdempotencyKey } from '../../lib/api';
import { usePolicy } from '../policy/queries';
import { AVAILABILITY_KEY, QUOTES_KEY } from './queries';
import { initialForm, issuesByPath, parseForm, stepErrors, STEPS } from './form';
import type { QuoteForm } from './form';
import { CompareOptions } from './CompareOptions';
import { clearDraft, copyOption, isBlank, loadDraft, saveDraft } from './draft';
import type { QuoteDraft } from './draft';
import { WIZARD_STATE } from './QuoteBuilderRoute';
import {
  ArithmeticTrail,
  DecisionSummary,
  LiveMeter,
  TotalsTable,
  ValidUntil,
} from './ResultPanels';
import { GroupStep, PricingStep, RoomsStep } from './steps';
import { liveMeterState, usePreview } from './usePreview';

const LAST = STEPS.length - 1;
const PRICING_STEP = 2;
const OPTION_LABELS = ['Option A', 'Option B'] as const;

/** The step in the URL (?step=2 is the second step), as a zero-based index. */
function stepFromUrl(search: string): number {
  const n = Number(new URLSearchParams(search).get('step'));
  return Number.isInteger(n) && n >= 1 ? Math.min(n, STEPS.length) - 1 : 0;
}

export function QuoteBuilderPage() {
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const location = useLocation();
  // One option, or two being compared before one is chosen and issued.
  const [options, setOptions] = useState<QuoteForm[]>([initialForm]);
  const [active, setActive] = useState(0);
  const form = options[active] ?? initialForm;
  const comparing = options.length > 1;
  // Unfinished input from an earlier visit in this tab, offered before anything else.
  const [offer, setOffer] = useState<QuoteDraft | null>(() => loadDraft());
  const done = useRef(false);
  const [showErrors, setShowErrors] = useState(false);
  // Fields the person has changed or left; their errors show at once, the rest after Next.
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const notify = useToast();

  const patch = (changes: Partial<QuoteForm>) =>
    setOptions((list) => list.map((f, i) => (i === active ? { ...f, ...changes } : f)));

  // Only an Owner can read the policy; otherwise the documented default zone (IST, which every
  // screen displays) is used here, and the server checks the date with the real policy.
  const policy = usePolicy();
  const timeZone = policy.data?.timezone ?? DEFAULT_POLICY.timezone;
  const nowMs = Date.now();
  const today = localDate(nowMs, timeZone);
  // Re-parsed when the form or the property's day changes, not on every tick of the clock.
  const parsed = useMemo(() => parseForm(form, { nowMs, timeZone }), [form, today, timeZone]);
  const request = parsed.ok ? parsed.request : null;

  const { preview, basis, current, stale, error: previewError, refetch } = usePreview(request);

  // The other option, when two are compared, is priced too, so both can be shown side by side.
  const otherIndex = comparing ? 1 - active : -1;
  const otherForm = options[otherIndex] ?? null;
  // Like the main form: re-parsed when the option or the property's day changes.
  const otherParsed = useMemo(
    () => (otherForm ? parseForm(otherForm, { nowMs, timeZone }) : null),
    [otherForm, today, timeZone],
  );
  const otherRequest = otherParsed?.ok ? otherParsed.request : null;
  const other = usePreview(otherRequest);
  const live = liveMeterState(request, {
    basis,
    evaluation: preview?.evaluation,
    current,
    error: previewError,
  });

  // Field problems the server found (for example a check-in that is past in the property's zone).
  const serverIssues =
    previewError instanceof ApiError && previewError.code === 'VALIDATION_FAILED'
      ? (previewError.problem.errors ?? [])
      : [];
  const issues = [...(parsed.ok ? [] : parsed.issues), ...serverIssues];
  const errors = issuesByPath(issues);

  // The step lives in the URL, so browser Back and Forward move between steps. A step is only
  // shown once the steps before it are valid, whatever the URL says.
  const requested = stepFromUrl(location.search);
  const firstInvalid = STEPS.findIndex((_s, i) => i < LAST && stepErrors(i, issues).length > 0);
  const step = firstInvalid === -1 ? requested : Math.min(requested, firstInvalid);
  // The server's answer for exactly this form, so it uses the real policy and clock.
  const tooLate = current && (preview?.evaluation.reasons.includes('TOO_LATE_TO_QUOTE') ?? false);

  // One key per user intent: a double click or a retry of the same request replays the same quote.
  const intent = useRef<{ fingerprint: string; key: string } | null>(null);
  const keyFor = (fingerprint: string) => {
    if (intent.current?.fingerprint !== fingerprint) {
      intent.current = { fingerprint, key: newIdempotencyKey() };
    }
    return intent.current.key;
  };

  // An Owner must approve this quote, so Sales can say why it is offered on these terms.
  const needsOwner = current && preview?.evaluation.decision === 'REVIEW';

  const issue = useMutation({
    // Confirmation is never optimistic: nothing changes on screen until the server answers.
    mutationFn: () => {
      if (!request) throw new Error('The request is not valid yet');
      // The note travels with the final request only, so typing it never re-prices the quote.
      const note = form.noteForOwner.trim();
      const body = note && needsOwner ? { ...request, note_for_owner: note } : request;
      return api.createQuote(body, { idempotencyKey: keyFor(JSON.stringify(body)) });
    },
    onSuccess: (quote) => {
      // The dashboard and the calendar must show the new quote and its held rooms at once.
      void queryClient.invalidateQueries({ queryKey: QUOTES_KEY });
      void queryClient.invalidateQueries({ queryKey: AVAILABILITY_KEY });
      done.current = true;
      clearDraft();
      navigate(`/quotes/${quote.quote_id}`, { state: LEAVE_ALLOWED });
    },
  });

  function goTo(next: number) {
    navigate({ search: `?step=${next + 1}` }, { state: WIZARD_STATE });
  }

  // On arrival, mark the entry as the wizard's own, so Back to it keeps the form. Only once:
  // a navigation lands after the render that asked for it, so later the location may lag.
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current) return;
    arrived.current = true;
    if ((location.state as { wizard?: boolean } | null)?.wizard) return;
    navigate({ search: `?step=${step + 1}` }, { replace: true, state: WIZARD_STATE });
  });

  // Keep the URL on the step actually shown when the form does not allow the one asked for, so
  // the wizard does not jump ahead once the earlier step becomes valid.
  useEffect(() => {
    if (!offer && step < requested) {
      navigate({ search: `?step=${step + 1}` }, { replace: true, state: WIZARD_STATE });
    }
  }, [offer, step, requested, navigate]);

  // A new step starts without old errors or refusals, with focus on the heading.
  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    setShowErrors(false);
    issue.reset();
    headingRef.current?.focus();
  }, [step, issue]);

  // Keep the input as a draft for this tab while it is unfinished.
  useEffect(() => {
    if (offer || done.current) return;
    if (options.every(isBlank)) clearDraft();
    else saveDraft({ form, step, ...(comparing ? { options, active } : {}) });
  }, [form, step, offer, options, active, comparing]);

  /** Offer the group a second version: a copy of this one, opened at its pricing. */
  function startComparing() {
    setOptions([form, copyOption(form)]);
    setActive(1);
    goTo(PRICING_STEP);
  }
  /** Keep one option and continue to issue it; the other is discarded, nothing was held. */
  function choose(index: number) {
    const chosen = options[index];
    if (!chosen) return;
    setOptions([chosen]);
    setActive(0);
    notify(`${OPTION_LABELS[index]} chosen. Check it and issue it.`, 'info');
  }
  function edit(index: number) {
    setActive(index);
    goTo(PRICING_STEP);
  }

  function next() {
    if (stepErrors(step, issues).length > 0) {
      setShowErrors(true);
      return;
    }
    goTo(step + 1);
  }

  const visibleErrors = showErrors
    ? errors
    : Object.fromEntries(Object.entries(errors).filter(([path]) => touched.has(path)));
  const touch = (target: EventTarget) => {
    const { name } = target as HTMLInputElement;
    if (name && !touched.has(name)) setTouched(new Set(touched).add(name));
  };
  const evaluation = preview?.evaluation;
  const canIssue =
    request !== null && !stale && evaluation !== undefined && evaluation.decision !== 'DECLINE';
  const issueError = issue.error instanceof ApiError ? issue.error : null;

  if (offer) {
    const name = offer.form.organiser.trim() || 'an unnamed group';
    const date = offer.form.checkIn ? `, check-in ${offer.form.checkIn}` : '';
    return (
      <div className="mx-auto max-w-6xl">
        <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold focus:outline-none">
          New quote
        </h1>
        <div className="mt-6 max-w-xl">
          <Card title="Resume your draft?">
            <p className="text-sm">
              You have a draft for {name}
              {date}, from step {offer.step + 1} of {STEPS.length}. It was kept when you left the
              builder in this tab.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button
                onClick={() => {
                  setOptions(offer.options ?? [offer.form]);
                  setActive(offer.active ?? 0);
                  setOffer(null);
                  goTo(offer.step);
                }}
              >
                Resume draft
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  clearDraft();
                  setOffer(null);
                }}
              >
                Start over
              </Button>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <LeaveGuard when={!options.every(isBlank)} title="Leave this quote?">
        What you entered is kept as a draft in this tab. Choose New quote to resume it or start
        over.
      </LeaveGuard>
      <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold focus:outline-none">
        New quote
      </h1>
      <p className="mt-1 text-ink-muted">
        Step {step + 1} of {STEPS.length}: {STEPS[step]?.label}
      </p>
      <div className="mt-4">
        <Stepper steps={STEPS} current={step} />
      </div>
      {comparing && (
        <div className="mt-4 flex flex-wrap items-end gap-4 rounded-card border border-border bg-surface p-4">
          <SegmentedControl
            legend="You are editing"
            value={String(active)}
            options={OPTION_LABELS.map((label, i) => ({ value: String(i), label }))}
            onChange={(value) => setActive(Number(value))}
          />
          <p className="text-sm text-ink-muted">
            Change either option, then compare them on the last step.
          </p>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <form
          className="flex flex-col gap-6"
          noValidate
          onChange={(e) => touch(e.target)}
          onBlur={(e) => touch(e.target)}
          onSubmit={(e) => {
            e.preventDefault();
            if (step < LAST) next();
          }}
        >
          {step === 0 && (
            <GroupStep
              form={form}
              patch={patch}
              errors={visibleErrors}
              today={today}
              tooLate={tooLate}
              policy={policy.data}
            />
          )}
          {step === 1 && <RoomsStep form={form} patch={patch} errors={visibleErrors} />}
          {step === 2 && <PricingStep form={form} patch={patch} errors={visibleErrors} />}

          {step === LAST && comparing && (
            <CompareOptions
              options={OPTION_LABELS.map((label, i) => {
                const mine = i === active;
                return {
                  label,
                  request: mine ? request : otherRequest,
                  evaluation: mine ? preview?.evaluation : other.preview?.evaluation,
                  validUntil: mine ? preview?.valid_until : other.preview?.valid_until,
                  current: mine ? current : other.current,
                };
              })}
              onChoose={choose}
              onEdit={edit}
            />
          )}

          {step === LAST && !comparing && (
            <>
              {previewError instanceof ApiError && (
                <Alert
                  tone="danger"
                  title={previewError.friendly.title}
                  action={
                    <Button variant="secondary" onClick={() => void refetch()}>
                      Try again
                    </Button>
                  }
                >
                  {previewError.friendly.message} {previewError.friendly.nextStep}
                </Alert>
              )}
              {!evaluation && !previewError && (
                <p className="flex items-center gap-2 text-sm" role="status">
                  <Spinner /> Checking availability and price…
                </p>
              )}
              {evaluation && (
                <div aria-busy={stale || undefined} className="flex flex-col gap-4">
                  <DecisionSummary
                    evaluation={evaluation}
                    onUseRate={(rate) => {
                      // At or below full price, say it as a discount; above it, as a fixed rate.
                      const full = evaluation.totals.floor_rate_per_room_night_inr;
                      const pct = ((full - rate) * 100) / full;
                      if (rate <= full && Number.isInteger(pct)) {
                        patch({ discount: String(pct), rate: '' });
                      } else {
                        patch({ rate: String(rate) });
                      }
                    }}
                    onUseRooms={(rooms) => patch({ rooms: String(rooms) })}
                  />
                  <TotalsTable totals={evaluation.totals} />
                  <ArithmeticTrail trail={evaluation.trail} />
                  <Card title="Terms">
                    <ValidUntil instant={preview?.valid_until ?? null} />
                  </Card>
                  <Card title="Another option?">
                    <p className="text-sm">
                      Offer the group a second version, for example fewer rooms or a different
                      discount, and compare the two before you issue one. Nothing is held until you
                      issue.
                    </p>
                    <Button variant="secondary" className="mt-3" onClick={startComparing}>
                      Compare with another option
                    </Button>
                  </Card>
                  {needsOwner && (
                    <Card title="Note for the Owner">
                      <TextAreaField
                        label="Why these terms? (optional)"
                        name="note_for_owner"
                        maxLength={500}
                        value={form.noteForOwner}
                        onChange={(e) => patch({ noteForOwner: e.target.value })}
                        hint="The Owner sees this with the quote in the review queue."
                      />
                    </Card>
                  )}
                </div>
              )}
              <ProblemAlert
                error={issueError}
                title="Could not issue the quote"
                action={
                  issueError?.friendly.action === 're-quote' ? (
                    <Button variant="secondary" onClick={() => void refetch()}>
                      Re-quote
                    </Button>
                  ) : undefined
                }
              />
            </>
          )}

          <div className="flex flex-wrap justify-between gap-3">
            <Button variant="secondary" disabled={step === 0} onClick={() => goTo(step - 1)}>
              Back
            </Button>
            {step < LAST ? (
              <Button type="submit">Next</Button>
            ) : comparing ? (
              <p className="self-center text-sm text-ink-muted">
                Choose an option above to issue it.
              </p>
            ) : (
              <Button loading={issue.isPending} disabled={!canIssue} onClick={() => issue.mutate()}>
                {evaluation?.decision === 'REVIEW' ? 'Send for Owner review' : 'Issue quote'}
              </Button>
            )}
          </div>
        </form>

        <aside
          aria-label={comparing ? `Live price check, ${OPTION_LABELS[active]}` : 'Live price check'}
          className="lg:sticky lg:top-4 lg:self-start"
        >
          <LiveMeter state={live} />
        </aside>
      </div>
    </div>
  );
}
