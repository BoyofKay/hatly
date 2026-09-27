import { test, expect } from '@playwright/test';
import { VENDOR_B_STORAGE_STATE } from './env';
import { readFixtures } from './read-fixtures';

test.use({ storageState: VENDOR_B_STORAGE_STATE });

test.describe('Vendor order isolation', () => {
  test("vendor B cannot open vendor A's order by URL — manipulating the order id is handled cleanly, never leaks the other vendor's data", async ({ page }) => {
    const { vendorAOrders } = readFixtures();
    const foreignOrder = vendorAOrders[2]; // the read-only fixture — never mutated by another spec

    await page.goto(`/orders/${foreignOrder.orderId}`);

    // Never the foreign vendor's real content.
    await expect(page.getByText('Your items — status: PENDING')).toHaveCount(0);
    await expect(page.getByText(/failed to load order/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  test("vendor B's own order list never contains vendor A's order", async ({ page }) => {
    const { vendorAOrders } = readFixtures();
    const foreignOrder = vendorAOrders[2];

    await page.goto('/orders');
    await expect(page.getByRole('heading', { name: 'Incoming Orders' })).toBeVisible();
    await expect(page.locator(`a[href="/orders/${foreignOrder.orderId}"]`)).toHaveCount(0);
  });
});
