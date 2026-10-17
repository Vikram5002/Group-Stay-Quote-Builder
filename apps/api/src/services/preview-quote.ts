import { evaluate, type QuotePreviewResponse, type ResolvedQuoteRequest } from '@c32/core';
import type { ServiceDeps } from './create-quote.js';
import { loadPolicy, loadStay, refusePastCheckIn } from './inputs.js';
import { termsHash } from './terms-hash.js';

/** POST /v1/quotes/preview: the same evaluation as create, with no hold and nothing saved. */
export async function previewQuote(
  deps: ServiceDeps,
  request: ResolvedQuoteRequest,
): Promise<QuotePreviewResponse> {
  const [policy, stay] = await Promise.all([loadPolicy(deps.data), loadStay(deps.data, request)]);
  const nowMs = deps.clock.now();
  refusePastCheckIn(request, policy, nowMs);
  const { evaluation, validity } = evaluate(request, { ...stay, policy, nowMs });
  return {
    evaluation,
    valid_until: evaluation.decision === 'DECLINE' ? null : validity.valid_until,
    terms_hash: termsHash(request, evaluation),
  };
}
