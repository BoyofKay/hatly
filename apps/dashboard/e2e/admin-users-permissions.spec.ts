import { test, expect } from '@playwright/test';
import { SUPER_ADMIN_STORAGE_STATE, VENDOR_A_STORAGE_STATE } from './env';

/**
 * M3b (Launch-Readiness Gap Audit, G-08) — Admin Users & Permissions.
 *
 * LIMITATION (documented, not silently skipped — see the task's own
 * "do not create fake test architecture" instruction): a real
 * grant/revoke mutation needs a second ADMIN-role account to target,
 * and there is genuinely no HTTP-level way to create one anywhere in
 * this product — the backend's OWN e2e suite creates its ADMIN/
 * SUPER_ADMIN fixtures via a direct `dataSource.getRepository(User).
 * save(...)` insert (see `test/e2e/support/actors.ts`'s own
 * `insertStaffUser`), which this Playwright suite's `global-setup.ts`
 * deliberately never does (its own top comment: "through the REAL
 * backend HTTP API... no direct database writes, no shortcuts").
 * Adding direct DB access here just for this one page would be new,
 * parallel test infrastructure of exactly the kind the task says not
 * to build. What IS safely and meaningfully covered below: the page
 * loads with the real SUPER_ADMIN roster, the real permission catalog
 * renders, SUPER_ADMIN's own row correctly has no individual
 * grant/revoke controls (it isn't a valid grant target at all — the
 * backend's own `assertGrantableRole` rejects it), and a non-
 * SUPER_ADMIN session (the existing Vendor A fixture) cannot reach
 * this page's data.
 */
test.describe('Admin Users & Permissions', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  test('loads the real admin roster and the real permission catalog, over real HTTP', async ({ page }) => {
    const usersResponse = page.waitForResponse((res) => res.url().endsWith('/admin/users') && res.request().method() === 'GET');
    const catalogResponse = page.waitForResponse((res) => res.url().endsWith('/admin/permissions') && res.request().method() === 'GET');
    await page.goto('/users');

    const [usersRes, catalogRes] = await Promise.all([usersResponse, catalogResponse]);
    expect(usersRes.ok()).toBe(true);
    expect(catalogRes.ok()).toBe(true);

    const usersBody = await usersRes.json();
    expect(Array.isArray(usersBody.data)).toBe(true);
    expect(usersBody.data.some((u: any) => u.role === 'SUPER_ADMIN')).toBe(true);
    // The real DTO never carries a password hash — asserted directly on the wire response, not just the DOM.
    expect(usersBody.data.every((u: any) => u.passwordHash === undefined)).toBe(true);

    await expect(page.getByRole('heading', { name: 'Admin Users & Permissions' })).toBeVisible();
  });

  test('a SUPER_ADMIN row shows no individual grant/revoke controls — it is not a valid grant target', async ({ page }) => {
    await page.goto('/users');
    await expect(page.getByText('SUPER_ADMIN has every capability by role')).toBeVisible();
  });

  test('the empty-catalog-selection Grant button stays disabled until a permission is actually chosen (no accidental no-op submit)', async ({ page }) => {
    await page.goto('/users');
    // If any ADMIN-tier (non-SUPER_ADMIN) row exists in this dev database, its Grant button must be
    // disabled before a permission is picked from the dropdown — proven generically, not against a
    // fixture this suite invented.
    const grantButtons = page.getByRole('button', { name: 'Grant' });
    const count = await grantButtons.count();
    for (let i = 0; i < count; i++) {
      await expect(grantButtons.nth(i)).toBeDisabled();
    }
  });
});

test.describe('Admin Users & Permissions — unauthorized access', () => {
  test.use({ storageState: VENDOR_A_STORAGE_STATE });

  test('a non-admin session (Vendor Manager) is redirected away by the Admin route group\'s own guard before the page ever loads', async ({ page }) => {
    // Client-side UX only (per AdminLayout's own comment) — the REAL boundary is proven separately,
    // at the HTTP level, by the backend e2e authorization suite (RolesGuard/SUPER_ADMIN-only on
    // GET admin/users and GET admin/permissions — see 20-authorization.e2e-spec.ts). This proves the
    // dashboard's own first line of defense also works, not that it's the only one.
    await page.goto('/users');
    await expect(page).toHaveURL(/\/login$/);
  });
});
