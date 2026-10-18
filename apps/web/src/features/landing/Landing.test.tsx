import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider } from 'react-router-dom';
import type { Role } from '@c32/core';
import { axe } from 'vitest-axe';
import { Providers } from '../../app/Providers';
import { createTestRouter } from '../../app/router';
import { mockSession } from '../auth/auth';

function renderAt(path: string, role: Role | null = null) {
  return render(
    <Providers initialSession={role ? mockSession(role, 'Meera') : null}>
      <RouterProvider router={createTestRouter([path])} />
    </Providers>,
  );
}

const h1 = /Every group enquiry is a booking opportunity/;

describe('landing page as the front door', () => {
  it('is shown to a signed-out visitor at the site root', () => {
    renderAt('/');
    expect(screen.getByRole('heading', { level: 1, name: h1 })).toBeInTheDocument();
    expect(document.title).toMatch(/StayQuote · Group bookings\. Quoted smarter\./);
  });

  it('is not shown to a signed-in person, who gets the dashboard', () => {
    renderAt('/', 'ServiceManager');
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: h1 })).not.toBeInTheDocument();
  });

  it('leaves every other address on the normal sign-in check', () => {
    renderAt('/review');
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
  });

  it('keeps the sign-in return trip out of the way, so ?error= is not swallowed by the landing page', () => {
    renderAt('/?error=access_denied');
    expect(screen.queryByRole('heading', { level: 1, name: h1 })).not.toBeInTheDocument();
  });

  it('leads to sign-in from the header, the hero, the closing panel and the footer', async () => {
    const user = userEvent.setup();
    renderAt('/');
    const links = screen.getAllByRole('link', {
      name: /^Sign in$|Sign in to the app|Try Your First Group Quote/,
    });
    expect(links.length).toBeGreaterThanOrEqual(4);
    for (const link of links) expect(link).toHaveAttribute('href', '/sign-in');
    await user.click(links[0] as HTMLElement);
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
  });

  it('points "Try a Group Quote" at the sample booking on the page', () => {
    renderAt('/');
    const cta = screen.getAllByRole('link', { name: /Try a Group Quote/ });
    expect(cta.length).toBeGreaterThanOrEqual(2);
    for (const link of cta) expect(link).toHaveAttribute('href', '#try');
  });

  it('says plainly that the data is synthetic', () => {
    renderAt('/');
    expect(screen.getAllByText(/synthetic/i).length).toBeGreaterThan(0);
  });

  it('shows the sample figures from the real engine in the hero', () => {
    renderAt('/');
    const hero = screen.getByRole('heading', { level: 1 }).closest('section') as HTMLElement;
    expect(within(hero).getAllByText('₹40,000').length).toBeGreaterThan(0);
    expect(within(hero).getAllByText('₹24,000').length).toBeGreaterThan(0);
    expect(within(hero).getAllByText('₹1,800').length).toBeGreaterThan(0);
  });

  it('carries the full story in order, from the enquiry to the closing call to action', () => {
    renderAt('/');
    const titles = screen
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent?.replace(/\s+/g, ' ').trim());
    expect(titles).toEqual([
      'Another group enquiry. Another round of calculations.',
      'Your group booking quotation process, simplified.',
      'From enquiry to quotation in three simple steps.',
      'A better quotation is more than just a number.',
      'Know what the numbers say before you negotiate.',
      'Built so a rushed quote cannot lose money.',
      'A quote is a promise with a deadline.',
      'Built for hotels where every group enquiry matters.',
      'Questions a hotel owner would ask.',
      'The next group enquiry could be your next confirmed booking.',
    ]);
  });
});

describe('introducing StayQuote tabs', () => {
  it('switches between availability, pricing, negotiation and the quotation, by keyboard too', async () => {
    const user = userEvent.setup();
    renderAt('/');
    const tabs = screen.getByRole('tablist', { name: 'What StayQuote helps with' });
    const first = within(tabs).getByRole('tab', { name: 'Availability' });
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Check availability before you commit.');

    first.focus();
    await user.keyboard('{ArrowRight}');
    expect(within(tabs).getByRole('tab', { name: 'Pricing' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Total room revenue');
    await user.keyboard('{End}');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Prepare the quote and move forward.');
    await user.keyboard('{ArrowRight}');
    expect(within(tabs).getByRole('tab', { name: 'Availability' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('shows what a discount does to the contribution, from the real engine', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await user.click(screen.getByRole('tab', { name: 'Negotiation' }));
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByText('₹22,000')).toBeInTheDocument();
    expect(within(panel).getByText('Meets the ₹20,000 minimum')).toBeInTheDocument();

    await user.click(within(panel).getByRole('button', { name: '10% off' }));
    expect(within(panel).getByText('₹20,000')).toBeInTheDocument();
    expect(within(panel).getByText('Meets the ₹20,000 minimum')).toBeInTheDocument();

    await user.click(within(panel).getByRole('button', { name: '15% off' }));
    expect(within(panel).getByText('₹18,000')).toBeInTheDocument();
    expect(
      within(panel).getByText('Below the ₹20,000 minimum: needs approval'),
    ).toBeInTheDocument();
  });
});

describe('quote calculator', () => {
  const banner = () =>
    screen.getAllByRole('status').find((el) => el.tagName !== 'OUTPUT') as HTMLElement;

  it('starts on the sample booking: ready to offer, 40000 and 24000', () => {
    renderAt('/');
    expect(within(banner()).getByText('Ready to offer')).toBeInTheDocument();
    expect(screen.getByText('20 x 2000 = 40000 room revenue')).toBeInTheDocument();
    expect(screen.getAllByText('₹24,000').length).toBeGreaterThan(0);
    expect(screen.getByText('Meets floor')).toBeInTheDocument();
  });

  it('asks for review on a 15% discount and offers the lowest safe rate, which fixes it', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await user.click(screen.getByRole('button', { name: '15% discount' }));
    expect(within(banner()).getByText('Service Manager review required')).toBeInTheDocument();
    expect(screen.getByText('Contribution is below the contribution floor.')).toBeInTheDocument();
    expect(screen.getByText(/Below floor: review required/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Use ₹1,800' }));
    expect(within(banner()).getByText('Ready to offer')).toBeInTheDocument();
    expect(screen.getByLabelText('Rate per room per night')).toHaveValue('1800');
  });

  it('accepts a 10% discount, which lands exactly on the minimum', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await user.click(screen.getByRole('button', { name: '10% discount' }));
    expect(within(banner()).getByText('Ready to offer')).toBeInTheDocument();
    expect(screen.getByText('Meets floor')).toBeInTheDocument();
  });

  it('gives a partial offer when more rooms are asked for than exist, never more than 10', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await user.click(screen.getByRole('button', { name: 'Too many rooms' }));
    expect(within(banner()).getByText('Partial offer')).toBeInTheDocument();
    expect(screen.getByText(/You are 2 short/)).toBeInTheDocument();
    expect(screen.getByText('10 rooms x 2 nights = 20 room-nights')).toBeInTheDocument();
  });

  it('shows Unknown, not zero, when a cost has not been entered', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await user.click(screen.getByRole('button', { name: 'Breakfast cost unknown' }));
    expect(within(banner()).getByText('Service Manager review required')).toBeInTheDocument();
    expect(
      screen.getByText('A cost is unknown, so the margin cannot be checked.'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0);
    expect(screen.getByRole('img', { name: /Contribution: Unknown/ })).toBeInTheDocument();
  });

  it('responds to the sliders and marks the example as no longer selected', () => {
    renderAt('/');
    const rate = screen.getByLabelText('Rate per room per night');
    fireEvent.change(rate, { target: { value: '1000' } });
    expect(rate).toHaveValue('1000');
    expect(within(banner()).getByText('Service Manager review required')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'The sample booking' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('is clear that the example is illustrative', () => {
    renderAt('/');
    expect(
      screen.getByText(/Illustrative example\. Actual contribution depends/),
    ).toBeInTheDocument();
  });
});

describe('hold clock', () => {
  it('walks through held and confirmed, and says what each means', async () => {
    const user = userEvent.setup();
    renderAt('/');
    const rooms = () => within(screen.getByRole('list', { name: 'Ten rooms' }));
    expect(rooms().getAllByText('Free')).toHaveLength(10);

    await user.click(screen.getByRole('button', { name: 'Issue the quote' }));
    expect(screen.getByText('Quote issued: rooms are held')).toBeInTheDocument();
    expect(rooms().getAllByText('Held')).toHaveLength(10);
    expect(screen.getByText('3d 0h left')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm it' }));
    expect(screen.getByText('Confirmed: the rooms are booked')).toBeInTheDocument();
    expect(rooms().getAllByText('Booked')).toHaveLength(10);
    expect(screen.getByLabelText('Fast-forward time')).toBeDisabled();
  });

  it('releases the rooms by itself when the time runs out', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await user.click(screen.getByRole('button', { name: 'Issue the quote' }));
    fireEvent.change(screen.getByLabelText('Fast-forward time'), { target: { value: '72' } });
    expect(screen.getByText('Expired: the rooms were released')).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Ten rooms' })).getAllByText('Free'),
    ).toHaveLength(10);
    expect(screen.getByRole('button', { name: 'Issue the quote' })).toBeEnabled();
  });

  it('warns when a hold is close to expiring', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await user.click(screen.getByRole('button', { name: 'Issue the quote' }));
    fireEvent.change(screen.getByLabelText('Fast-forward time'), { target: { value: '60' } });
    expect(screen.getByText('Expiring soon')).toBeInTheDocument();
  });
});

describe('how it works and the FAQs', () => {
  it('moves between the three steps and can be paused', async () => {
    const user = userEvent.setup();
    renderAt('/');
    expect(
      screen.getByRole('heading', { level: 3, name: 'Enter the group booking details' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Review and share your quotation/ }));
    expect(
      screen.getByRole('heading', { level: 3, name: 'Review and share your quotation' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^03/ })).toHaveAttribute('aria-current', 'step');
    // Choosing a step pauses the tour, so it will not run away from the reader.
    expect(screen.getByRole('button', { name: 'Play the tour' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Play the tour' }));
    expect(screen.getByRole('button', { name: 'Pause the tour' })).toBeInTheDocument();
  });

  it('opens and closes each answer, and is honest about what is not built', async () => {
    const user = userEvent.setup();
    renderAt('/');
    const question = screen.getByText('Can it send the quotation to my customer?');
    const details = question.closest('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    await user.click(question);
    expect(details.open).toBe(true);
    expect(
      within(details).getByText(/Sending by email or as a PDF is not built/),
    ).toBeInTheDocument();
    await user.click(question);
    expect(details.open).toBe(false);
  });
});

describe('accessibility', () => {
  it('has a clear heading outline and landmarks', () => {
    renderAt('/');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Footer' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute(
      'href',
      '#content',
    );
  });

  it('has no axe violations', async () => {
    const { container } = renderAt('/');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no axe violations in the unknown, held and negotiation states', async () => {
    const user = userEvent.setup();
    const { container } = renderAt('/');
    await user.click(screen.getByRole('button', { name: 'Breakfast cost unknown' }));
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Issue the quote' }));
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('tab', { name: 'Negotiation' }));
    await user.click(screen.getByRole('button', { name: '15% off' }));
    expect(await axe(container)).toHaveNoViolations();
  });
});
