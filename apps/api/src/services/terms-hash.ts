import { commercialTerms, type Evaluation, type ResolvedQuoteRequest } from '@c32/core';
import { createHash } from 'node:crypto';

/** SHA-256 of the canonical commercial terms (BR-11); approvals are bound to it. */
export function termsHash(request: ResolvedQuoteRequest, evaluation: Evaluation): string {
  return createHash('sha256').update(commercialTerms(request, evaluation), 'utf8').digest('hex');
}
