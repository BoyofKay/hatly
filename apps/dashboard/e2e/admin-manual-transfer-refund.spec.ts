import { test, expect } from '@playwright/test';
import { SUPER_ADMIN_STORAGE_STATE } from './env';

/**
 * M3a (Launch-Readiness Gap Audit, G-25 / G-12) — Manual Transfer
 * refund. A random-looking (but well-formed) payment id is enough to
 * exercise the confirmation guard and the request wiring itself — the
 * backend's own 404 ("Payment not found") for a nonexistent id is a
 * legitimate, deterministic response to assert against, and never
 * requires seeding a real PAID payment (a multi-step checkout +
 * manual-transfer-approval flow) just to prove the button is wired
 * correctly.
 */
test.describe('Admin Manual Transfer — record refund', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  test('dismissing the confirmation sends NO refund request', async ({ page }) => {
    let refundRequestSent = false;
    await page.route('**/admin/manual-transfer-payments/*/refund', async (route) => {
      refundRequestSent = true;
      await route.continue();
    });

    await page.goto('/manual-transfer');
    await page.getByPlaceholder('Payment id').fill('00000000-0000-0000-0000-000000000000');
    await page.getByPlaceholder('Amount (minor units)').fill('1000');

    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: 'Record Refund' }).click();

    expect(refundRequestSent).toBe(false);
    await expect(page.getByText('Refund recorded.')).toHaveCount(0);
  });

  test('accepting the confirmation sends the refund request and the page surfaces the real backend response', async ({ page }) => {
    await page.goto('/manual-transfer');
    await page.getByPlaceholder('Payment id').fill('00000000-0000-0000-0000-000000000000');
    await page.getByPlaceholder('Amount (minor units)').fill('1000');

    page.once('dialog', (dialog) => dialog.accept());
    const [response] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/admin/manual-transfer-payments/') && res.url().endsWith('/refund')),
      page.getByRole('button', { name: 'Record Refund' }).click(),
    ]);

    expect(response.status()).toBe(404); // "Payment not found" — the nonexistent id above
    await expect(page.getByText('Failed to record refund.').or(page.getByText(/payment not found/i))).toBeVisible();
  });
});
