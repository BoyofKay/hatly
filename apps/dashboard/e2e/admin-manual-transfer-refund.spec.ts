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

  // Since the Admin UX release the refund form starts from the order number the admin reads (HT-…), never an internal payment id.
  test('an unknown order number is refused and NO refund request is sent', async ({ page }) => {
    let refundRequestSent = false;
    await page.route('**/admin/manual-transfer-payments/*/refund', async (route) => {
      refundRequestSent = true;
      await route.continue();
    });

    await page.goto('/manual-transfer');
    await page.getByPlaceholder('HT-100234').fill('HT-000000001');
    await page.getByTestId('refund-find').click();
    await expect(page.getByText(/No Manual Transfer payment was found/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record Refund' })).toBeDisabled();

    expect(refundRequestSent).toBe(false);
    await expect(page.getByText('Refund recorded.')).toHaveCount(0);
  });
});
