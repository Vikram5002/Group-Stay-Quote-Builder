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
    error: query.error,
    /** True while the shown result is older than the current form, or a request is running. */
    stale: key !== settledKey || query.isFetching || query.isPlaceholderData,
    refetch: query.refetch,
  };
}

export interface LiveTotals {
  totals: QuoteTotals;
  /** "server" is authoritative; "estimate" is computed in the browser until the server answers. */
  source: 'server' | 'estimate';
}

/**
 * Instant contribution while the server call is still in flight. It reuses the shared pricing
 * function with the cost per room-night the server last reported, so the meter moves as soon
 * as the rate changes. Inclusions are not estimated; with them the last server answer stays.
 */
export function liveTotals(
  request: QuoteRequest | null,
  basis: QuoteRequest | null,
  evaluation: Evaluation | undefined,
  stale: boolean,
): LiveTotals | null {
  if (!evaluation) return null;
  // Everything but the price (a rate or a discount) is unchanged.
  const withoutPrice = ({
    rate_per_room_night_inr: _rate,
    discount_pct: _discount,
    ...rest
  }: QuoteRequest) => JSON.stringify(rest);
  const onlyRateChanged =
    request !== null && basis !== null && withoutPrice(request) === withoutPrice(basis);
  if (!stale || !request || !onlyRateChanged || (request.inclusions?.length ?? 0) > 0) {
    return { totals: evaluation.totals, source: 'server' };
  }
  const last = evaluation.totals;
  const full = last.floor_rate_per_room_night_inr;
  const rate =
    request.rate_per_room_night_inr ??
    (request.discount_pct === undefined
      ? undefined
      : Math.ceil((full * (100 - request.discount_pct)) / 100));
  if (rate === undefined || last.room_nights === 0 || last.variable_cost_inr === null) {
    return { totals: last, source: 'server' };
  }
  const costPerRoomNight = last.variable_cost_inr / last.room_nights;
  if (!Number.isInteger(costPerRoomNight)) return { totals: last, source: 'server' };

  const stay = resolveStay(request.stay);
  const { totals } = price({
    rooms: evaluation.offered_rooms,
    nights: flatNights(stay.check_in, stay.nights, rate, costPerRoomNight),
    // The server's full price and Sales limit, as a one-room policy so the estimate matches.
    floor: {
      contribution_floor_inr: full,
      total_rooms_units: 1,
      max_sales_discount_pct: last.max_discount_pct,
    },
  });
  return { totals, source: 'estimate' };
}
