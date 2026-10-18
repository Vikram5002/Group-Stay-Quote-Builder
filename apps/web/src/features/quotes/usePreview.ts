import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { flatNights, price, resolveStay } from '@c32/core';
import type { Evaluation, QuoteRequest, QuoteTotals } from '@c32/core';
import { useApi } from '../../app/ApiProvider';

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/**
 * Server preview for a valid request. The server is authoritative; this is stateless, so it
 * takes no hold and saves nothing. Requests are debounced while the person types.
 */
export function usePreview(request: QuoteRequest | null, debounceMs = 350) {
  const api = useApi();
  const key = request ? JSON.stringify(request) : null;
  const settledKey = useDebounced(key, debounceMs);
  const query = useQuery({
    queryKey: ['quote-preview', settledKey],
    queryFn: () => api.previewQuote(JSON.parse(settledKey as string) as QuoteRequest),
    enabled: settledKey !== null,
    placeholderData: (previous) => previous,
  });
  // The request that produced the result on screen (placeholder data belongs to an older one).
  const shown = useRef<QuoteRequest | null>(null);
  if (query.data && !query.isPlaceholderData && settledKey) {
    shown.current = JSON.parse(settledKey) as QuoteRequest;
  }
  return {
    preview: query.data,
    /** The request the shown preview answers. */
    basis: shown.current,
    /** True only when the shown result is the server's answer to exactly the current form. */
    current: key !== null && key === settledKey && query.isSuccess && !query.isPlaceholderData,
    /** The server refused or failed the current form (not an older one). */
    error: key !== null && key === settledKey ? query.error : null,
    /** True while the shown result is older than the current form, or a request is running. */
    stale: key !== settledKey || query.isFetching || query.isPlaceholderData,
    refetch: query.refetch,
  };
}

/**
 * What the live meter may show. Numbers are labelled as the server's only when they answer the
 * current form exactly; otherwise they are an estimate, a previous answer being re-checked, or
 * nothing at all.
 */
export type LiveMeterState =
  /** Nothing valid has been entered yet. */
  | { kind: 'start' }
  /** The form has an invalid or missing value, so no request is sent. */
  | { kind: 'invalid' }
  /** The server could not price the current form. */
  | { kind: 'error' }
  /** Waiting for the server; an older answer, if any, is shown dimmed and never as confirmed. */
  | { kind: 'checking'; totals?: QuoteTotals; evaluation?: Evaluation }
  /** Computed in the browser from the new rate until the server answers. */
  | { kind: 'estimate'; totals: QuoteTotals; evaluation: Evaluation }
  /** The server's answer to exactly the current form. */
  | { kind: 'server'; totals: QuoteTotals; evaluation: Evaluation };

/**
 * Instant contribution while the server call is still in flight. It reuses the shared pricing
 * function with the cost per room-night the server last reported, so the meter moves as soon
 * as the rate changes. Inclusions are not estimated; with them the meter waits for the server.
 */
export function estimateTotals(
  request: QuoteRequest,
  basis: QuoteRequest,
  evaluation: Evaluation,
): QuoteTotals | null {
  // Everything but the price (a rate or a discount) is unchanged.
  const withoutPrice = ({
    rate_per_room_night_inr: _rate,
    discount_pct: _discount,
    ...rest
  }: QuoteRequest) => JSON.stringify(rest);
  if (withoutPrice(request) !== withoutPrice(basis) || (request.inclusions?.length ?? 0) > 0) {
    return null;
  }
  const last = evaluation.totals;
  const full = last.floor_rate_per_room_night_inr;
  const rate =
    request.rate_per_room_night_inr ??
    (request.discount_pct === undefined
      ? undefined
      : Math.ceil((full * (100 - request.discount_pct)) / 100));
  if (rate === undefined || last.room_nights === 0 || last.variable_cost_inr === null) return null;
  const costPerRoomNight = last.variable_cost_inr / last.room_nights;
  if (!Number.isInteger(costPerRoomNight)) return null;

  const stay = resolveStay(request.stay);
  const { totals } = price({
    rooms: evaluation.offered_rooms,
    nights: flatNights(stay.check_in, stay.nights, rate, costPerRoomNight),
    // The server's full price and Reception limit, as a one-room policy so the estimate matches.
    floor: {
      contribution_floor_inr: full,
      total_rooms_units: 1,
      max_sales_discount_pct: last.max_discount_pct,
    },
  });
  return totals;
}

export function liveMeterState(
  request: QuoteRequest | null,
  preview: {
    basis: QuoteRequest | null;
    evaluation: Evaluation | undefined;
    current: boolean;
    error: unknown;
  },
): LiveMeterState {
  const { basis, evaluation, current, error } = preview;
  if (!request) return basis ? { kind: 'invalid' } : { kind: 'start' };
  if (error) return { kind: 'error' };
  if (!evaluation || !basis) return { kind: 'checking' };
  if (current) return { kind: 'server', totals: evaluation.totals, evaluation };
  const estimate = estimateTotals(request, basis, evaluation);
  return estimate
    ? { kind: 'estimate', totals: estimate, evaluation }
    : { kind: 'checking', totals: evaluation.totals, evaluation };
}
