import { test, expect } from '@playwright/test';
import { SUPER_ADMIN_STORAGE_STATE } from './env';

const HATLY_ORIGIN = 'HATLY_SERVICE_DEFAULT_PICKUP_LOCATION';
const WASALLY_DESTINATION = 'WASALLY_SERVICE_DEFAULT_DESTINATION_LOCATION';

/**
 * Hatly & Wasally default route points (PD-012): three separate defaults — Hatly origin, Hatly destination, Wasally destination (Wasally has
 * no origin default). Nothing is pre-filled; each is validated in the browser and by the backend; each can be cleared back to "not
 * configured". The test leaves the shared dev database exactly as it found it (all three cleared).
 */
test.describe('Admin Settings — Hatly & Wasally default route points', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  async function clearIfConfigured(page: import('@playwright/test').Page, key: string) {
    const status = page.getByTestId(`route-default-status-${key}`);
    await expect(status).not.toHaveText('Loading...');
    if (!(await status.textContent())?.startsWith('Not configured')) {
      page.once('dialog', (d) => d.accept());
      await page.getByTestId(`route-default-${key}`).getByRole('button', { name: 'Clear' }).click();
      await expect(status).toContainText('Not configured');
    }
  }

  test('three separate defaults, no Wasally origin; the card says exactly what is still to be entered', async ({ page }) => {
    await page.goto('/settings');
    const card = page.getByTestId('route-defaults-card');
    await expect(card).toContainText('Hatly — default origin');
    await expect(card).toContainText('Hatly — default destination');
    await expect(card).toContainText('Wasally — default destination');
    await expect(card).not.toContainText('Wasally — default origin');
    await expect(card).toContainText('never taken from the customer');
    for (const key of [HATLY_ORIGIN, WASALLY_DESTINATION]) await clearIfConfigured(page, key);
    await expect(page.getByTestId('route-defaults-missing')).toContainText('Hatly — default origin');
    await expect(page.getByTestId('route-defaults-missing')).toContainText('Wasally — default destination');
  });

  test('invalid values are refused with a reason (nothing is saved); a valid value is saved, shown as Configured, and can be cleared', async ({ page }) => {
    await page.goto('/settings');
    const row = page.getByTestId(`route-default-${HATLY_ORIGIN}`);
    await clearIfConfigured(page, HATLY_ORIGIN);

    await page.getByTestId(`route-default-lat-${HATLY_ORIGIN}`).fill('48.85');
    await page.getByTestId(`route-default-lng-${HATLY_ORIGIN}`).fill('2.35');
    await page.getByTestId(`route-default-label-${HATLY_ORIGIN}`).fill('Not in Egypt');
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(row.getByRole('alert')).toContainText('Latitude must be between');
    await expect(page.getByTestId(`route-default-status-${HATLY_ORIGIN}`)).toContainText('Not configured');

    await page.getByTestId(`route-default-label-${HATLY_ORIGIN}`).fill('');
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(row.getByRole('alert')).toContainText('label');

    // A syntactically valid, clearly-fixture point (the centre of the Belbeis service area used by the dev seed).
    await page.getByTestId(`route-default-lat-${HATLY_ORIGIN}`).fill('30.4181');
    await page.getByTestId(`route-default-lng-${HATLY_ORIGIN}`).fill('31.5622');
    await page.getByTestId(`route-default-label-${HATLY_ORIGIN}`).fill('E2E fixture point');
    const [saved] = await Promise.all([
      page.waitForResponse((r) => r.url().includes(`/admin/business-config/${HATLY_ORIGIN}`) && r.request().method() === 'PUT'),
      row.getByRole('button', { name: 'Save' }).click(),
    ]);
    expect(saved.ok()).toBe(true);
    expect((await saved.json()).data.value).toEqual({ latitude: 30.4181, longitude: 31.5622, label: 'E2E fixture point' });
    await expect(page.getByTestId(`route-default-status-${HATLY_ORIGIN}`)).toHaveText('Configured');

    // Leave the shared dev database as found.
    page.once('dialog', (d) => d.accept());
    const [cleared] = await Promise.all([
      page.waitForResponse((r) => r.url().includes(`/admin/business-config/${HATLY_ORIGIN}`) && r.request().method() === 'DELETE'),
      row.getByRole('button', { name: 'Clear' }).click(),
    ]);
    expect(cleared.ok()).toBe(true);
    await expect(page.getByTestId(`route-default-status-${HATLY_ORIGIN}`)).toContainText('Not configured');
  });

  test('the multiplier is described as applying to BOTH Hatly and Wasally', async ({ page }) => {
    await page.goto('/settings');
    const row = page.locator('div.flex.flex-col.gap-1', { hasText: 'Hatly & Wasally Delivery Fee Multiplier' });
    await expect(row).toContainText('Applies to BOTH Hatly and Wasally');
  });
});
