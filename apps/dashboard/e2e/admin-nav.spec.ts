import { test, expect } from '@playwright/test';
import { SUPER_ADMIN_STORAGE_STATE } from './env';

/**
 * M3a (Launch-Readiness Gap Audit, G-30) — Admin navigation
 * discoverability. Verifies every M3a page (plus the pre-existing
 * `/users`/`/drivers`, which the audit found were built but never
 * linked from the nav) is reachable from the Admin header nav, over a
 * real browser, as a real SUPER_ADMIN session.
 */
test.describe('Admin navigation', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  const expectedLinks: Array<{ name: string; href: string }> = [
    { name: 'Users', href: '/users' },
    { name: 'Drivers', href: '/drivers' },
    { name: 'Settlement', href: '/settlement' },
    { name: 'Cash Remainders', href: '/cash-remainders' },
    { name: 'Employee Loans', href: '/employee-loans' },
    { name: 'Vehicle Types', href: '/vehicle-types' },
  ];

  for (const link of expectedLinks) {
    test(`"${link.name}" is reachable from the Admin nav and its page loads without redirecting to /login`, async ({ page }) => {
      await page.goto('/vendors');
      await page.getByRole('link', { name: link.name, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${link.href}$`));
      await expect(page).not.toHaveURL(/\/login$/);
    });
  }
});
