import { expect, test } from '@playwright/test';
import { buildQuote, goTo, issueQuote, openApp, signIn, signOut } from './helpers';

test.describe('rubric flows', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
  });

  test('fixture: 10 rooms, 2 nights, rate 2000 is offered, issued, confirmed and shown as booked', async ({
    page,
  }) => {
    await signIn(page, 'Asha', 'Reception');
    await buildQuote(page, { organiser: 'Fictional Events Pvt Ltd', rooms: '10', rate: '2000' });

    await expect(page.getByText('Ready to offer')).toBeVisible();
    const totals = page.locator('section', { has: page.getByRole('heading', { name: 'Totals' }) });
    await expect(totals).toContainText('₹40,000');
    await expect(totals).toContainText('₹24,000');
    await expect(page.getByText('20 x 2000 = 40000 room revenue')).toBeVisible();

    await issueQuote(page, 'Issue quote');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Fictional Events Pvt Ltd' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Hold countdown' })).toBeVisible();

    await page.getByRole('button', { name: 'Confirm booking…' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm booking' }).click();
    await expect(page.getByRole('button', { name: 'Confirm booking…' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Audit timeline' })).toBeVisible();

    await goTo(page, 'Availability');
    await expect(
      page.getByRole('button', { name: /01 Nov.*0 of 10 free.*Held 0.*Confirmed 10/ }),
    ).toBeVisible();
  });

  test('shortage: 12 rooms when 10 are available is a partial offer and never an over-hold', async ({
    page,
  }) => {
    await signIn(page, 'Asha', 'Reception');
    await buildQuote(page, { organiser: 'Big Group', rooms: '12', rate: '2000' });

    await expect(page.getByText('Partial offer: 10 of 12 rooms')).toBeVisible();
    await expect(page.getByText(/You are 2 short/)).toBeVisible();
    await issueQuote(page, 'Issue quote');
    await expect(page.getByRole('heading', { level: 1, name: 'Big Group' })).toBeVisible();

    await goTo(page, 'Availability');
    await expect(
      page.getByRole('button', { name: /01 Nov.*0 of 10 free.*Held 10.*Confirmed 0/ }),
    ).toBeVisible();

    // Nothing is left, so a second request cannot be offered.
    await buildQuote(page, { organiser: 'Late Group', rooms: '1', rate: '2000' });
    await expect(page.getByText('This request cannot be offered')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Issue quote' })).toBeDisabled();
  });

  test('below the floor: review is required, the Service Manager approves, a different person confirms', async ({
    page,
  }) => {
    await signIn(page, 'Asha', 'Reception');
    await buildQuote(page, { organiser: 'Discount Group', rate: '1700' });
    await expect(page.getByText('Service Manager review required')).toBeVisible();
    await expect(page.getByText(/Over the limit: owner review/).first()).toBeVisible();
    await issueQuote(page, 'Send for Service Manager review');

    await expect(page.getByText(/must approve it before it can be confirmed/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm booking…' })).toHaveCount(0);
    await signOut(page);

    // The creator cannot approve their own quote, even as a Service Manager.
    await signIn(page, 'Asha', 'ServiceManager');
    await goTo(page, 'Review queue');
    await expect(page.getByRole('button', { name: 'Approve…' })).toBeDisabled();
    await expect(
      page.getByText(/You created this quote, so someone else must approve it/),
    ).toBeVisible();
    await signOut(page);

    await signIn(page, 'Meera', 'ServiceManager');
    await goTo(page, 'Review queue');
    await expect(page.getByRole('heading', { level: 2, name: 'Discount Group' })).toBeVisible();
    const comparison = page.getByRole('table', { name: /Requested terms compared/ });
    await expect(comparison).toContainText('1,700');
    await expect(comparison).toContainText('1,800');

    await page.getByRole('button', { name: 'Approve…' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Reason').fill('ok');
    await dialog.getByRole('button', { name: 'Approve quote' }).click();
    await expect(dialog.getByText('Enter at least 5 characters explaining why.')).toBeVisible();
    await dialog.getByLabel('Reason').fill('Repeat client, strategic account');
    await dialog.getByRole('button', { name: 'Approve quote' }).click();
    await expect(page.getByText('Quote approved')).toBeVisible();
    await expect(page.getByText('Nothing is waiting for review')).toBeVisible();
    await signOut(page);

    await signIn(page, 'Ravi', 'Reception');
    await page.getByRole('link', { name: 'Discount Group' }).first().click();
    await page.getByRole('button', { name: 'Confirm booking…' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm booking' }).click();
    await expect(page.getByRole('button', { name: 'Confirm booking…' })).toHaveCount(0);
    await expect(page.getByText('Approved by meera')).toBeVisible();
  });
});
