import type { ReactNode } from 'react';
import { createBrowserRouter, createMemoryRouter } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';
import { DesignSystemPage } from '../features/design-system/DesignSystemPage';
import { QuoteBuilderPage } from '../features/quotes/QuoteBuilderPage';
import { RequireAuth } from '../features/auth/RequireAuth';
import { SignInPage } from '../features/auth/SignInPage';
import { AppShell } from './AppShell';
import { RequireRole } from './RequireRole';
import { NotFoundPage } from './NotFoundPage';
import { PlaceholderPage } from './PlaceholderPage';
import { DESIGN_SYSTEM_PATH, NAV_ITEMS } from './routes';

const quoteDetailItem = {
  path: '/quotes/:quoteId',
  label: 'Quote detail',
  workPackage: 'T2-04',
  description: 'Result, arithmetic trail, countdown, audit timeline and actions.',
};

/** Screens that are built. Everything else shows a placeholder until its work package lands. */
const SCREENS: Record<string, ReactNode> = {
  '/quotes/new': <QuoteBuilderPage />,
};

export const routes: RouteObject[] = [
  { path: '/sign-in', element: <SignInPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          ...NAV_ITEMS.map((item) => ({
            path: item.path,
            element: (
              <RequireRole roles={item.roles}>
                {SCREENS[item.path] ?? <PlaceholderPage item={item} />}
              </RequireRole>
            ),
          })),
          { path: '/quotes/:quoteId', element: <PlaceholderPage item={quoteDetailItem} /> },
          { path: DESIGN_SYSTEM_PATH, element: <DesignSystemPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

export const createAppRouter = () => createBrowserRouter(routes);
export const createTestRouter = (initialEntries: string[]) =>
  createMemoryRouter(routes, { initialEntries });
