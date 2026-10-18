import { expect, test } from '@playwright/test';
import { buildQuote, goTo, openApp, signIn } from './helpers';

/**
 * Smoke test for the real local API (Track 1), not the built-in mock. It is skipped unless
 * E2E_REAL_API=1, and it only uses stateless previews, so it can be repeated against a real
 * database without using up rooms.
 *
 * Start the API and the web app as the README describes ("Run against the real API"), then:
 *   E2E_REAL_API=1 E2E_BASE_URL=http://localhost:5173 npx playwright test e2e/real-api.e2e.ts
 */
test.describe('real API (seeded with the case fixture)', () => {
  test.skip(process.env.E2E_REAL_API !== '1', 'Set E2E_REAL_API=1 to run against the real API.');

  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await signIn(page, 'Smoke Reception', 'Reception');
  });

  test('the fixture quote is priced by the real engine: 40000 revenue, 24000 contribution', async ({
    page,
  }) => {
    await buildQuote(page, { organiser: 'Smoke Group', rooms: '10', rate: '2000' });
    await expect(page.getByText('Ready to offer')).toBeVisible();
    const totals = page.locator('section', { has: page.getByRole('heading', { name: 'Totals' }) });
    await expect(totals).toContainText('₹40,000');
    await expect(totals).toContainText('₹24,000');
    await expect(page.getByText('Confirmed by the server.')).toBeVisible();
  });

  test('a rate below the floor needs review and offers the minimum safe rate', async ({ page }) => {
    await buildQuote(page, { organiser: 'Smoke Group', rooms: '10', rate: '1700' });
    await expect(page.getByText('Service Manager review required')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Use rate 1800' })).toBeVisible();
  });

  test('the three public checks pass against the real API', async ({ page }) => {
    await goTo(page, 'Evidence');
    await page.getByRole('button', { name: 'Run the public checks' }).click();
    await expect(page.getByText('3 of 3 checks passed')).toBeVisible();
  });

  test('the availability calendar shows the two seeded nights', async ({ page }) => {
    await goTo(page, 'Availability');
    await expect(page.getByRole('button', { name: /01 Nov.*of 10 free/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /02 Nov.*of 10 free/ })).toBeVisible();
  });
});
