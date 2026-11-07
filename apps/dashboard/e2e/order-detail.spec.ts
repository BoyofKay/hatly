import { test, expect } from '@playwright/test';
import { VENDOR_A_STORAGE_STATE } from './env';
import { readFixtures } from './read-fixtures';

test.use({ storageState: VENDOR_A_STORAGE_STATE });

test.describe('Vendor order detail — critical path', () => {
  test('order list → detail navigation shows the real fixture order, then back works', async ({ page }) => {
    const { vendorAOrders } = readFixtures();
    const order = vendorAOrders[2]; // never mutated by another test — safe to just read

    await page.goto('/orders');
    await expect(page.getByRole('heading', { name: 'Incoming Orders' })).toBeVisible();

    const link = page.locator(`a[href="/orders/${order.orderId}"]`);
    await expect(link).toBeVisible();
    await link.click();

    await expect(page).toHaveURL(new RegExp(`/orders/${order.orderId}$`));
    await expect(page.getByRole('heading', { name: new RegExp(`^Order (HT-\\d+|#${order.orderId.slice(0, 8)})$`) })).toBeVisible();
    await expect(page.getByText('Your items — status: PENDING')).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/orders$/);
  });

  test('a direct URL to the order (no navigation from the list) renders correctly', async ({ page }) => {
    const { vendorAOrders } = readFixtures();
    const order = vendorAOrders[2];
    await page.goto(`/orders/${order.orderId}`);
    await expect(page.getByText('Your items — status: PENDING')).toBeVisible();
  });

  test('confirming a segment updates the UI immediately and the action set changes', async ({ page }) => {
    const { vendorAOrders } = readFixtures();
    const order = vendorAOrders[0];
    await page.goto(`/orders/${order.orderId}`);

    await expect(page.getByText('Your items — status: PENDING')).toBeVisible();
    await page.getByRole('button', { name: 'Confirm' }).click();

    await expect(page.getByText('Your items — status: CONFIRMED')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start Preparing' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm' })).toHaveCount(0);
  });

  test(
    'REGRESSION (rapid double-click protection): clicking the same action button twice in quick succession ' +
      'produces exactly ONE state change and never shows a misleading failure for an action that already succeeded',
    async ({ page }) => {
      const { vendorAOrders } = readFixtures();
      const order = vendorAOrders[1];
      await page.goto(`/orders/${order.orderId}`);

      const confirmButton = page.getByRole('button', { name: 'Confirm' });
      await expect(confirmButton).toBeEnabled();

      // A real OS-level rapid double-click on the SAME button reference — both physical click events
      // land before the first one's async network round-trip can repaint the button as disabled, the
      // authentic version of "the user double-tapped."
      await confirmButton.dblclick();

      await expect(page.getByText('Your items — status: CONFIRMED')).toBeVisible();
      await expect(page.locator('.rounded-xl.border.border-red-200')).toHaveCount(0); // no error banner ever appeared — the duplicate tap was absorbed, not surfaced as a failure
    },
  );

  test('an invalid/nonexistent order id shows a clean, recoverable error — never a crash', async ({ page }) => {
    await page.goto('/orders/00000000-0000-0000-0000-000000000000');
    // the backend's own reason (Operational Completion milestone: the page reads the real error envelope)
    await expect(page.getByText('Order not found.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  });
});
