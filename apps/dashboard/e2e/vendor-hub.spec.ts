import { test, expect } from '@playwright/test';
import { SUPER_ADMIN_STORAGE_STATE, VENDOR_A_BRANCH_ID, VENDOR_A_STORAGE_STATE } from './env';
import { cancelTestOrder, placeNewOrder, vendorApi } from './control-tower-fixtures';

/**
 * The Vendor Business Hub in a real browser against the real backend: Arabic-first and right-to-left by default, every hub page renders real data
 * without an error state, the branch open/closed switch and the weekly hours really change the backend, history search finds an order, and
 * the Admin has exactly ONE language control.
 */
const HUB_PAGES: Array<[string, RegExp]> = [
  ['/overview', /Welcome/],
  ['/orders', /Incoming Orders/],
  ['/order-history', /Order history/],
  ['/products', /Products/],
  ['/stock', /Stock/],
  ['/my-branches', /My branches/],
  ['/earnings', /Earnings/],
  ['/insights', /Insights/],
  ['/team', /Team/],
  ['/notifications', /Notifications/],
];

test.describe('Vendor Business Hub', () => {
  test.setTimeout(90_000);
  test.use({ storageState: VENDOR_A_STORAGE_STATE });

  test('every hub page renders its heading with real data and no error state', async ({ page }) => {
    for (const [path, heading] of HUB_PAGES) {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveCount(0); // an error state, not Next's route announcer
      expect(errors, `${path} threw`).toEqual([]);
      page.removeAllListeners('pageerror');
    }
  });

  test('it is Arabic-first and right-to-left until the person chooses English, and the choice is remembered', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: VENDOR_A_STORAGE_STATE, viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('seen')) { localStorage.removeItem('hatly_dashboard_locale'); sessionStorage.setItem('seen', '1'); } } catch { /* storage unavailable */ } });
    const page = await ctx.newPage();
    try {
      await page.goto('/overview');
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByRole('heading', { level: 1, name: /مرحباً بك/ })).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
      await page.getByRole('button', { name: 'فتح القائمة' }).click();
      await expect(page.getByRole('link', { name: /الطلبات/ }).first()).toBeVisible();
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'التبديل إلى الإنجليزية' }).click();
      await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
      await expect(page.getByRole('heading', { level: 1, name: /^Welcome/ })).toBeVisible();
      await page.reload();
      await expect(page.getByRole('heading', { level: 1, name: /^Welcome/ })).toBeVisible(); // remembered
    } finally {
      await ctx.close();
    }
  });

  test('the branch switch and the weekly hours change the backend (and are undone)', async ({ page }) => {
    const before = (await vendorApi().get(`/vendor/branches/${VENDOR_A_BRANCH_ID}`)).data.data;
    try {
      await page.goto('/my-branches');
      await expect(page.getByRole('heading', { level: 1, name: 'My branches' })).toBeVisible();
      const sw = page.getByRole('switch').first();
      const was = (await sw.getAttribute('aria-checked')) === 'true';
      await sw.click();
      await expect.poll(async () => (await vendorApi().get(`/vendor/branches/${VENDOR_A_BRANCH_ID}`)).data.data.isOpen).toBe(!was);
      await sw.click();
      await expect.poll(async () => (await vendorApi().get(`/vendor/branches/${VENDOR_A_BRANCH_ID}`)).data.data.isOpen).toBe(was);

      // The manager edits Monday's hours and the preparation time.
      const hours = page.getByTestId(`hours-${VENDOR_A_BRANCH_ID}`);
      await hours.getByLabel('Monday opens').fill('08:30');
      await hours.getByLabel('Monday closes').fill('21:45');
      await page.getByLabel('Preparation time (minutes)').fill('35');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect.poll(async () => (await vendorApi().get(`/vendor/branches/${VENDOR_A_BRANCH_ID}`)).data.data).toMatchObject({ preparationTimeMinutes: 35, openingHours: { mon: { open: '08:30', close: '21:45' } } });
    } finally {
      await vendorApi().patch(`/vendor/branches/${VENDOR_A_BRANCH_ID}`, { openingHours: before.openingHours, preparationTimeMinutes: before.preparationTimeMinutes });
      await vendorApi().patch(`/vendor/branches/${VENDOR_A_BRANCH_ID}`, { isOpen: before.isOpen });
    }
  });

  test('order history finds an order by number and shows no customer details', async ({ page }) => {
    const order = await placeNewOrder();
    try {
      await page.goto('/order-history');
      await page.getByLabel('Order number').fill(order.orderNumber);
      const row = page.getByRole('row').filter({ hasText: order.orderNumber });
      await expect(row).toBeVisible();
      await expect(row).toContainText('Waiting for you');
      await expect(page.locator('main')).not.toContainText(/Playwright/);
    } finally {
      await cancelTestOrder(order);
    }
  });
});

test.describe('Admin has a single language control', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });
  for (const path of ['/control-tower', '/order-search', '/drivers']) {
    test(`${path}: exactly one switch, and it moves the page`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: /^Switch to Arabic$/ })).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'English', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'العربية', exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: 'Switch to Arabic' }).click();
      await expect(page.locator('[dir="rtl"]').first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'التبديل إلى الإنجليزية' })).toHaveCount(1);
      await page.getByRole('button', { name: 'التبديل إلى الإنجليزية' }).click();
    });
  }
});
