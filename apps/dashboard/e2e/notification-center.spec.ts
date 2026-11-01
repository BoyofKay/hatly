import { test, expect } from '@playwright/test';
import { SUPER_ADMIN_STORAGE_STATE, VENDOR_A_STORAGE_STATE, VENDOR_B_STORAGE_STATE } from './env';
import { cancelTestOrder, placeNewOrder, vendorApi } from './control-tower-fixtures';

/**
 * The Notification Center of Vendor and Admin staff over the real backend: a real order creates the vendor's "New order" notification (it
 * appears without a reload), the unread count equals the server's, opening it marks it read and goes to the vendor's own order, mark-all
 * clears the count, another vendor never sees it, and the Admin center lists, filters and shows the preferences (critical locked).
 */
const unreadOf = async () => (await vendorApi().get('/staff/notifications/unread-count')).data.data.unreadCount as number;

test.describe('Vendor — Notification Center', () => {
  test.use({ storageState: VENDOR_A_STORAGE_STATE });

  test('a new order appears live as an unread "New order"; opening it marks it read and opens the order; mark all clears the count', async ({ page }) => {
    await page.goto('/notifications');
    await expect(page.getByTestId('notification-center')).toBeVisible();
    const order = await placeNewOrder();
    try {
      const row = page.getByTestId('notification-list').locator('li', { hasText: order.orderNumber });
      await expect(row).toBeVisible({ timeout: 30_000 }); // via the change feed, no reload
      await expect(row).toContainText('New order');
      await expect(row).toHaveAttribute('data-read', 'false');
      await expect(page.getByTestId('notifications-unread-value')).toHaveText(String(await unreadOf()));

      await row.getByRole('button').first().click();
      await expect(page).toHaveURL(new RegExp(`/orders/${order.orderId}$`));
      const list = (await vendorApi().get('/staff/notifications', { params: { limit: 100 } })).data.data as any[];
      expect(list.find((n) => n.orderId === order.orderId && n.category === 'VENDOR_NEW_ORDER')?.isRead).toBe(true);

      await page.goto('/notifications');
      await page.getByTestId('notifications-read-all').click();
      await expect(page.getByTestId('notifications-unread-value')).toHaveText('0');
      expect(await unreadOf()).toBe(0);
    } finally {
      await cancelTestOrder(order).catch(() => undefined);
    }
  });

  test('the bell leads to the full Notification Center', async ({ page }) => {
    await page.goto('/overview');
    await page.getByTestId('staff-alerts-bell').click();
    await page.getByTestId('staff-alerts-view-all').click();
    await expect(page).toHaveURL(/\/notifications$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Notifications');
  });
});

test.describe('Vendor isolation', () => {
  test.use({ storageState: VENDOR_B_STORAGE_STATE });

  test('another vendor never sees vendor A\'s notifications', async ({ page }) => {
    const order = await placeNewOrder(); // vendor A's product
    try {
      await page.goto('/notifications');
      await expect(page.getByTestId('notification-center')).toBeVisible();
      await page.waitForLoadState('networkidle');
      await expect(page.getByTestId('notification-list')).not.toContainText(order.orderNumber);
    } finally {
      await cancelTestOrder(order).catch(() => undefined);
    }
  });
});

test.describe('Admin — Notification Center', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  test('the Orders section has a Notifications tab; unread filter, mark read and settings (critical alerts locked) work', async ({ page }) => {
    await page.goto('/inbox');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Notifications');
    await expect(page.getByTestId('nav-section-orders')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('navigation', { name: 'Section pages' }).getByRole('link', { name: 'Notifications', exact: true })).toHaveAttribute('aria-current', 'page');

    await page.getByRole('tab', { name: /^Unread/ }).click();
    const rows = page.getByTestId('notification-list').locator('li');
    if (await rows.count()) {
      await expect(rows.first()).toHaveAttribute('data-read', 'false');
      const before = Number(await page.getByTestId('notifications-unread-value').innerText());
      await rows.first().getByRole('button', { name: 'Mark read' }).click();
      await expect(page.getByTestId('notifications-unread-value')).toHaveText(String(before - 1));
    }

    await page.getByRole('tab', { name: 'Settings' }).click();
    await expect(page.getByTestId('pref-OPS_FAILED_DELIVERY-inapp')).toBeDisabled(); // critical
    await expect(page.getByTestId('pref-OPS_FAILED_DELIVERY-inapp')).toBeChecked();
    await expect(page.getByTestId('pref-OPS_DISPATCH_NEEDED-inapp')).toBeEnabled();
  });
});
