import { test, expect } from '@playwright/test';
import { SUPER_ADMIN_STORAGE_STATE } from './env';

/**
 * Admin Sectors — the per-sector "custom requests" switch ("لا تجد ما تبحث عنه؟"), in a real browser against the REAL dev
 * backend/database. The toggle writes through `PATCH /admin/sectors/:id` and the test puts the sector back as it found it. The
 * only intercepted response is the permission lookup (an ADMIN without MANAGE_MARKETPLACE_SECTORS cannot be produced by a
 * SUPER_ADMIN session); the backend e2e suite (test/e2e/89-sector-custom-requests) proves the real 403s and the enforcement.
 */
const ME_URL = /\/admin\/me\/permissions$/;

test.describe('Admin — Sectors', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  test('lists sectors with the custom-requests switch; restaurants are off by default', async ({ page }) => {
    await page.goto('/sectors');
    await expect(page.getByRole('heading', { name: 'Sectors' })).toBeVisible();
    await expect(page.getByTestId('sectors-rule')).toContainText('off for every new sector');
    const table = page.getByTestId('sectors-table');
    await expect(table).toBeVisible();
    const restaurants = table.getByRole('row').filter({ hasText: 'restaurants' }).first();
    await expect(restaurants.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  test('three-dot actions do not expand the table row and dismiss with Escape', async ({ page }) => {
    await page.goto('/sectors');
    const row = page.getByTestId('sectors-table').locator('tbody tr').first();
    const trigger = row.getByRole('button', { name: 'More actions' });
    await expect(trigger).toBeVisible();
    const before = await row.boundingBox();
    await trigger.click();
    const menu = page.getByTestId('sector-actions-popover');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('button', { name: /^(Activate|Deactivate)$/ })).toBeVisible();
    expect((await row.boundingBox())?.height).toBe(before?.height);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('toggling a sector persists through the real API (on, reload, off)', async ({ page }) => {
    await page.goto('/sectors');
    const row = page.getByTestId('sectors-table').getByRole('row').filter({ hasText: 'bakery' }).first();
    const toggle = row.getByRole('switch');
    const before = (await toggle.getAttribute('aria-checked')) === 'true';
    try {
      const [res] = await Promise.all([
        page.waitForResponse((r) => /\/admin\/sectors\/[^/]+$/.test(r.url()) && r.request().method() === 'PATCH'),
        toggle.click(),
      ]);
      expect(res.status()).toBe(200);
      expect(res.request().postDataJSON()).toEqual({ customRequestsEnabled: !before });
      await expect(toggle).toHaveAttribute('aria-checked', String(!before));
      await page.reload();
      const again = page.getByTestId('sectors-table').getByRole('row').filter({ hasText: 'bakery' }).first().getByRole('switch');
      await expect(again).toHaveAttribute('aria-checked', String(!before));
    } finally {
      const now = page.getByTestId('sectors-table').getByRole('row').filter({ hasText: 'bakery' }).first().getByRole('switch');
      if ((await now.getAttribute('aria-checked')) === String(!before)) await now.click();
      await expect(now).toHaveAttribute('aria-checked', String(before));
    }
  });

  test('an admin without MANAGE_MARKETPLACE_SECTORS sees the switches disabled', async ({ page }) => {
    await page.route(ME_URL, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { role: 'ADMIN', permissions: ['VIEW_ORDERS'] } }) }));
    await page.goto('/sectors');
    const first = page.getByTestId('sectors-table').getByRole('switch').first();
    await expect(first).toBeDisabled();
  });
});

// Sector artwork is now managed together in the Assets panel.
