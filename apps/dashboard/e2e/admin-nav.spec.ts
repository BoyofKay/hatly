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
  // Owner order 2026-11-22: Home, Orders, Delivery, Customers, Stores, Products, Offers, Reports, Settings. `sub` = the shared tab the page
  // sits under (its pages are a second row of tabs).
  const expectedLinks: Array<{ name: string; href: string; section: string; more?: boolean; sub?: string }> = [
    { name: 'Sectors', href: '/sectors', section: 'Settings' },
    { name: 'Service Areas', href: '/service-areas', section: 'Settings' },
    { name: 'Delivery Zones', href: '/delivery-zones', section: 'Settings' },
    { name: 'Vehicle Types', href: '/vehicle-types', section: 'Settings' },
    { name: 'Staff & permissions', href: '/users', section: 'Settings', sub: 'Users' },
    { name: 'Drivers', href: '/drivers', section: 'Settings', sub: 'Users' },
    { name: 'Stores now', href: '/stores-now', section: 'Orders' },
    { name: 'Control Tower', href: '/control-tower', section: 'Orders', more: true },
    { name: 'Alerts', href: '/alerts', section: 'Orders', more: true },
    { name: 'Drivers today', href: '/drivers-today', section: 'Delivery' },
    { name: 'Closing', href: '/settlement', section: 'Delivery', sub: 'Settlements' },
    { name: 'Statements by period', href: '/settlement-statements', section: 'Delivery', sub: 'Settlements' },
    { name: 'Settlement history', href: '/settlements', section: 'Delivery', sub: 'Settlements' },
    { name: 'Cash Remainders', href: '/cash-remainders', section: 'Delivery' },
    { name: 'Employee Loans', href: '/employee-loans', section: 'Delivery' },
    { name: 'Banners', href: '/banners', section: 'Offers' },
  ];

  test('the sidebar is in the owner\'s order', async ({ page }) => {
    await page.goto('/home');
    const names = await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link').allInnerTexts();
    const order = ['Home', 'Orders', 'Delivery', 'Customers', 'Stores', 'Products', 'Offers', 'Reports', 'Settings'];
    const seen = names.map((n) => n.trim().replace(/\s*\d+$/, '')).filter((n) => order.includes(n));
    expect(seen).toEqual(order);
  });

  for (const link of expectedLinks) {
    test(`"${link.name}" is reachable from the Admin menu (${link.section} section) and its page loads without redirecting to /login`, async ({ page }) => {
      await page.goto('/vendors');
      const section = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: link.section, exact: true });
      await section.click();
      await expect(section).toHaveAttribute('aria-current', 'page'); // the section's first page has opened before its tabs are read
      const tabs = page.getByRole('navigation', { name: 'Section pages' });
      if (await tabs.count()) {
        // a tab with work waiting carries its count in its name ("Stores now 3")
        const tab = tabs.getByRole('link', { name: new RegExp(`^${link.name}( \\d+)?$`) });
        if (link.sub) {
          await tabs.getByRole('link', { name: link.sub, exact: true }).click();
          const subTabs = page.getByRole('navigation', { name: 'Section sub-pages' });
          await subTabs.getByRole('link', { name: link.name, exact: true }).click();
        } else {
          if (link.more) await tabs.getByTestId('section-tabs-more').click(); // stage 5: less-used pages sit under "More"
          await tab.click();
        }
      }
      await expect(page).toHaveURL(new RegExp(`${link.href}$`));
      await expect(page).not.toHaveURL(/\/login$/);
    });
  }
});
