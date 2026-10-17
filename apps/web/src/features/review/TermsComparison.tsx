import type { CounterOffer, Quote } from '@c32/core';
import { Card, Money, Unknown } from '../../components';

const OFFER_LABEL: Record<CounterOffer['type'], string> = {
  RAISE_RATE: 'Raise the rate',
  REPRICE_INCLUSION: 'Reprice an inclusion',
  CHANGE_VOLUME: 'Change the volume',
  PARTIAL_ROOMS: 'Fewer rooms',
  ALT_DATES: 'Other dates',
};

/**
 * The requested terms next to each floor-safe alternative, so the Owner can see what a small
 * change would do before deciding. Alternatives are information only; approving applies to the
 * terms as requested.
 */
export function TermsComparison({ quote }: { quote: Quote }) {
  const { evaluation, request } = quote;
  const offers = evaluation.counter_offers;
  const requestedRate = request.rate_per_room_night_inr;

  return (
    <Card title="Terms side by side">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">
            Requested terms compared with floor-safe alternatives
          </caption>
          <thead className="bg-surface-muted">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">
                <span className="sr-only">Term</span>
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                As requested
              </th>
              {offers.map((offer) => (
                <th
                  key={`${offer.type}-${offer.summary}`}
                  scope="col"
                  className="px-3 py-2 font-semibold"
                >
                  {OFFER_LABEL[offer.type]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border">
              <th scope="row" className="px-3 py-2 font-medium text-ink-muted">
                Rooms
              </th>
              <td className="px-3 py-2">{evaluation.offered_rooms}</td>
              {offers.map((offer) => (
                <td key={`${offer.type}-rooms`} className="px-3 py-2">
                  {offer.rooms ?? evaluation.offered_rooms}
                </td>
              ))}
            </tr>
            <tr className="border-t border-border">
              <th scope="row" className="px-3 py-2 font-medium text-ink-muted">
                Rate per room-night
              </th>
              <td className="px-3 py-2">
                {requestedRate === undefined ? 'Rate plan' : <Money value={requestedRate} />}
              </td>
              {offers.map((offer) => (
                <td key={`${offer.type}-rate`} className="px-3 py-2">
                  {offer.rate_per_room_night_inr === undefined ? (
                    <span className="text-ink-muted">Unchanged</span>
                  ) : (
                    <Money value={offer.rate_per_room_night_inr} />
                  )}
                </td>
              ))}
            </tr>
            <tr className="border-t border-border">
              <th scope="row" className="px-3 py-2 font-medium text-ink-muted">
                Contribution
              </th>
              <td className="px-3 py-2 font-semibold">
                <Money value={evaluation.totals.contribution_inr} />
              </td>
              {offers.map((offer) => (
                <td key={`${offer.type}-contribution`} className="px-3 py-2 font-semibold">
                  <Money value={offer.contribution_inr} />
                </td>
              ))}
            </tr>
            <tr className="border-t border-border">
              <th scope="row" className="px-3 py-2 font-medium text-ink-muted">
                Headroom against the floor
              </th>
              <td className="px-3 py-2">
                {evaluation.totals.floor_headroom_inr === null ? (
                  <Unknown />
                ) : (
                  <Money value={evaluation.totals.floor_headroom_inr} />
                )}
              </td>
              {offers.map((offer) => (
                <td key={`${offer.type}-headroom`} className="px-3 py-2">
                  <Money value={offer.floor_headroom_inr} />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {offers.length === 0 && (
        <p className="mt-3 text-sm text-ink-muted">
          No floor-safe alternative could be worked out, usually because a cost is unknown.
        </p>
      )}
      {offers.map((offer) => (
        <p key={`${offer.type}-${offer.summary}`} className="mt-3 text-sm">
          <strong>{OFFER_LABEL[offer.type]}:</strong> {offer.summary}
        </p>
      ))}
    </Card>
  );
}
