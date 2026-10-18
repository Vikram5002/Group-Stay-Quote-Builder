import { useEffect, useId, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button, Icon, Logo } from '../components';
import type { IconName } from '../components';
import { useAuth } from '../features/auth/auth';
import { OPEN_STATUSES } from '../features/quotes/labels';
import { QUOTES_KEY, useNow, useQuoteList } from '../features/quotes/queries';
import { cn } from '../lib/cn';
import { ROLE_LABEL } from '../lib/roles';
import { useApi } from './ApiProvider';
import { DESIGN_SYSTEM_PATH, NAV_ITEMS } from './routes';
import type { NavItem } from './routes';

const APP_NAME = 'Group Stay Quote Builder';
const DAY_MS = 86_400_000;

const linkClass = (active: boolean) =>
  cn(
    'group relative flex h-10 items-center gap-3 rounded-xl px-3 text-sm',
    active
      ? 'bg-surface font-semibold text-on-nav shadow-[0_1px_2px_rgb(10_10_10/0.06)] ring-1 ring-border'
      : 'font-medium text-on-nav-muted hover:bg-black/[0.04] hover:text-on-nav',
  );

/** The icon beside each menu entry. */
const NAV_ICONS: Record<string, IconName> = {
  '/': 'dashboard',
  '/quotes': 'quotes',
  '/quotes/new': 'plus',
  '/review': 'review',
  '/availability': 'calendar',
  '/imports': 'transfer',
  '/policy': 'policy',
  '/evidence': 'evidence',
  '/experiments': 'experiments',
  [DESIGN_SYSTEM_PATH]: 'palette',
};

/** The icon in a menu entry: ink when current, muted otherwise. */
function NavIcon({ path, active }: { path: string; active: boolean }) {
  return (
    <>
      <Icon
        name={NAV_ICONS[path] ?? 'layers'}
        className={cn(
          'size-[1.1rem]',
          active ? 'text-on-nav' : 'text-on-nav-muted group-hover:text-on-nav',
        )}
      />
    </>
  );
}

/** A count next to a menu entry, read out with its meaning. */
function CountBadge({ count, label }: { count: number; label: string }) {
  if (count <= 0) return null;
  return (
    <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-nav-accent px-1.5 text-[0.7rem] font-semibold text-white tabular-nums">
      <span aria-hidden="true">{count > 99 ? '99+' : count}</span>
      <span className="sr-only">
        , {count} {label}
      </span>
    </span>
  );
}

/**
 * Quotes waiting for this person, for the Review queue badge: the Service Manager's reviews, or the
 * quotes sent to the Owner for a discount (D-062). Shares the queue's own query.
 */
function usePendingReviewCount(role: string | undefined): number {
  const enabled = role === 'ServiceManager' || role === 'Owner';
  const api = useApi();
  const pending = useQuery({
    queryKey: [...QUOTES_KEY, 'review'],
    queryFn: () => api.listQuotes({ status: 'PENDING_REVIEW', limit: '100' }),
    enabled,
  });
  if (!enabled) return 0;
  const forOwner = role === 'Owner';
  return (pending.data?.items ?? []).filter((q) => Boolean(q.awaiting_owner) === forOwner).length;
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
  const pendingReviews = usePendingReviewCount(role);
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
          <NavIcon path={item.path} active={active} />
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
      <div className="mt-6 first:mt-0">
        {heading && (
          <p className="px-3 pb-1.5 text-[0.68rem] font-semibold tracking-[0.12em] text-on-nav-muted uppercase">
            {heading}
          </p>
        )}
        <ul className="flex flex-col gap-0.5">{list.map(entry)}</ul>
      </div>
    );
  };

  return (
    <div className="min-h-screen md:grid md:grid-cols-[15.5rem_1fr] md:bg-[linear-gradient(to_right,var(--color-nav)_calc(15.5rem-1px),var(--color-border)_calc(15.5rem-1px)_15.5rem,transparent_15.5rem)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-4 focus:py-2"
      >
        Skip to main content
      </a>
      <header className="sticky top-0 z-30 flex flex-col border-b border-border bg-nav text-on-nav md:h-screen md:border-r md:border-b-0 md:overflow-y-auto">
        <div className="relative flex items-center justify-between gap-3 px-4 py-4 md:py-5">
          <Link to="/" className="flex items-center gap-2.5 rounded-control">
            <Logo className="size-9" />
            <span>
              <span className="block text-[0.875rem] leading-tight font-semibold tracking-tight text-ink">
                {APP_NAME}
              </span>
              <span className="mt-1 inline-flex items-center gap-1.5 text-[0.7rem] font-medium text-on-nav-muted">
                <span aria-hidden="true" className="relative flex size-1.5">
                  <span className="c32-ping absolute inset-0 rounded-full bg-accent-bright" />
                  <span className="relative size-1.5 rounded-full bg-accent-bright" />
                </span>
                Demo data
              </span>
            </span>
          </Link>
          <Button
            variant="on-nav"
            className="px-3 md:hidden"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Icon name={menuOpen ? 'close' : 'menu'} className="size-4" />
            {menuOpen ? 'Close menu' : 'Menu'}
          </Button>
        </div>
        <div
          id={menuId}
          className={cn(
            'relative md:flex md:flex-1 md:flex-col',
            menuOpen ? 'flex flex-col' : 'hidden',
          )}
        >
          <nav aria-label="Primary" className="px-3 pb-4">
            {action && (
              <Link
                to={action.path}
                aria-current={pathname === action.path ? 'page' : undefined}
                className="group/new mb-6 flex h-10 items-center justify-center gap-2 rounded-xl bg-nav-accent px-3 text-sm font-semibold text-white shadow-brand hover:bg-brand-hover active:scale-[0.98]"
              >
                <Icon
                  name="plus"
                  className="size-4 transition-transform duration-300 group-hover/new:rotate-90"
                  strokeWidth={2.25}
                />
                {action.label}
              </Link>
            )}
            {group('work')}
            {group('admin', 'Admin')}
            <details
              className="group/about mt-6 border-t border-border pt-4"
              {...(projectOpen || pathname === DESIGN_SYSTEM_PATH ? { open: true } : {})}
            >
              <summary className="flex h-10 cursor-pointer list-none items-center gap-3 rounded-xl px-3 text-sm font-medium text-on-nav-muted hover:bg-black/[0.04] hover:text-on-nav [&::-webkit-details-marker]:hidden">
                <Icon name="info" className="size-[1.1rem]" />
                About this project
                <span
                  aria-hidden="true"
                  className="ml-auto text-base leading-none transition-transform group-open/about:rotate-90"
                >
                  ›
                </span>
              </summary>
              <ul className="mt-1 flex flex-col gap-0.5">
                {items.filter((i) => i.group === 'project').map(entry)}
                <li>
                  <NavLink to={DESIGN_SYSTEM_PATH} className={({ isActive: a }) => linkClass(a)}>
                    {({ isActive: a }) => (
                      <>
                        <NavIcon path={DESIGN_SYSTEM_PATH} active={a} />
                        Design system
                      </>
                    )}
                  </NavLink>
                </li>
              </ul>
            </details>
          </nav>
          {session && (
            <div className="m-3 mt-auto rounded-2xl border border-border bg-surface p-3 text-sm shadow-card">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#3f3f46] to-[#0a0a0a] text-sm font-semibold text-white"
                >
                  {(session.displayName.trim()[0] ?? '?').toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-ink">
                    {session.displayName}
                  </span>
                  <span className="block text-xs text-on-nav-muted">
                    Role: {ROLE_LABEL[session.user.role]}
                  </span>
                </span>
              </div>
              <Button
                variant="on-nav"
                className="mt-3 min-h-9 w-full text-[0.8rem]"
                onClick={() => signOut('manual')}
              >
                <Icon name="logout" className="size-4" />
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
        className="relative isolate min-w-0 px-4 py-6 focus:outline-none md:px-10 md:py-10"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-80 bg-[radial-gradient(60%_100%_at_70%_0%,rgb(255_207_77/0.10),transparent_70%)]"
        />
        {/* Each screen fades in (keyed by path); reduced motion turns it off. */}
        <div key={pathname} className="animate-enter">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
