import { test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { openApp, signIn, goTo } from './helpers';

/**
 * A screenshot tour of every screen for design review (D-060). Skipped in normal runs:
 *   UI_TOUR=1 UI_TOUR_OUT=<folder> npx playwright test e2e/ui-tour.e2e.ts --project=desktop
 */
const OUT = process.env.UI_TOUR_OUT ?? fileURLToPath(new URL('../ui-tour/', import.meta.url));

test.describe('UI tour', () => {
  test.skip(process.env.UI_TOUR !== '1', 'Set UI_TOUR=1 to take the tour screenshots.');

  test('every screen', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page, '/');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}01-landing.png` });
    await page.goto('/sign-in');
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}02-sign-in.png` });
    await signIn(page, 'Asha Rao', 'ServiceManager');
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}03-dashboard.png` });

    await goTo(page, 'New quote');
    await page.getByLabel(/Organiser name/).fill('Fictional Events Pvt Ltd');
    await page.getByLabel(/Check-in date/).fill('2026-11-01');
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}04-new-quote-1.png` });
    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}05-new-quote-2.png` });
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}06-review.png`, fullPage: true });
    await page.getByRole('button', { name: /Issue quote|Send for Service Manager review/ }).click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}07-quote-detail.png`, fullPage: true });

    for (const [menu, file] of [
      ['Review queue', '08-review-queue'],
      ['Availability', '09-availability'],
      ['Imports and exports', '10-imports'],
      ['Policy', '11-policy'],
    ] as const) {
      await goTo(page, menu);
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${OUT}${file}.png`, fullPage: true });
    }
  });
});
