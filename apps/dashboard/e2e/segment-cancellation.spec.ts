import { test, expect } from '@playwright/test';
import { VENDOR_A_STORAGE_STATE } from './env';
import { readFixtures } from './read-fixtures';

/**
 * Rejecting (cancelling) a vendor segment needs a reason: the Vendor Order Detail page collects it in an inline form (no bare confirm),
 * refuses to send an empty one, lets the vendor back out without sending anything, and shows the recorded reason in the segment history.
 * Uses its own dedicated fixture order (`vendorAOrders[3]`), never touched by any other spec's PENDING-state assumptions.
 */
test.describe('Vendor segment rejection — required reason', () => {
  test.use({ storageState: VENDOR_A_STORAGE_STATE });

  test('an empty reason sends NO status-update request; backing out keeps the segment PENDING', async ({ page }) => {
    const { vendorAOrders } = readFixtures();
    const order = vendorAOrders[3];

    let statusRequestSent = false;
    await page.route(`**/vendor/orders/segments/${order.segmentId}/status`, async (route) => {
      statusRequestSent = true;
      await route.continue();
    });

    await page.goto(`/orders/${order.orderId}`);
    await expect(page.getByRole('heading', { name: 'Your items — status: PENDING' })).toBeVisible();

    await page.getByTestId('vendor-segment-action-CANCELLED').click();
    await expect(page.getByTestId('vendor-reject-form')).toBeVisible();
    await page.getByTestId('vendor-reject-confirm').click();
    await expect(page.getByText('Enter the reason for rejecting this order.')).toBeVisible();
    expect(statusRequestSent).toBe(false);

    await page.getByRole('button', { name: 'Keep order' }).click();
    await expect(page.getByTestId('vendor-reject-form')).toBeHidden();
    expect(statusRequestSent).toBe(false);
    await expect(page.getByRole('heading', { name: 'Your items — status: PENDING' })).toBeVisible();
  });

  test('rejecting with a reason cancels the segment, re-fetched from the server, and the history shows the reason', async ({ page }) => {
    const { vendorAOrders } = readFixtures();
    const order = vendorAOrders[3];

    await page.goto(`/orders/${order.orderId}`);
    await expect(page.getByRole('heading', { name: 'Your items — status: PENDING' })).toBeVisible();

    await page.getByTestId('vendor-segment-action-CANCELLED').click();
    await page.getByTestId('vendor-reject-reason').fill('Out of stock today');
    await page.getByTestId('vendor-reject-confirm').click();

    await expect(page.getByRole('heading', { name: 'Your items — status: CANCELLED' })).toBeVisible();
    await expect(page.getByTestId('vendor-segment-history')).toContainText('Out of stock today');
  });
});
