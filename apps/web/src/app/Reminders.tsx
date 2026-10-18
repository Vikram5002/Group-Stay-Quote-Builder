import type { Quote, Role } from '@c32/core';
import { Link } from 'react-router-dom';
import { Icon } from '../components';
import type { IconName } from '../components';
import { useNow, useQuoteList } from '../features/quotes/queries';
import { counted, plural } from '../lib/plural';

const DAY_MS = 86_400_000;

interface Reminder {
  to: string;
  icon: IconName;
  text: string;
}

/** What needs the Owner or the Service Manager now, from the quote list. */
export function remindersFor(
  quotes: readonly Quote[],
  role: Role,
  userId: string,
  nowMs: number,
): Reminder[] {
  const list: Reminder[] = [];
  const pending = quotes.filter((q) => q.status === 'PENDING_REVIEW');
  if (role === 'Owner') {
    const n = pending.filter((q) => q.awaiting_owner).length;
    if (n > 0)
      list.push({
        to: '/review',
        icon: 'review',
        text: `${counted(n, 'quote')} waiting for your discount`,
      });
  }
  if (role === 'ServiceManager') {
    // Four-eyes: quotes they created are not theirs to approve.
    const n = pending.filter((q) => !q.awaiting_owner && q.created_by.user_id !== userId).length;
    if (n > 0)
      list.push({
        to: '/review',
        icon: 'review',
        text: `${counted(n, 'quote')} waiting for your review`,
      });
  }
  const ending = quotes.filter((q) => {
    if ((q.status !== 'OFFERED' && q.status !== 'PENDING_REVIEW') || !q.valid_until) return false;
    const left = Date.parse(q.valid_until) - nowMs;
    return left > 0 && left <= DAY_MS;
  }).length;
  if (ending > 0) {
    list.push({
      to: '/quotes?status=OFFERED',
      icon: 'clock',
      text: `${counted(ending, 'hold')} ${plural(ending, 'ends', 'end')} within 24 hours`,
    });
  }
  const unpaid = quotes.filter((q) => q.status === 'CONFIRMED' && !q.payment).length;
  if (unpaid > 0) {
    list.push({
      to: '/quotes?status=CONFIRMED',
      icon: 'wallet',
      text: `${counted(unpaid, 'booking')} waiting for payment`,
    });
  }
  return list;
}

/** Reminders in the side menu, above the account card (Owner and Service Manager only). */
export function Reminders({ role, userId }: { role: Role; userId: string }) {
  const enabled = role === 'Owner' || role === 'ServiceManager';
  const quotes = useQuoteList(enabled);
  const now = useNow();
  if (!enabled || !quotes.data) return null;
  const items = remindersFor(quotes.data.items, role, userId, now.getTime());
  return (
    <section
      aria-labelledby="reminders"
      className="mx-3 mt-auto rounded-2xl border border-border bg-surface p-3 text-sm"
    >
      <h2
        id="reminders"
        className="flex items-center gap-2 px-1 text-xs font-semibold tracking-[0.12em] text-on-nav-muted uppercase"
      >
        <Icon name="alert" className="size-4" />
        Reminders
      </h2>
      {items.length === 0 ? (
        <p className="mt-2 px-1 text-ink-muted">Nothing needs you right now.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {items.map((r) => (
            <li key={r.text}>
              <Link
                to={r.to}
                className="flex items-start gap-2 rounded-xl px-2 py-1.5 font-medium text-ink hover:bg-surface-muted"
              >
                <Icon name={r.icon} className="mt-0.5 size-4 shrink-0" />
                {r.text}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
