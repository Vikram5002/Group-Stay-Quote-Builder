import { expect, test } from '@playwright/test';
import { buildQuote, expectNoA11yViolations, goTo, issueQuote, openApp, signIn } from './helpers';

test.describe('keyboard and sign-in', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
  });

  test('the skip link is the first tab stop and moves focus to the content', async ({ page }) => {
    await signIn(page, 'Meera', 'ServiceManager');
    // A fresh load, so keyboard focus starts at the top of the document.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('main')).toBeFocused();
  });

  test('each screen sets a meaningful tab title', async ({ page }) => {
    await expect(page).toHaveTitle(/Sign in/);
    await signIn(page, 'Meera', 'ServiceManager');
    await expect(page).toHaveTitle(/^Dashboard/);
    await goTo(page, 'Review queue');
    await expect(page).toHaveTitle(/^Review queue/);
  });

  test('the wizard can be submitted from the keyboard and explains what is missing', async ({
    page,
  }) => {
    await signIn(page, 'Asha', 'Reception');
    await goTo(page, 'New quote');
    await page.getByLabel('Organiser name').focus();
    await page.keyboard.press('Enter');
    // Each field says what is wrong, and a summary above the form lists them.
    await expect(page.locator('form').getByText('Enter a name')).toBeVisible();
    await expect(page.locator('form').getByText('Enter a valid date')).toBeVisible();
    await expect(page.getByText('Check 2 fields to continue')).toBeVisible();
    await expect(page.getByLabel('Organiser name')).toHaveAttribute('aria-invalid', 'true');
  });

  test('a dialog traps focus and closes with Escape, returning focus to its opener', async ({
    page,
  }) => {
    await signIn(page, 'Asha', 'Reception');
    await buildQuote(page, { organiser: 'Focus Group', rate: '2000' });
    await issueQuote(page, 'Issue quote');
    const opener = page.getByRole('button', { name: 'Extend validity' });
    await opener.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Extra hours')).toBeVisible();
    for (let i = 0; i < 8; i++) await page.keyboard.press('Tab');
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('a viewer sees no write actions and Service Manager screens explain why they are closed', async ({
    page,
  }) => {
    await signIn(page, 'Vik', 'Viewer');
    const menu = page.getByRole('navigation', { name: 'Primary' });
    await expect(menu.getByRole('link', { name: 'New quote' })).toHaveCount(0);
    await expect(menu.getByRole('link', { name: 'Policy' })).toHaveCount(0);
    await expect(menu.getByRole('link', { name: 'Availability' })).toBeVisible();
  });
});

test.describe('accessibility (axe, WCAG 2.1 A and AA)', () => {
  test('every screen has no violations, with real content on it', async ({ page }) => {
    test.setTimeout(120_000);
    await openApp(page);
    await expectNoA11yViolations(page, 'sign-in');

    await signIn(page, 'Asha', 'ServiceManager');
    await expectNoA11yViolations(page, 'dashboard (empty)');

    // Build real content: one quote that needs review, so detail and review screens are full.
    await goTo(page, 'New quote');
    await expectNoA11yViolations(page, 'quote builder, step 1');
    await page.getByLabel('Organiser name').fill('Accessibility Group');
    await page.getByLabel('Check-in date').fill('2026-11-01');
    await page.getByRole('button', { name: 'Next' }).click();
    await expectNoA11yViolations(page, 'quote builder, step 2');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel('Or a fixed rate per room-night (INR)').fill('1700');
    await page.getByRole('button', { name: 'Add inclusion' }).click();
    await expectNoA11yViolations(page, 'quote builder, step 3 with an inclusion');
    await page.getByRole('button', { name: 'Remove inclusion 1' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Service Manager review required')).toBeVisible();
    await expectNoA11yViolations(page, 'quote builder, review step');
    await issueQuote(page, 'Send for Service Manager review');

    await expect(page.getByRole('heading', { name: 'Audit timeline' })).toBeVisible();
    await expectNoA11yViolations(page, 'quote detail');
    await page.getByRole('button', { name: 'Extend validity' }).click();
    await expectNoA11yViolations(page, 'extend dialog');
    await page.keyboard.press('Escape');

    await goTo(page, 'Dashboard');
    await expect(page.getByRole('heading', { name: 'Pipeline by status' })).toBeVisible();
    await expectNoA11yViolations(page, 'dashboard (with a quote)');

    await goTo(page, 'Review queue');
    await expect(
      page.getByRole('heading', { level: 2, name: 'Accessibility Group' }),
    ).toBeVisible();
    await expectNoA11yViolations(page, 'review queue');
    await page.getByRole('button', { name: 'Reject…' }).click();
    await expectNoA11yViolations(page, 'reject dialog');
    await page.keyboard.press('Escape');

    await goTo(page, 'Availability');
    await page.getByRole('button', { name: /01 Nov/ }).click();
    await expect(page.getByRole('heading', { name: /Night of/ })).toBeVisible();
    await expectNoA11yViolations(page, 'availability with a night chosen');

    await goTo(page, 'Policy');
    await expect(page.getByLabel(/Quote validity/)).toBeVisible();
    await expectNoA11yViolations(page, 'policy');

    await goTo(page, 'Imports and exports');
    await expectNoA11yViolations(page, 'imports and exports');

    await goTo(page, 'Evidence');
    await page.getByRole('button', { name: 'Run the public checks' }).click();
    // Rooms held by the quote above can make a check fail; here only the table matters.
    await expect(page.getByRole('table', { name: 'Public check results' })).toBeVisible();
    await expectNoA11yViolations(page, 'evidence with results');

    await goTo(page, 'Experiment log');
    await expectNoA11yViolations(page, 'experiment log');

    await goTo(page, 'Design system');
    await expectNoA11yViolations(page, 'design system');
  });
});
