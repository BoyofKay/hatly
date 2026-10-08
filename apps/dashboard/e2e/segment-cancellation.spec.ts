import { test, expect } from '@playwright/test';
import { VENDOR_A_STORAGE_STATE } from './env';
import { readFixtures } from './read-fixtures';

/**
 * M3a (Launch-Readiness Gap Audit, G-12) — the confirmation guard added
 * to the Vendor Order Detail page's own pre-existing "Cancel" segment
 * action. Uses its own dedicated fixture order (`vendorAOrders[3]`),
 * never touched by any other spec's PENDING-state assumptions.
 */
test.describe('Vendor segment cancellation — confirmation guard', () => {
  test.use({ storageState: VENDOR_A_STORAGE_STATE });

  test('dismissing the confirmation sends NO status-update request, and the segment stays PENDING', async ({ page }) => {
    const { vendorAOrders } = readFixtures();
    const order = vendorAOrders[3];

    let statusRequestSent = false;
    await page.route(`**/vendor/orders/segments/${order.segmentId}/status`, async (route) => {
      statusRequestSent = true;
      await route.continue();
    });

    await page.goto(`/orders/${order.orderId}`);
    await expect(page.getByRole('heading', { name: 'Your items — status: PENDING' })).toBeVisible();

    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: 'Cancel' }).click();

    expect(statusRequestSent).toBe(false);
    await expect(page.getByRole('heading', { name: 'Your items — status: PENDING' })).toBeVisible();
  });

  test('accepting the confirmation cancels the segment, re-fetched from the server', async ({ page }) => {
    const { vendorAOrders } = readFixtures();
    const order = vendorAOrders[3];

    await page.goto(`/orders/${order.orderId}`);
    await expect(page.getByRole('heading', { name: 'Your items — status: PENDING' })).toBeVisible();

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByRole('heading', { name: 'Your items — status: CANCELLED' })).toBeVisible();
  });
});
