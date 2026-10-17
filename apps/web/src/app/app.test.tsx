import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider } from 'react-router-dom';
import { axe } from 'vitest-axe';
import { createTestRouter } from './router';
import { NAV_ITEMS } from './routes';

function renderAt(path: string) {
  return render(<RouterProvider router={createTestRouter([path])} />);
}

describe('app shell and routing', () => {
  it.each(NAV_ITEMS)('renders the $label screen at $path', ({ path, label }) => {
    renderAt(path);
    expect(screen.getByRole('heading', { level: 1, name: label })).toBeInTheDocument();
  });

  it('renders a quote detail placeholder for a quote id', () => {
    renderAt('/quotes/01ABC');
    expect(screen.getByRole('heading', { level: 1, name: 'Quote detail' })).toBeInTheDocument();
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

  it('navigates by keyboard and moves focus to the main content', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await user.click(screen.getByRole('link', { name: 'Availability' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Availability' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('offers a skip link as the first tab stop', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await user.tab();
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveFocus();
  });
});

describe('accessibility (axe)', () => {
  it.each(['/', '/design-system', '/nope'])('has no violations at %s', async (path) => {
    const { container } = renderAt(path);
    expect(await axe(container)).toHaveNoViolations();
  });
});
