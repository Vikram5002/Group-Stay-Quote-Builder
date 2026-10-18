import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { Role } from '@c32/core';
import { axe } from 'vitest-axe';
import { mockSession } from '../features/auth/auth';
import { Providers } from './Providers';
import { RouteErrorPage } from './RouteErrorPage';
import { createTestRouter, routes } from './router';
import { NAV_ITEMS } from './routes';

function renderAt(path: string, role: Role | null = 'Owner') {
  return render(
    <Providers initialSession={role ? mockSession(role, 'Meera') : null}>
      <RouterProvider router={createTestRouter([path])} />
    </Providers>,
  );
}

describe('app shell and routing', () => {
  it.each(NAV_ITEMS)('renders the $label screen at $path for an Owner', ({ path, label }) => {
    renderAt(path);
    expect(screen.getByRole('heading', { level: 1, name: label })).toBeInTheDocument();
  });

  it('shows the design system gallery', () => {
    renderAt('/design-system');
    expect(screen.getByRole('heading', { level: 1, name: 'Design system' })).toBeInTheDocument();
  });

  it('shows a not-found screen for unknown addresses', () => {
    renderAt('/nope');
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
  });

  it('marks the current screen in the navigation', () => {
    renderAt('/review');
    expect(screen.getByRole('link', { name: 'Review queue' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
  });

  it("navigates by keyboard and moves focus to the new screen's heading", async () => {
    const user = userEvent.setup();
    renderAt('/');
    await user.click(screen.getByRole('link', { name: 'Availability' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Availability' })).toHaveFocus();
  });

  it('groups the menu, with New quote as the main action and project pages set apart', () => {
    renderAt('/', 'Owner');
    const menu = screen.getByRole('navigation', { name: 'Primary' });
    const labels = within(menu)
      .getAllByRole('link')
      .map((l) => l.textContent?.replace(/,.*$/, '').replace(/^\+/, ''));
    expect(labels).toEqual([
      'New quote',
      'Dashboard',
      'Quotes',
      'Review queue',
      'Availability',
      'Imports and exports',
      'Policy',
      'Evidence',
      'Experiment log',
      'Design system',
    ]);
    expect(within(menu).getByText('About this project').closest('details')).not.toHaveAttribute(
      'open',
    );
  });

  it('opens and closes the menu on small screens', async () => {
    const user = userEvent.setup();
    renderAt('/');
    const button = screen.getByRole('button', { name: 'Menu' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);
    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await user.click(screen.getByRole('link', { name: 'Availability' }));
    expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps the browser tab title in step with the screen', async () => {
    const user = userEvent.setup();
    renderAt('/review');
    await waitFor(() => expect(document.title).toBe('Review queue · Group Stay Quote Builder'));
    await user.click(screen.getByRole('link', { name: 'Availability' }));
    await waitFor(() => expect(document.title).toBe('Availability · Group Stay Quote Builder'));
  });

  it('offers a skip link as the first tab stop', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await user.tab();
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveFocus();
  });
});

describe('sign-in and roles', () => {
  it('sends a signed-out visitor to the sign-in page', () => {
    renderAt('/review', null);
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
  });

  it('asks for a name before signing in', async () => {
    const user = userEvent.setup();
    renderAt('/sign-in', null);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText(/Enter a name/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Your name/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('signs in with the chosen role and returns to the requested screen', async () => {
    const user = userEvent.setup();
    renderAt('/availability', null);
    await user.type(screen.getByLabelText(/Your name/), 'Asha Rao');
    await user.selectOptions(screen.getByLabelText('Role'), 'Viewer');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Availability' })).toBeInTheDocument();
    expect(screen.getByText('Asha Rao')).toBeInTheDocument();
    expect(screen.getByText('Role: Viewer')).toBeInTheDocument();
  });

  it('returns to the same address after sign-in, filters included', async () => {
    const user = userEvent.setup();
    renderAt('/quotes?status=OFFERED', null);
    await user.type(screen.getByLabelText(/Your name/), 'Asha Rao');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Quotes' })).toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toHaveValue('OFFERED');
  });

  it('says when a session ended, on the sign-in page', () => {
    const router = createMemoryRouter(routes, {
      initialEntries: [{ pathname: '/sign-in', state: { from: '/review', expired: true } }],
    });
    render(
      <Providers initialSession={null}>
        <RouterProvider router={router} />
      </Providers>,
    );
    expect(screen.getByText('Your session ended')).toBeInTheDocument();
  });

  it('signs out and returns to the front page, which leads to sign-in', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /Every group enquiry is a booking opportunity/,
      }),
    ).toBeInTheDocument();
    await user.click(screen.getAllByRole('link', { name: /^Sign in$/ })[0] as HTMLElement);
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
  });

  it('starts the next person at the dashboard after a deliberate sign-out', async () => {
    const user = userEvent.setup();
    renderAt('/availability');
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await user.type(screen.getByLabelText(/Your name/), 'Ravi');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
  });

  it('hides Owner-only screens from the menu for Sales', () => {
    renderAt('/', 'Sales');
    expect(screen.getByRole('link', { name: 'New quote' })).toBeInTheDocument();
    for (const name of ['Review queue', 'Policy']) {
      expect(screen.queryByRole('link', { name })).not.toBeInTheDocument();
    }
  });

  it('hides write screens from the menu for Viewer', () => {
    renderAt('/', 'Viewer');
    expect(screen.queryByRole('link', { name: 'New quote' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Evidence' })).toBeInTheDocument();
  });

  it('explains when a role opens an Owner-only address directly', () => {
    renderAt('/policy', 'Sales');
    expect(screen.getByRole('heading', { level: 1, name: 'Not allowed' })).toBeInTheDocument();
    expect(screen.getByText(/This screen is for Owner/)).toBeInTheDocument();
  });
});

describe('accessibility (axe)', () => {
  it.each(['/', '/design-system', '/nope'])('has no violations at %s', async (path) => {
    const { container } = renderAt(path);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no violations on the sign-in page', async () => {
    const { container } = renderAt('/sign-in', null);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('a screen that fails', () => {
  it('shows a way out instead of a blank page', async () => {
    // React reports the error it caught; keep the test output quiet.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const quiet = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener('error', quiet);
    function Boom(): never {
      throw new Error('Kaboom in a test');
    }
    const router = createMemoryRouter([
      { path: '/', element: <Boom />, errorElement: <RouteErrorPage /> },
    ]);
    const user = userEvent.setup();
    render(<RouterProvider router={router} />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Something went wrong' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the dashboard' })).toHaveAttribute('href', '/');
    await user.click(screen.getByText('Details for support'));
    expect(screen.getByText('Kaboom in a test')).toBeInTheDocument();
    window.removeEventListener('error', quiet);
    spy.mockRestore();
  });

  it('keeps the menu when a screen inside the app fails', () => {
    // Every screen route sits under a route with its own error page, inside the shell.
    const shell = routes[1]?.children?.[0];
    expect(shell?.children?.[0]?.errorElement).toBeTruthy();
  });
});
