import { test, expect } from '@playwright/test';
import { SUPER_ADMIN_STORAGE_STATE } from './env';

/**
 * M3a (Launch-Readiness Gap Audit, G-26) — Dispatch Alerts, now part of the Control Tower (Control Tower milestone). The real dev
 * database may or may not hold alerts, so this asserts the section LOADS (open-only by default, then all) — never stuck on
 * "Loading..." — and that every listed alert names its order by number, not by internal id.
 */
test.describe('Admin Dispatch — alerts', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  test('the Dispatch alerts section loads (open only, then all) and identifies orders by number', async ({ page }) => {
    await page.goto('/control-tower');
    const section = page.getByTestId('ct-alerts');
    await expect(section.getByRole('heading', { name: 'Dispatch alerts' })).toBeVisible();
    await expect(section.getByTestId('ct-alerts-empty').or(section.locator('li').first())).toBeVisible();
    await expect(section.getByText('Loading...')).toHaveCount(0);

    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/admin/dispatch-alerts') && !r.url().includes('open=') && r.ok()),
      section.getByLabel('Open only').uncheck(),
    ]);
    const alerts = (await res.json()).data as Array<{ orderNumber: string | null }>;
    for (const alert of alerts.slice(0, 5)) {
      // an order can carry several alerts over time, so its number may be linked more than once
      if (alert.orderNumber) await expect(section.getByRole('link', { name: alert.orderNumber }).first()).toBeVisible();
    }
    if (alerts.length === 0) await expect(section.getByTestId('ct-alerts-empty')).toHaveText('No dispatch alerts.');
  });
});
