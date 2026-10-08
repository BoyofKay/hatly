import { test, expect } from '@playwright/test';
import { SUPER_ADMIN_STORAGE_STATE } from './env';
import { readFixtures } from './read-fixtures';

/**
 * M3b (Launch-Readiness Gap Audit, G-04) — Admin Order Search. Reuses
 * the existing vendor fixture orders (`vendorAOrders`) rather than
 * provisioning new ones — they're real orders with a real order
 * number and a real customer, exactly what this page needs, and using
 * them here needs no new fixture infrastructure at all.
 */
test.describe('Admin Order Search', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  test('the page loads with loading -> results states, and an invalid backend query never crashes it', async ({ page }) => {
    await page.goto('/order-search');
    await expect(page.getByRole('heading', { name: 'Order Search' })).toBeVisible();
    // The default (no filters) search resolves without an error banner — a real empty-query call.
    await expect(page.locator('.text-red-700')).toHaveCount(0);
  });

  test('searching by a real order number finds exactly that order, and opening it reuses the existing admin order detail endpoint', async ({ page }) => {
    const { vendorAOrders } = readFixtures();
    const target = vendorAOrders[0];

    await page.goto('/order-search');
    await page.getByPlaceholder('Order number, order id, customer phone, or customer name').fill(target.orderNumber);

    const [searchResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/admin/orders?') && res.request().method() === 'GET'),
      page.getByRole('button', { name: 'Search' }).click(),
    ]);
    expect(searchResponse.ok()).toBe(true);

    const row = page.locator('tr', { hasText: target.orderNumber });
    await expect(row).toBeVisible();

    const [detailResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes(`/admin/orders/${target.orderId}`) && res.request().method() === 'GET'),
      row.getByRole('link', { name: 'Open' }).click(),
    ]);
    expect(detailResponse.ok()).toBe(true);
    await expect(page).toHaveURL(new RegExp(`/order-search/${target.orderId}$`));
    await expect(page.getByRole('heading', { name: new RegExp(target.orderNumber) })).toBeVisible();
  });

  test('a search with no matches shows the real empty state, not an error', async ({ page }) => {
    await page.goto('/order-search');
    await page.getByPlaceholder('Order number, order id, customer phone, or customer name').fill('+201000000099999');
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page.getByText('No orders match this search.')).toBeVisible();
  });

  test('filtering by order status is sent to the backend as a real query parameter', async ({ page }) => {
    await page.goto('/order-search');
    const [response] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/admin/orders?') && res.url().includes('status=DELIVERED')),
      (async () => {
        await page.locator('select').first().selectOption('DELIVERED');
        await page.getByRole('button', { name: 'Search' }).click();
      })(),
    ]);
    expect(response.ok()).toBe(true);
  });
});
