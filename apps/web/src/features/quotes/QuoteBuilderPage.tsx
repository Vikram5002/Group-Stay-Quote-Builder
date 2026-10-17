import { useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_POLICY, localDate } from '@c32/core';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../../app/ApiProvider';
import { Alert, Button, Card, ProblemAlert, Spinner, Stepper } from '../../components';
import { ApiError, newIdempotencyKey } from '../../lib/api';
import { usePolicy } from '../policy/queries';
import { AVAILABILITY_KEY, QUOTES_KEY } from './queries';
import { initialForm, issuesByPath, parseForm, stepErrors, STEPS } from './form';
import type { QuoteForm } from './form';
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

export function QuoteBuilderPage() {
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<QuoteForm>(initialForm);
  const [step, setStep] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  // Fields the person has changed or left; their errors show at once, the rest after Next.
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const headingRef = useRef<HTMLHeadingElement>(null);

  const patch = (changes: Partial<QuoteForm>) => setForm((f) => ({ ...f, ...changes }));

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

  const issue = useMutation({
    // Confirmation is never optimistic: nothing changes on screen until the server answers.
    mutationFn: () => {
      if (!request) throw new Error('The request is not valid yet');
      return api.createQuote(request, { idempotencyKey: keyFor(JSON.stringify(request)) });
    },
    onSuccess: (quote) => {
      // The dashboard and the calendar must show the new quote and its held rooms at once.
      void queryClient.invalidateQueries({ queryKey: QUOTES_KEY });
      void queryClient.invalidateQueries({ queryKey: AVAILABILITY_KEY });
      navigate(`/quotes/${quote.quote_id}`);
    },
  });

  function goTo(next: number) {
    setStep(next);
    setShowErrors(false);
    issue.reset();
    headingRef.current?.focus();
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

  return (
    <div className="mx-auto max-w-6xl">
      <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold focus:outline-none">
        New quote
      </h1>
      <p className="mt-1 text-ink-muted">
        Step {step + 1} of {STEPS.length}: {STEPS[step]?.label}
      </p>
      <div className="mt-4">
        <Stepper steps={STEPS} current={step} />
      </div>

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

          {step === LAST && (
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
                      patch({ rate: String(rate) });
                    }}
                    onUseRooms={(rooms) => patch({ rooms: String(rooms) })}
                  />
                  <TotalsTable totals={evaluation.totals} />
                  <ArithmeticTrail trail={evaluation.trail} />
                  <Card title="Terms">
                    <ValidUntil instant={preview?.valid_until ?? null} />
                  </Card>
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
            ) : (
              <Button loading={issue.isPending} disabled={!canIssue} onClick={() => issue.mutate()}>
                {evaluation?.decision === 'REVIEW' ? 'Send for Owner review' : 'Issue quote'}
              </Button>
            )}
          </div>
        </form>

        <aside aria-label="Live contribution" className="lg:sticky lg:top-4 lg:self-start">
          <LiveMeter state={live} />
        </aside>
      </div>
    </div>
  );
}
