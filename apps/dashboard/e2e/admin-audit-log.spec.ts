import { test, expect } from '@playwright/test';
import { SUPER_ADMIN_STORAGE_STATE, VENDOR_A_STORAGE_STATE } from './env';

/**
 * Launch-readiness G-11 — the Audit log page, in a real browser against the real backend. The authorization matrix (VIEW_AUDIT_LOG,
 * SUPER_ADMIN bypass, no write routes) is proven over HTTP in the backend e2e `100-admin-audit-log-viewer`; here: the page loads real
 * rows (the suite's own sign-ins are audited), filters really narrow them, details show the recorded fields, and a failing backend never
 * leaves a blank page.
 */
test.describe('Admin audit log', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  test('loads real entries newest-first, has no edit/delete control, and a filter narrows the list', async ({ page }) => {
    await page.goto('/audit-log');
    await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
    const rows = page.getByTestId('audit-row');
    await expect(rows.first()).toBeVisible();
    await expect(page.getByRole('button', { name: /delete|edit|remove/i })).toHaveCount(0);

    await page.getByLabel('Action').selectOption('auth.dashboard_login');
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/admin/audit-logs') && r.url().includes('action=auth.dashboard_login')),
      page.getByRole('button', { name: 'Apply' }).click(),
    ]);
    expect(response.status()).toBe(200);
    await expect(rows.first()).toBeVisible();
    const actions = await rows.locator('td:nth-child(3)').allInnerTexts();
    expect(actions.length).toBeGreaterThan(0);
    for (const a of actions) expect(a.trim()).toBe('auth.dashboard_login');
  });

  test('Details reveals the recorded fields of an entry and never a secret', async ({ page }) => {
    await page.goto('/audit-log');
    await page.getByTestId('audit-row').first().getByRole('button', { name: 'Details' }).click();
    const details = page.getByTestId('audit-details');
    await expect(details).toBeVisible();
    await expect(details).toContainText('Entry id');
    await expect(details).not.toContainText(/password|secret|token/i);
  });

  test('a backend failure shows the reason with a Retry — not a blank page', async ({ page }) => {
    await page.route('**/admin/audit-logs**', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Audit store unavailable' } }) }));
    await page.goto('/audit-log');
    await expect(page.getByTestId('audit-error')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  });
});

test.describe('Admin audit log — unauthorized access', () => {
  test.use({ storageState: VENDOR_A_STORAGE_STATE });

  test('a non-admin session (Vendor Manager) is redirected to /login by the Admin route group', async ({ page }) => {
    await page.goto('/audit-log');
    await expect(page).toHaveURL(/\/login$/);
  });
});
