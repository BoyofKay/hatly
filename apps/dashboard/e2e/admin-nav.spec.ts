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

  // The reference's flat menu: each page is reached by its sidebar section, then (when the section has several pages) its tab.
  const expectedLinks: Array<{ name: string; href: string; section: string }> = [
    { name: 'Sectors', href: '/sectors', section: 'Categories' },
    { name: 'Users', href: '/users', section: 'Settings' },
    { name: 'Drivers', href: '/drivers', section: 'Delivery' },
    { name: 'Settlement', href: '/settlement', section: 'Reports' },
    { name: 'Cash Remainders', href: '/cash-remainders', section: 'Delivery' },
    { name: 'Employee Loans', href: '/employee-loans', section: 'Delivery' },
    { name: 'Vehicle Types', href: '/vehicle-types', section: 'Delivery' },
    { name: 'Banners', href: '/banners', section: 'Offers' },
  ];

  for (const link of expectedLinks) {
    test(`"${link.name}" is reachable from the Admin menu (${link.section} section) and its page loads without redirecting to /login`, async ({ page }) => {
      await page.goto('/vendors');
      const section = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: link.section, exact: true });
      await section.click();
      await expect(section).toHaveAttribute('aria-current', 'page'); // the section's first page has opened before its tabs are read
      const tabs = page.getByRole('navigation', { name: 'Section pages' });
      if (await tabs.count()) await tabs.getByRole('link', { name: link.name, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${link.href}$`));
      await expect(page).not.toHaveURL(/\/login$/);
    });
  }
});
