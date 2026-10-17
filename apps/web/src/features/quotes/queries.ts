import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Quote } from '@c32/core';
import { useApi } from '../../app/ApiProvider';
import { newIdempotencyKey } from '../../lib/api';

export const quoteKey = (id: string) => ['quote', id] as const;
export const auditKey = (id: string) => ['quote-audit', id] as const;
export const QUOTES_KEY = ['quotes'] as const;
export const AVAILABILITY_KEY = ['availability'] as const;

export function useQuote(id: string) {
  const api = useApi();
  return useQuery({ queryKey: quoteKey(id), queryFn: () => api.getQuote(id) });
}

export function useQuoteAudit(id: string) {
  const api = useApi();
  return useQuery({ queryKey: auditKey(id), queryFn: () => api.getQuoteAudit(id) });
}

/** One page of recent quotes, enough for the dashboard (the API caps a page at 100). */
export function useQuoteList() {
  const api = useApi();
  return useQuery({ queryKey: QUOTES_KEY, queryFn: () => api.listQuotes({ limit: '100' }) });
}

/** Current time, refreshed on an interval so countdowns tick without a reload. */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/**
 * A quote action (confirm, extend, cancel). Not optimistic: the screen changes only with the
 * server's answer. One idempotency key is kept per distinct request, so a double click or a retry
 * is safe, and a new key starts after a success.
 */
export function useQuoteAction<Input>(
  quoteId: string,
  run: (input: Input, options: { idempotencyKey: string }) => Promise<Quote>,
) {
  const queryClient = useQueryClient();
  const intent = useRef<{ fingerprint: string; key: string } | null>(null);

  return useMutation({
    mutationFn: (input: Input) => {
      const fingerprint = JSON.stringify(input ?? null);
      if (intent.current?.fingerprint !== fingerprint) {
        intent.current = { fingerprint, key: newIdempotencyKey() };
      }
      return run(input, { idempotencyKey: intent.current.key });
    },
    onSuccess: (quote) => {
      intent.current = null;
      queryClient.setQueryData(quoteKey(quoteId), quote);
      void queryClient.invalidateQueries({ queryKey: auditKey(quoteId) });
      void queryClient.invalidateQueries({ queryKey: QUOTES_KEY });
      void queryClient.invalidateQueries({ queryKey: AVAILABILITY_KEY });
    },
    onError: () => {
      // The quote may have changed under us (expired, cancelled by someone else). Re-read it.
      void queryClient.invalidateQueries({ queryKey: quoteKey(quoteId) });
    },
  });
}
