import { test, expect } from '@playwright/test';
import axios from 'axios';
import { API_BASE_URL, SUPER_ADMIN_PHONE, SUPER_ADMIN_PASSWORD, SUPER_ADMIN_STORAGE_STATE } from './env';

/**
 * M3a (Launch-Readiness Gap Audit, G-20 / G-12) — Driver Verification.
 * Provisions its own throwaway driver directly through the real,
 * pre-existing `POST admin/drivers` endpoint (the same primitive the
 * "Create Driver" form on this very page already uses) rather than
 * relying on any pre-seeded dev data, since a fresh dev database has
 * none.
 */
test.describe('Admin Driver Verification', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  async function createThrowawayDriver(): Promise<{ id: string; fullName: string }> {
    const api = axios.create({ baseURL: API_BASE_URL, validateStatus: () => true });
    const login = await api.post('/auth/password/login', { phone: SUPER_ADMIN_PHONE, password: SUPER_ADMIN_PASSWORD });
    const token = login.data.data.accessToken;
    const phone = `+20106${String(Date.now()).slice(-7)}`;
    const fullName = `Playwright Verification Driver ${Date.now()}`;
    const created = await api.post(
      '/admin/drivers',
      { fullName, phone, password: 'Playwright-Dev-1!' },
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (created.status !== 201) {
      throw new Error(`Failed to provision a throwaway driver: HTTP ${created.status} ${JSON.stringify(created.data)}`);
    }
    return { id: created.data.data.id, fullName };
  }

  test('dismissing the confirmation sends NO verification request, and the badge stays PENDING', async ({ page }) => {
    const driver = await createThrowawayDriver();
    let verifyRequestSent = false;
    await page.route(`**/admin/drivers/${driver.id}/verification`, async (route) => {
      verifyRequestSent = true;
      await route.continue();
    });

    await page.goto('/drivers');
    const row = page.locator('li', { hasText: driver.fullName });
    await expect(row).toBeVisible();
    await expect(row.getByText('PENDING')).toBeVisible();

    page.once('dialog', (dialog) => dialog.dismiss());
    await row.getByRole('button', { name: 'Approve' }).click();

    expect(verifyRequestSent).toBe(false);
    await expect(row.getByText('PENDING')).toBeVisible();
  });

  test('accepting the confirmation approves the driver, re-fetched from the server', async ({ page }) => {
    const driver = await createThrowawayDriver();

    await page.goto('/drivers');
    const row = page.locator('li', { hasText: driver.fullName });
    await expect(row).toBeVisible();

    page.once('dialog', (dialog) => dialog.accept());
    await Promise.all([
      page.waitForResponse((res) => res.url().includes(`/admin/drivers/${driver.id}/verification`) && res.ok()),
      row.getByRole('button', { name: 'Approve' }).click(),
    ]);

    await expect(row.getByText('APPROVED')).toBeVisible();
  });
});
