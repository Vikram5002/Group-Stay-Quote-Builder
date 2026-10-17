import { evaluate as coreEvaluate, resolveStay } from '@c32/core';
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
  const resolved = { ...request, stay: resolveStay(request.stay) };
  return coreEvaluate(resolved, { inventory, ratePlan, policy, nowMs });
}
