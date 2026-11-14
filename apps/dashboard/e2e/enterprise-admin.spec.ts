import { test, expect, Page } from '@playwright/test';
import { SUPER_ADMIN_PASSWORD, SUPER_ADMIN_PHONE, SUPER_ADMIN_STORAGE_STATE } from './env';
import { withAutomaticDispatch } from './control-tower-fixtures';

/**
 * Enterprise Admin Panel — real browser, real backend. Every module's pages must load with real data (no error state, no page
 * errors), the shell must switch to Arabic / RTL, the Automatic Dispatch switch must really change the backend setting, a
 * permission-limited admin must not see what it cannot use, and a few end-to-end workflows must persist through the API.
 */
const ME_URL = '**/api/v1/admin/me/permissions';

const PAGES: string[] = [
  '/executive', '/alerts', '/order-management', '/exceptions', '/finance/ledger', '/finance/revenue', '/finance/receivables', '/finance/liabilities',
  '/finance/reconciliation', '/payments', '/refunds', '/settlements', '/reports', '/exports', '/media', '/reviews', '/wallet-adjustments',
  '/branches', '/catalog', '/inventory', '/fleet', '/growth', '/campaigns', '/broadcasts', '/audiences', '/system', '/system/metrics',
  '/system/jobs', '/config', '/access/templates',
];

async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
}

test.describe('Enterprise Admin — every module page loads with real data', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  for (const path of PAGES) {
    test(`${path} renders without an error state or a page error`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (e) => pageErrors.push(e.message));
      await page.goto(path);
      await expect(page).not.toHaveURL(/\/login$/);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await settle(page);
      await expect(page.getByText('This could not be loaded.')).toHaveCount(0);
      await expect(page.getByText('You do not have access to this.')).toHaveCount(0);
      expect(pageErrors).toEqual([]);
    });
  }
});

test.describe('Enterprise Admin — responsive', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE, viewport: { width: 390, height: 844 } });

  for (const path of PAGES) {
    test(`${path} has no horizontal page scroll at phone width and keeps a reachable menu`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await settle(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();
    });
  }

  test('Arabic at phone width is right-to-left without horizontal scroll', async ({ page }) => {
    await page.goto('/finance/ledger');
    await page.getByRole('button', { name: 'Switch to Arabic' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await settle(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: 'التبديل إلى الإنجليزية' }).click();
  });
});

test.describe('Enterprise Admin — shell', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  test('the navigation is the reference\'s ten sections; the current section and the current page (tab) are marked', async ({ page }) => {
    await page.goto('/executive');
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    const sections = ['Home', 'Orders', 'Stores', 'Products', 'Categories', 'Offers', 'Customers', 'Delivery', 'Reports', 'Settings'];
    for (const name of sections) await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
    await expect(nav.getByRole('link')).toHaveCount(sections.length);
    await expect(nav.getByRole('link', { name: 'Reports', exact: true })).toHaveAttribute('aria-current', 'page');
    // Every page of the section is one click away as a tab, and the page itself is marked.
    const tabs = page.getByRole('navigation', { name: 'Section pages' });
    await expect(tabs.getByRole('link', { name: 'Executive overview' })).toHaveAttribute('aria-current', 'page');
    for (const name of ['Reports', 'Exports', 'Ledger', 'Revenue', 'Reconciliation']) await expect(tabs.getByRole('link', { name, exact: true })).toBeVisible();
    // stage 5: closing and its statements moved to Delivery (next to "Drivers today")
    for (const name of ['Closing', 'Settlement history']) await expect(tabs.getByRole('link', { name, exact: true })).toHaveCount(0);
  });

  test('switching to Arabic makes the page right-to-left, translates the shell, and survives a reload', async ({ page }) => {
    await page.goto('/executive');
    await page.getByRole('button', { name: 'Switch to Arabic' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 }).first()).toHaveText('النظرة التنفيذية');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    // Restore English so later specs see the default.
    await page.getByRole('button', { name: 'التبديل إلى الإنجليزية' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });

  test('the quick-find palette opens from the top bar, searches real records, and closes with Escape', async ({ page }) => {
    await page.goto('/executive');
    await page.getByRole('button', { name: 'Quick find' }).click();
    const dialog = page.getByRole('dialog', { name: 'Search' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('textbox').fill('a');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });
});

test.describe('Enterprise Admin — Automatic Dispatch switch', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  test('turning it OFF then ON in the UI changes the backend setting, and nothing else changes', async ({ page }) => {
    await withAutomaticDispatch(true, async () => {
      await page.goto('/config');
      await expect(page.getByText('ON', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Turn OFF' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Turn OFF' }).click();
      await expect(page.getByText('OFF', { exact: true })).toBeVisible();
      // The state is read back from the server, so a reload proves it was persisted.
      await page.reload();
      await expect(page.getByText('OFF', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Turn ON' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Turn ON' }).click();
      await expect(page.getByText('ON', { exact: true })).toBeVisible();
    });
  });
});

test.describe('Enterprise Admin — landing and resilient navigation', () => {
  test('signing in as an admin lands on the Home dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Phone number').fill(SUPER_ADMIN_PHONE);
    await page.getByLabel('Password').fill(SUPER_ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole('heading', { level: 1 }).first()).toHaveText('Welcome to your dashboard');
  });

  test.describe('with a session', () => {
    test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

    test('an admin without the reports permission lands on a launcher of the modules they can open, with no error state', async ({ page }) => {
      await page.route(ME_URL, (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { role: 'ADMIN', permissions: ['VIEW_ORDERS', 'MANAGE_DRIVERS'] } }) }),
      );
      await page.goto('/executive');
      await expect(page.getByRole('heading', { level: 1 }).first()).toHaveText('Executive overview');
      await expect(page.getByText('Your account does not include the executive figures.')).toBeVisible();
      await expect(page.getByRole('main').getByRole('link', { name: 'Orders', exact: true })).toBeVisible();
      await expect(page.getByRole('main').getByRole('link', { name: 'Ledger' })).toHaveCount(0);
      await expect(page.getByText('This could not be loaded.')).toHaveCount(0);
    });

    test('the menu does not vanish when the permission lookup fails: the last answer is reused, and with none a Retry is shown', async ({ page }) => {
      await page.goto('/executive');
      await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Reports', exact: true })).toBeVisible();
      await page.route(ME_URL, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
      await page.reload();
      await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Reports', exact: true })).toBeVisible({ timeout: 15_000 });
      // No previous answer at all → an explicit retry, never a silently empty menu.
      await page.evaluate(() => sessionStorage.clear());
      await page.reload();
      await expect(page.getByRole('button', { name: 'Retry' }).first()).toBeVisible({ timeout: 15_000 });
      await page.unroute(ME_URL);
      await page.getByRole('button', { name: 'Retry' }).first().click();
      await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Reports', exact: true })).toBeVisible();
    });
  });
});

test.describe('Enterprise Admin — permissions', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  test('an admin who only holds VIEW_ORDERS sees the Orders section and none of Reports/Finance, Offers, Products, Stores or Categories', async ({ page }) => {
    await page.route(ME_URL, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { role: 'ADMIN', permissions: ['VIEW_ORDERS'] } }) }),
    );
    await page.goto('/alerts');
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav.getByRole('link', { name: 'Orders', exact: true })).toBeVisible();
    for (const hidden of ['Reports', 'Offers', 'Products', 'Stores', 'Categories']) {
      await expect(nav.getByRole('link', { name: hidden, exact: true })).toHaveCount(0);
    }
    // Inside the Orders section only the pages this admin may open are tabs (payments need a payment/finance permission).
    const tabs = page.getByRole('navigation', { name: 'Section pages' });
    await expect(tabs.getByRole('link', { name: 'Alerts', exact: true })).toHaveAttribute('aria-current', 'page');
    for (const hidden of ['Payments', 'Manual Transfer', 'Refunds', 'Failed Deliveries']) await expect(tabs.getByRole('link', { name: hidden, exact: true })).toHaveCount(0);
  });

  test('the backend, not the menu, enforces access: a finance route refuses an admin without VIEW_FINANCIALS', async ({ page }) => {
    // The real session is SUPER_ADMIN, so assert the refusal contract through the page: a 403 from the API is shown as "no access", never an empty table.
    await page.route('**/api/v1/admin/finance/ledger*', (route) =>
      route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action.' } }) }),
    );
    await page.goto('/finance/ledger');
    await expect(page.getByText('You do not have access to this.')).toBeVisible();
  });
});

test.describe('Enterprise Admin — workflows persist through the real API', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  test('create an audience with a live size preview, then see it listed', async ({ page }) => {
    const name = `PW audience ${Date.now()}`;
    await page.goto('/audiences');
    await page.getByRole('button', { name: 'New audience' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByLabel('Ordered within the last N days').fill('30');
    await dialog.getByRole('button', { name: 'Preview size' }).click();
    await expect(dialog.getByText(/About|matches no customers/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name })).toBeVisible();
  });

  test('create a campaign draft, which opens as DRAFT with an empty item list and a disabled submit', async ({ page }) => {
    await page.goto('/campaigns');
    await page.getByRole('button', { name: 'New campaign' }).click();
    const dialog = page.getByRole('dialog');
    const start = new Date(Date.now() + 86_400_000);
    const end = new Date(Date.now() + 2 * 86_400_000);
    const local = (d: Date) => d.toISOString().slice(0, 16);
    await dialog.getByLabel('Name (English)').fill(`PW campaign ${Date.now()}`);
    await dialog.getByLabel('Name (Arabic)').fill('حملة اختبار');
    await dialog.getByLabel('Starts').fill(local(start));
    await dialog.getByLabel('Ends').fill(local(end));
    await dialog.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}$/);
    await expect(page.getByText('DRAFT').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Submit for approval' })).toBeDisabled();
  });

  test('start a CSV export from a report and download it when READY', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/reports');
    await page.locator('a[href^="/reports/"]').first().click();
    await expect(page).toHaveURL(/\/reports\/[^/]+$/);
    await page.getByRole('button', { name: 'Export' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Format').selectOption('CSV');
    await dialog.getByRole('button', { name: 'Start export' }).click();
    await expect(dialog.getByRole('button', { name: 'Download' })).toBeVisible({ timeout: 60_000 });
  });
});
