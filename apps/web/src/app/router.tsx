import type { ReactNode } from 'react';
import { createBrowserRouter, createMemoryRouter } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';
import { DesignSystemPage } from '../features/design-system/DesignSystemPage';
import { AvailabilityPage } from '../features/availability/AvailabilityPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { PolicyPage } from '../features/policy/PolicyPage';
import { ReviewQueuePage } from '../features/review/ReviewQueuePage';
import { QuoteDetailPage } from '../features/quotes/QuoteDetailPage';
import { QuoteBuilderPage } from '../features/quotes/QuoteBuilderPage';
import { RequireAuth } from '../features/auth/RequireAuth';
import { SignInPage } from '../features/auth/SignInPage';
import { AppShell } from './AppShell';
import { RequireRole } from './RequireRole';
import { NotFoundPage } from './NotFoundPage';
import { PlaceholderPage } from './PlaceholderPage';
import { DESIGN_SYSTEM_PATH, NAV_ITEMS } from './routes';

/** Screens that are built. Everything else shows a placeholder until its work package lands. */
const SCREENS: Record<string, ReactNode> = {
  '/': <DashboardPage />,
  '/quotes/new': <QuoteBuilderPage />,
  '/review': <ReviewQueuePage />,
  '/availability': <AvailabilityPage />,
  '/policy': <PolicyPage />,
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
          { path: '/quotes/:quoteId', element: <QuoteDetailPage /> },
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
