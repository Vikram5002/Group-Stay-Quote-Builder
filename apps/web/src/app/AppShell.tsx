import { useEffect, useId, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button, HotelScene } from '../components';
import { useAuth } from '../features/auth/auth';
import { OPEN_STATUSES } from '../features/quotes/labels';
import { QUOTES_KEY, useNow, useQuoteList } from '../features/quotes/queries';
import { cn } from '../lib/cn';
import { useApi } from './ApiProvider';
import { DESIGN_SYSTEM_PATH, NAV_ITEMS } from './routes';
import type { NavItem } from './routes';

const APP_NAME = 'Group Stay Quote Builder';
const DAY_MS = 86_400_000;

const linkClass = (active: boolean) =>
  cn(
    'flex min-h-11 items-center justify-between gap-2 rounded-control px-3 text-sm font-medium',
    active
      ? 'bg-nav-active text-on-nav shadow-[inset_3px_0_0_var(--color-nav-accent)]'
      : 'text-on-nav-muted hover:bg-white/5 hover:text-on-nav',
  );

/** The product mark: a bed under a roof, navy on the gold accent. */
function Logo() {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" className="size-9 shrink-0">
      <rect width="32" height="32" rx="9" className="fill-nav-accent" />
      <path
        d="M7 15 16 8l9 7"
        fill="none"
        stroke="#15263d"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M9 24v-6h14v6M9 21h14M12 18v-1.5a1.5 1.5 0 0 1 1.5-1.5h1a1.5 1.5 0 0 1 1.5 1.5V18"
        fill="none"
        stroke="#15263d"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A count next to a menu entry, read out with its meaning. */
function CountBadge({ count, label }: { count: number; label: string }) {
  if (count <= 0) return null;
  return (
    <span className="rounded-full bg-nav-accent px-2 py-0.5 text-xs font-bold text-nav">
      <span aria-hidden="true">{count > 99 ? '99+' : count}</span>
      <span className="sr-only">
        , {count} {label}
      </span>
    </span>
  );
}

/** Quotes waiting for an Owner, for the Review queue badge. Shares the queue's own query. */
function usePendingReviewCount(enabled: boolean): number {
  const api = useApi();
  const pending = useQuery({
    queryKey: [...QUOTES_KEY, 'review'],
    queryFn: () => api.listQuotes({ status: 'PENDING_REVIEW', limit: '100' }),
    enabled,
  });
  return enabled ? (pending.data?.items.length ?? 0) : 0;
}

/** Open quotes whose hold ends within a day, for the Dashboard badge. */
function useExpiringSoonCount(enabled: boolean): number {
  const quotes = useQuoteList(enabled);
  const now = useNow();
  if (!enabled || !quotes.data) return 0;
  return quotes.data.items.filter((q) => {
    if (!OPEN_STATUSES.includes(q.status) || !q.valid_until) return false;
    const left = Date.parse(q.valid_until) - now.getTime();
    return left > 0 && left <= DAY_MS;
  }).length;
}

export function AppShell() {
  const mainRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const previousPath = useRef(pathname);
  const { session, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();

  const role = session?.user.role;
  const allowed = (item: NavItem) =>
    !item.roles || (role !== undefined && item.roles.includes(role));
  const items = NAV_ITEMS.filter(allowed);
  const action = items.find((i) => i.group === 'action');
  const pendingReviews = usePendingReviewCount(role === 'Owner');
  const expiringSoon = useExpiringSoonCount(Boolean(session));
  const projectOpen = items.some((i) => i.group === 'project' && i.path === pathname);

  // Move focus to the new screen's heading after navigation, so keyboard and screen reader users
  // start there instead of in the menu. Skipped on first load so the skip link stays the first
  // tab stop. A screen without a heading yet focuses the main area.
  useEffect(() => {
    if (previousPath.current !== pathname) {
      previousPath.current = pathname;
      setMenuOpen(false);
      const heading = mainRef.current?.querySelector('h1');
      if (heading) {
        heading.setAttribute('tabindex', '-1');
        heading.classList.add('focus:outline-none');
        heading.focus();
      } else {
        mainRef.current?.focus();
      }
    }
  }, [pathname]);

  // Keep the browser tab title in step with the screen's heading, including pages that load
  // their heading after the data arrives (a quote's organiser, for example).
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const update = () => {
      const heading = main.querySelector('h1')?.textContent?.trim();
      document.title = heading ? `${heading} · ${APP_NAME}` : APP_NAME;
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(main, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  // "Quotes" stays marked on a quote's own page, but not on New quote.
  const isActive = (path: string) =>
    path === '/quotes'
      ? pathname === '/quotes' || (pathname.startsWith('/quotes/') && pathname !== '/quotes/new')
      : path === '/'
        ? pathname === '/'
        : pathname === path || pathname.startsWith(`${path}/`);

  const entry = (item: NavItem) => {
    const active = isActive(item.path);
    const badge =
      item.path === '/review' ? (
        <CountBadge count={pendingReviews} label="waiting for review" />
      ) : item.path === '/' ? (
        <CountBadge count={expiringSoon} label="holds expiring within 24 hours" />
      ) : null;
    return (
      <li key={item.path}>
        <Link
          to={item.path}
          aria-current={active ? 'page' : undefined}
          className={linkClass(active)}
        >
          <span>{item.label}</span>
          {badge}
        </Link>
      </li>
    );
  };
  const group = (name: NavItem['group'], heading?: string) => {
    const list = items.filter((i) => i.group === name);
    if (list.length === 0) return null;
    return (
      <div className="mt-4 first:mt-0">
        {heading && (
          <p className="px-3 pb-1 text-xs font-semibold tracking-[0.12em] text-on-nav-muted uppercase">
            {heading}
          </p>
        )}
        <ul className="flex flex-col gap-1">{list.map(entry)}</ul>
      </div>
    );
  };

  return (
    <div className="min-h-screen md:grid md:grid-cols-[16rem_1fr]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-4 focus:py-2"
      >
        Skip to main content
      </a>
      <header className="sticky top-0 z-30 flex flex-col bg-nav text-on-nav md:h-screen md:overflow-y-auto">
        <div className="flex items-center justify-between gap-3 p-4">
          <Link to="/" className="flex items-center gap-3 rounded-control">
            <Logo />
            <span>
              <span className="block font-display text-base leading-tight font-semibold">
                {APP_NAME}
              </span>
              <span className="mt-1 inline-block rounded-full bg-white/10 px-2 text-xs text-on-nav-muted">
                Demo data
              </span>
            </span>
          </Link>
          <Button
            variant="on-nav"
            className="md:hidden"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? 'Close menu' : 'Menu'}
          </Button>
        </div>
        <div
          id={menuId}
          className={cn('md:flex md:flex-1 md:flex-col', menuOpen ? 'flex flex-col' : 'hidden')}
        >
          <nav aria-label="Primary" className="px-2 pb-4">
            {action && (
              <Link
                to={action.path}
                aria-current={pathname === action.path ? 'page' : undefined}
                className="mb-5 flex min-h-11 items-center justify-center rounded-control bg-nav-accent px-3 text-sm font-semibold text-nav shadow-[0_8px_20px_-10px_rgb(217_164_65_/_0.8)] hover:brightness-105 active:translate-y-px"
              >
                <span aria-hidden="true" className="mr-1.5 text-lg leading-none">
                  +
                </span>
                {action.label}
              </Link>
            )}
            {group('work')}
            {group('admin', 'Admin')}
            <details
              className="mt-4 border-t border-white/10 pt-3"
              {...(projectOpen || pathname === DESIGN_SYSTEM_PATH ? { open: true } : {})}
            >
              <summary className="flex min-h-11 cursor-pointer items-center rounded-control px-3 text-sm font-medium text-on-nav-muted hover:bg-white/5 hover:text-on-nav">
                About this project
              </summary>
              <ul className="mt-1 flex flex-col gap-1">
                {items.filter((i) => i.group === 'project').map(entry)}
                <li>
                  <NavLink to={DESIGN_SYSTEM_PATH} className={({ isActive: a }) => linkClass(a)}>
                    Design system
                  </NavLink>
                </li>
              </ul>
            </details>
          </nav>
          <HotelScene className="mx-4 mt-auto hidden h-28 w-auto opacity-90 md:block" />
          {session && (
            <div className="m-3 rounded-card bg-white/5 p-4 text-sm ring-1 ring-white/10">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="grid size-9 shrink-0 place-items-center rounded-full bg-nav-accent text-sm font-bold text-nav"
                >
                  {(session.displayName.trim()[0] ?? '?').toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{session.displayName}</span>
                  <span className="block text-on-nav-muted">Role: {session.user.role}</span>
                </span>
              </div>
              <Button variant="on-nav" className="mt-3 w-full" onClick={() => signOut('manual')}>
                Sign out
              </Button>
            </div>
          )}
        </div>
      </header>
      <main
        id="main"
        ref={mainRef}
        tabIndex={-1}
        className="min-w-0 p-4 focus:outline-none md:p-10"
      >
        {/* Each screen fades in (keyed by path); reduced motion turns it off. */}
        <div key={pathname} className="animate-enter">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
