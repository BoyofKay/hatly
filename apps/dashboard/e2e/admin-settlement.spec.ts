import { test, expect } from '@playwright/test';
import { SUPER_ADMIN_STORAGE_STATE, VENDOR_A_BRANCH_ID } from './env';

/**
 * M3a (Launch-Readiness Gap Audit, G-05 / G-12) — Settlement Dashboard.
 * The close-period action is financial and irreversible: these tests
 * verify the confirmation guard actually gates the network request
 * (dismiss => no call ever made), not just that a dialog string exists
 * somewhere in the code.
 */
test.describe('Admin Settlement — vendor branch close', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  test('dismissing the confirmation sends NO close request', async ({ page }) => {
    let closeRequestSent = false;
    await page.route('**/admin/settlement/vendor-branches/*/close', async (route) => {
      closeRequestSent = true;
      await route.continue();
    });

    await page.goto('/settlement');
    await page.getByRole('combobox').first().selectOption(VENDOR_A_BRANCH_ID);

    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: 'Close Period' }).first().click();

    // The handler's confirm-check is synchronous and runs before any network call — no wait needed
    // beyond the click itself having been dispatched and processed.
    expect(closeRequestSent).toBe(false);
    await expect(page.getByText('Period closed successfully.')).toHaveCount(0);
  });

  test('accepting the confirmation sends the close request, and the page reflects the server response (success or a surfaced error — never silently stuck)', async ({
    page,
  }) => {
    await page.goto('/settlement');
    await page.getByRole('combobox').first().selectOption(VENDOR_A_BRANCH_ID);

    page.once('dialog', (dialog) => dialog.accept());
    const [response] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/admin/settlement/vendor-branches/') && res.url().endsWith('/close')),
      page.getByRole('button', { name: 'Close Period' }).first().click(),
    ]);

    // Whatever the backend answered (200 with a real period, or a 400 "no new activity"/config-not-set
    // error), the button must never be left stuck on "Closing..." — the UI always resolves to one of
    // the two terminal states below.
    if (response.ok()) {
      await expect(page.getByText('Period closed successfully.')).toBeVisible();
    } else {
      // Whatever message the backend sent (or the page's own fallback) — some visible error text,
      // never a button stuck on "Closing..." forever.
      await expect(page.locator('p.text-red-600').first()).toBeVisible();
    }
  });
});
