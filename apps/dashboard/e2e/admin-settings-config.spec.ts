import { test, expect } from '@playwright/test';
import { SUPER_ADMIN_STORAGE_STATE } from './env';

/**
 * M3a (Launch-Readiness Gap Audit, G-28) — Operational Configuration
 * editor. Exercises one representative boolean key end-to-end over a
 * real browser + real backend + real PUT admin/business-config/:key.
 * Asserts persistence directly against the PUT response body (the
 * server's own saved row) rather than a `page.reload()` GET — Chromium
 * may serve a reload's GET from its HTTP cache, which would make a
 * reload-based assertion flaky/wrong regardless of whether the backend
 * actually persisted the value (confirmed independently: a direct
 * curl PUT-then-GET round trip against this same endpoint updates and
 * reads back correctly every time).
 */
test.describe('Admin Settings — operational configuration', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  test('the Customer OTP setting is described as first-time phone verification during registration — never as the way customers sign in', async ({ page }) => {
    await page.goto('/settings');
    const card = page.locator('div.rounded-xl.border.bg-white', { hasText: 'Customer Authentication — OTP' }).first();
    await expect(card).toContainText('verify a customer\'s phone number the first time, during registration');
    await expect(card).toContainText('customers always sign in with phone + password');
    await expect(card).not.toContainText('authenticate with OTP');
    await expect(card).not.toContainText('instead of OTP');
  });

  test('toggling Multi-Vendor Orders and saving PUTs the new value, and the server\'s own response confirms it was persisted', async ({ page }) => {
    await page.goto('/settings');
    // The specific ConfigRow wrapper (its own className) — not the deepest text match, which would
    // be the label-only div that doesn't contain the select/button at all.
    const row = page.locator('div.flex.flex-col.gap-1', { hasText: 'Multi-Vendor Orders' });
    const select = row.getByRole('combobox');
    await expect(select).toBeVisible();

    const current = await select.inputValue();
    const next = current === 'true' ? 'false' : 'true';
    await select.selectOption(next);
    // Deterministically wait for React's own re-render to settle on the new value before clicking
    // Save, rather than relying on event-dispatch ordering alone.
    await expect(select).toHaveValue(next);

    const [response] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/admin/business-config/MULTI_VENDOR_ORDERS_ENABLED') && res.request().method() === 'PUT'),
      row.getByRole('button', { name: 'Save' }).click(),
    ]);
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body.data.value).toBe(next === 'true'); // the server's own saved row, not a locally-assumed value
    await expect(row.getByText('Saved')).toBeVisible();

    // Restore the original value so this test never leaves the dev database in a flipped state for
    // whatever ran before or after it. Same settle-then-save discipline as above, and the server's saved value is
    // CHECKED: an unverified restore once left the shared dev database at MULTI_VENDOR_ORDERS_ENABLED=false, so the
    // Customer App refused every multi-vendor cart ("الطلب من أكثر من متجر غير متاح حاليًا").
    await select.selectOption(current);
    await expect(select).toHaveValue(current);
    const [restoreResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/admin/business-config/MULTI_VENDOR_ORDERS_ENABLED') && res.request().method() === 'PUT'),
      row.getByRole('button', { name: 'Save' }).click(),
    ]);
    expect(restoreResponse.ok()).toBe(true);
    expect((await restoreResponse.json()).data.value).toBe(current === 'true');
  });
});
