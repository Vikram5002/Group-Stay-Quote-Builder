import { useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { cn } from '../lib/cn';
import { DESIGN_SYSTEM_PATH, NAV_ITEMS } from './routes';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex min-h-11 items-center rounded-control px-3 text-sm font-semibold',
    isActive ? 'bg-brand-soft text-brand' : 'text-ink hover:bg-surface-muted',
  );

export function AppShell() {
  const mainRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const previousPath = useRef(pathname);

  // Move focus to the page content after navigation so keyboard and screen reader users
  // start at the top of the new screen instead of in the sidebar.
  // Skipped on first load so the skip link stays the first tab stop.
  useEffect(() => {
    if (previousPath.current !== pathname) {
      previousPath.current = pathname;
      mainRef.current?.focus();
    }
  }, [pathname]);

  return (
    <div className="min-h-screen md:grid md:grid-cols-[16rem_1fr]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-10 focus:rounded-control focus:bg-surface focus:px-4 focus:py-2"
      >
        Skip to main content
      </a>
      <header className="border-b border-border bg-surface md:border-b-0 md:border-r">
        <div className="p-4">
          <p className="text-base font-bold">Group Stay Quote Builder</p>
          <p className="text-xs text-ink-muted">Case C32 · synthetic data</p>
        </div>
        <nav aria-label="Primary" className="px-2 pb-4">
          <ul className="flex flex-wrap gap-1 md:flex-col">
            {NAV_ITEMS.map((item) => (
              <li key={item.path}>
                <NavLink to={item.path} end={item.path === '/'} className={linkClass}>
                  {item.label}
                </NavLink>
              </li>
            ))}
            <li className="md:mt-4 md:border-t md:border-border md:pt-4">
              <NavLink to={DESIGN_SYSTEM_PATH} className={linkClass}>
                Design system
              </NavLink>
            </li>
          </ul>
        </nav>
      </header>
      <main id="main" ref={mainRef} tabIndex={-1} className="p-4 focus:outline-none md:p-8">
        <Outlet />
      </main>
    </div>
  );
}
