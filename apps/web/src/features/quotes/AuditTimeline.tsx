import type { QuoteEvent } from '@c32/core';
import { Card, EmptyState } from '../../components';
import { formatIst } from '../../lib/format';
import { EVENT_LABEL } from './labels';

/** Immutable event stream, oldest first, with who did what and when (IST, exact UTC on hover). */
export function AuditTimeline({ events }: { events: readonly QuoteEvent[] }) {
  return (
    <Card title="Audit timeline">
      {events.length === 0 ? (
        <EmptyState as="h3" title="No events yet" />
      ) : (
        <ol className="flex flex-col gap-4 border-l-2 border-border pl-4">
          {events.map((event) => (
            <li key={event.event_id}>
              <p className="font-semibold">{EVENT_LABEL[event.type]}</p>
              <p className="text-sm text-ink-muted">
                {event.actor.user_id} ({event.actor.role}) ·{' '}
                <time dateTime={event.at} title={`UTC: ${event.at}`}>
                  {formatIst(event.at)}
                </time>
              </p>
              {event.reason && <p className="mt-1 text-sm">Reason: {event.reason}</p>}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
