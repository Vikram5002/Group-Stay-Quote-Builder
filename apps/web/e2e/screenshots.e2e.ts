import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { buildQuote, goTo, issueQuote, openApp, signIn, signOut } from './helpers';

/**
 * Takes the UI screenshots that Track 4 uses as evidence. It is skipped in normal runs:
 *   npm run screenshots -w @c32/web
 * It tells one story with the built-in mock API (the fixture, a shortage and a below-floor quote
 * through to approval) and saves PNGs to docs/ui/screenshots.
 */
const OUT = fileURLToPath(new URL('../../../docs/ui/screenshots/', import.meta.url));

async function shot(page: Page, name: string) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}${name}.png` });
}

test.describe('evidence screenshots', () => {
  test.skip(process.env.SCREENSHOTS !== '1', 'Set SCREENSHOTS=1 to take the screenshots.');
  // Tall enough to show a whole screen without a full-page capture.
  test.use({ viewport: { width: 1280, height: 1500 } });

  test('one story through every screen', async ({ page }) => {
    test.setTimeout(180_000);
    mkdirSync(OUT, { recursive: true });

    await openApp(page);
    await shot(page, '01-sign-in');

    await signIn(page, 'Asha', 'Sales');
    await shot(page, '02-dashboard-empty');

    // The fixture: 10 rooms, 2 nights, rate 2000 (revenue 40000, contribution 24000).
    await buildQuote(page, { organiser: 'Fictional Events Pvt Ltd', rooms: '10', rate: '2000' });
    await expect(page.getByText('Ready to offer')).toBeVisible();
    await expect(page.getByText('Confirmed by the server.')).toBeVisible();
    await shot(page, '03-quote-builder-fixture-offer');

    // The shortage: 12 rooms when 10 are available.
    await buildQuote(page, { organiser: 'Fictional Events Pvt Ltd', rooms: '12', rate: '2000' });
    await expect(page.getByText('Partial offer: 10 of 12 rooms')).toBeVisible();
    await shot(page, '04-quote-builder-partial-offer');

    // Below the floor: needs review.
    await buildQuote(page, { organiser: 'Discount Group', rooms: '10', rate: '1700' });
    await expect(page.getByText('Owner review required')).toBeVisible();
    await expect(page.getByText('Confirmed by the server.')).toBeVisible();
    await shot(page, '05-quote-builder-below-floor');
    await issueQuote(page, 'Send for Owner review');
    await expect(page.getByRole('heading', { name: 'Audit timeline' })).toBeVisible();
    await shot(page, '06-quote-detail-pending-review');

    await goTo(page, 'Dashboard');
    await expect(page.getByRole('heading', { name: 'Pipeline by status' })).toBeVisible();
    await shot(page, '07-dashboard');

    await goTo(page, 'Availability');
    await page.getByRole('button', { name: /01 Nov/ }).click();
    await expect(page.getByRole('heading', { name: /Night of/ })).toBeVisible();
    await shot(page, '08-availability-calendar');
    await signOut(page);

    await signIn(page, 'Meera', 'Owner');
    await goTo(page, 'Review queue');
    await expect(page.getByRole('heading', { level: 2, name: 'Discount Group' })).toBeVisible();
    await shot(page, '09-review-queue');
    await page.getByRole('button', { name: 'Approve…' }).click();
    await page.getByRole('dialog').getByLabel('Reason').fill('Repeat client, strategic account');
    await shot(page, '10-approval-dialog');
    await page.getByRole('dialog').getByRole('button', { name: 'Approve quote' }).click();
    await expect(page.getByText('Quote approved')).toBeVisible();
    await shot(page, '11-review-queue-approved');

    await goTo(page, 'Policy');
    await expect(page.getByLabel(/Quote validity/)).toBeVisible();
    await shot(page, '12-policy');

    await goTo(page, 'Imports and exports');
    await page.getByLabel(/File \(CSV or JSON\)/).setInputFiles({
      name: 'inventory.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'date,room_type,rooms\n2026-11-20,standard,10\n2026-11-21,standard,\n2026-11-22,standard,ten\n',
      ),
    });
    await page.getByRole('button', { name: 'Check file' }).click();
    await expect(page.getByRole('table', { name: 'Problems found, by row' })).toBeVisible();
    await shot(page, '13-imports-row-report');

    await goTo(page, 'Evidence');
    await page.getByRole('button', { name: 'Run the public checks' }).click();
    await expect(page.getByRole('table', { name: 'Public check results' })).toBeVisible();
    await shot(page, '14-evidence');

    await goTo(page, 'Experiment log');
    await page.getByLabel(/Role played/).fill('Corporate offsite planner');
    await page.getByLabel(/Sent at/).fill('2026-10-20T09:30');
    await page.getByLabel(/First response at/).fill('2026-10-20T11:45');
    await page.getByLabel('How far it went').selectOption('2');
    await page.getByLabel(/What they said/).fill('Asked to include breakfast');
    await page.getByLabel('This person agreed to play the role').check();
    await page.getByRole('button', { name: 'Add to the log' }).click();
    await expect(page.getByText('ORG-01 was added to the log.')).toBeVisible();
    await shot(page, '15-experiment-log');

    await goTo(page, 'Design system');
    await shot(page, '16-design-system');

    // The same builder on a phone.
    await page.setViewportSize({ width: 393, height: 1500 });
    await goTo(page, 'Dashboard');
    await shot(page, '17-dashboard-phone');
  });
});
