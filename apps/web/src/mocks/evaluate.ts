import { evaluate as coreEvaluate, validateQuoteRequest } from '@c32/core';
import type {
  EvaluationResult,
  InventoryNight,
  Policy,
  QuoteRequest,
  RatePlanNight,
} from '@c32/core';

export interface EvaluateInput {
  request: QuoteRequest;
  policy: Policy;
  inventory: readonly InventoryNight[];
  ratePlan: readonly RatePlanNight[];
  nowMs: number;
}

/**
 * The mock API runs the real rules engine from @c32/core, so the screens are exercised against
 * the same decisions, reasons, counter-offers and validity window the real service will return.
 * Only storage, holds and the terms hash are mocked.
 */
export function evaluate({
  request,
  policy,
  inventory,
  ratePlan,
  nowMs,
}: EvaluateInput): EvaluationResult {
  // Resolve exactly like the server (stay plus any extra lines, D-058).
  const resolved = validateQuoteRequest(request);
  if (!resolved.ok) throw new Error(resolved.problem.detail ?? 'Invalid quote request');
  return coreEvaluate(resolved.value, { inventory, ratePlan, policy, nowMs });
}
