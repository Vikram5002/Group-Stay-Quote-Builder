import { createBrowserRouter, createMemoryRouter } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';
import { DesignSystemPage } from '../features/design-system/DesignSystemPage';
import { AppShell } from './AppShell';
import { NotFoundPage } from './NotFoundPage';
import { PlaceholderPage } from './PlaceholderPage';
import { DESIGN_SYSTEM_PATH, NAV_ITEMS } from './routes';

const quoteDetailItem = {
  path: '/quotes/:quoteId',
  label: 'Quote detail',
  workPackage: 'T2-04',
  description: 'Result, arithmetic trail, countdown, audit timeline and actions.',
};

export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      ...NAV_ITEMS.map((item) => ({
        path: item.path,
        element: <PlaceholderPage item={item} />,
      })),
      { path: '/quotes/:quoteId', element: <PlaceholderPage item={quoteDetailItem} /> },
      { path: DESIGN_SYSTEM_PATH, element: <DesignSystemPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const createAppRouter = () => createBrowserRouter(routes);
export const createTestRouter = (initialEntries: string[]) =>
  createMemoryRouter(routes, { initialEntries });
