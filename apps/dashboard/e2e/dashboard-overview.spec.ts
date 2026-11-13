import { test, expect, Page } from '@playwright/test';
import { SUPER_ADMIN_STORAGE_STATE, VENDOR_A_STORAGE_STATE } from './env';
import { adminApi, vendorApi } from './control-tower-fixtures';
import { formatMoney } from '../lib/ui/lang';

/**
 * The two homes of the approved reference (`docs/transformation/reference/admin-vendor-reference.jpg`): the Admin Home (`/home`) and the Vendor
 * Home (`/overview`). Every figure on them must be the backend's own — the Admin KPI cards and status donut equal `/admin/executive/kpis`, the
 * Vendor cards equal `/vendor/overview`, the charts have one point per calendar day of the period (days without orders are 0, never skipped),
 * and the recent/latest orders are the newest orders by their customer-facing number. Arabic right-to-left and phone width are checked for clipping.
 */

/** Today in Cairo shifted by `offset` days, `YYYY-MM-DD` — the same computation as the dashboard's `cairoDate`. */
const cairoDate = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
const num = (n: number) => new Intl.NumberFormat('en-US').format(n);

/** The statuses the donut's four groups cover (AdminOverview GROUPS) — every order status, so the donut total is the period's order count. */
const GROUPED = ['DELIVERED', 'COLLECTED', 'PENDING', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'ASSIGNED_TO_DRIVER', 'PICKED_UP', 'ON_THE_WAY', 'CANCELLED', 'FAILED_DELIVERY'];

async function clippedElements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const scrolls = (el: Element | null): boolean => {
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        const o = getComputedStyle(n).overflowX;
        if (o === 'auto' || o === 'scroll') return true;
      }
      return false;
    };
    return [...document.querySelectorAll('main *')]
      .filter((e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.position !== 'fixed' && (document.documentElement.dir === 'rtl' ? r.left < -2 : r.right > vw + 2) && !scrolls(e.parentElement); })
      .slice(0, 5)
      .map((e) => `${e.tagName}.${String(e.className).slice(0, 50)}`);
  });
}

test.describe('Admin — Home (the reference dashboard)', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  test('one welcome heading; the Home section is marked; the KPI cards show the executive figures of the last 7 days', async ({ page }) => {
    await page.goto('/home');
    await page.getByTestId('home-mode-overview').click(); // operations staff land on the board; the overview is one tap away
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome to your dashboard');
    await expect(page.getByTestId('nav-section-home')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('overview-kpis')).toBeVisible();

    const res = await adminApi().get('/admin/executive/kpis', { params: { from: cairoDate(-6), to: cairoDate(0) } });
    expect(res.status).toBe(200);
    const byKey = Object.fromEntries((res.data.data.kpis as any[]).map((k) => [k.key, k]));

    const cards = page.locator('[data-testid^="overview-kpi-"][data-testid$="-value"]');
    await expect(cards.first()).toBeVisible();
    const shown = await cards.count();
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThanOrEqual(4);
    for (const key of ['ordersPlaced', 'activeVendors', 'gmvMinor', 'newCustomers', 'ordersDelivered']) {
      const value = page.getByTestId(`overview-kpi-${key}-value`);
      if ((await value.count()) === 0) continue;
      const k = byKey[key];
      expect(k, `${key} is on the page but not in the API`).toBeTruthy();
      const expected = k.value === null ? 'No data' : k.unit === 'minor' ? formatMoney(k.value, 'en') : num(k.value);
      await expect(value).toHaveText(expected);
    }
  });

  test('the donut total equals the period\'s orders by status from the executive figures (and so the order count)', async ({ page }) => {
    await page.goto('/home');
    await page.getByTestId('home-mode-overview').click(); // operations staff land on the board; the overview is one tap away
    await expect(page.getByTestId('overview-donut-total')).toBeVisible();
    // Orders keep arriving from other tests' fixtures, so compare against fresh figures until both agree.
    await expect
      .poll(async () => {
        const k = (await adminApi().get('/admin/executive/kpis', { params: { from: cairoDate(-6), to: cairoDate(0) } })).data.data;
        const expected = GROUPED.reduce((n, s) => n + (k.ordersByStatus?.[s] ?? 0), 0);
        expect(expected).toBe(k.kpis.find((x: any) => x.key === 'ordersPlaced').value ?? 0);
        const shown = Number((await page.getByTestId('overview-donut-total').innerText()).replace(/,/g, ''));
        if (shown !== expected) await page.reload();
        return shown === expected;
      }, { timeout: 20_000 })
      .toBe(true);
  });

  test('"Orders per day" has one point per day of the selected period, ending today (days without orders are 0)', async ({ page }) => {
    await page.goto('/home');
    await page.getByTestId('home-mode-overview').click(); // operations staff land on the board; the overview is one tap away
    const rows = page.getByTestId('overview-chart').locator('table tr');
    await expect(rows).toHaveCount(7);
    await expect(rows.first().locator('th')).toHaveText(cairoDate(-6));
    await expect(rows.last().locator('th')).toHaveText(cairoDate(0));

    await page.getByRole('tab', { name: 'Last 30 days' }).click();
    await expect(rows).toHaveCount(30);
    await expect(rows.first().locator('th')).toHaveText(cairoDate(-29));
    await expect(rows.last().locator('th')).toHaveText(cairoDate(0));

    // "Today" still draws a week, so there is a trend to read.
    await page.getByRole('tab', { name: 'Today' }).click();
    await expect(rows).toHaveCount(7);
  });

  test('recent orders show the customer-facing numbers; a row opens that order in the Orders workspace drawer', async ({ page }) => {
    await page.goto('/home');
    await page.getByTestId('home-mode-overview').click(); // operations staff land on the board; the overview is one tap away
    const recent = page.getByTestId('overview-recent');
    await expect(recent.locator('tbody tr').first()).toBeVisible();
    const first = recent.locator('a').first();
    const href = (await first.getAttribute('href'))!;
    expect(href).toMatch(/^\/order-management\?order=[0-9a-f-]{36}$/);
    const orderId = href.split('order=')[1];
    const detail = (await adminApi().get(`/admin/orders/${orderId}`)).data.data;
    await expect(first).toContainText(detail.orderNumber);
    expect(detail.orderNumber).toMatch(/^HT-\d+$/);

    await first.click();
    await expect(page).toHaveURL(new RegExp(`/order-management\\?.*order=${orderId}`));
    await expect(page.getByTestId('order-drawer')).toBeVisible();
    await expect(page.getByTestId('order-drawer-body')).toContainText(detail.orderNumber);
  });

  test('Arabic on a phone: right-to-left, the overview is shown and nothing is clipped off-screen', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: SUPER_ADMIN_STORAGE_STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(() => { try { localStorage.setItem('hatly_dashboard_locale', 'ar'); } catch { /* storage unavailable */ } });
    const page = await ctx.newPage();
    try {
      await page.goto('/home');
      await page.getByTestId('home-mode-overview').click(); // operations staff land on the board; the overview is one tap away
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('مرحباً بك في لوحة التحكم');
      await expect(page.getByTestId('overview-kpis')).toBeVisible();
      await expect(page.getByTestId('overview-donut-total')).toBeVisible();
      await page.waitForTimeout(800);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
      expect(await clippedElements(page), '/home has content outside the screen').toEqual([]);
    } finally {
      await ctx.close();
    }
  });
});

test.describe('Vendor — Overview', () => {
  test.use({ storageState: VENDOR_A_STORAGE_STATE });

  test('the goods-value chart has one bar per day of the last 7 days, ending today', async ({ page }) => {
    await page.goto('/overview');
    const rows = page.getByTestId('vendor-overview-chart').locator('table tr');
    await expect(rows).toHaveCount(7);
    await expect(rows.first().locator('th')).toHaveText(cairoDate(-6).slice(5));
    await expect(rows.last().locator('th')).toHaveText(cairoDate(0).slice(5));
  });

  test('welcome heading with the store name; the cards show today\'s orders and sales, the product count and the rating from the overview API', async ({ page }) => {
    await page.goto('/overview');
    const o = (await vendorApi().get('/vendor/overview')).data.data;
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Welcome, ${o.vendorName}`);
    await expect(page.getByTestId('vendor-section-home')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('vendor-store-chip')).toContainText(o.vendorName);
    await expect(page.getByTestId('vendor-kpi-orders-value')).toHaveText(num(o.today.received));
    await expect(page.getByTestId('vendor-kpi-sales-value')).toHaveText(formatMoney(o.today.goodsMinor, 'en'));
    await expect(page.getByTestId('vendor-kpi-products-value')).toHaveText(num(o.productCount));
    await expect(page.getByTestId('vendor-kpi-rating-value')).toHaveText(o.rating ? `${o.rating.average.toFixed(1)}★` : 'No ratings yet');
  });

  test('latest orders are the newest orders by their HT- number; a row opens the order on the board', async ({ page }) => {
    await page.goto('/overview');
    const latest = page.getByTestId('vendor-overview-latest');
    await expect(latest.locator('li').first()).toBeVisible();
    const res = await vendorApi().get('/vendor/orders');
    expect(res.status).toBe(200);
    const newest = (res.data.data as any[]).slice(0, 5);
    expect(newest.length).toBeGreaterThan(0);
    for (const o of newest) expect(o.orderNumber).toMatch(/^HT-\d+$/);
    await expect(latest.locator('li')).toHaveCount(newest.length);
    await expect(latest.locator('li').first()).toContainText(newest[0].orderNumber);
    // no internal id fragment is shown in place of the number
    await expect(latest).not.toContainText(`#${newest[0].id.slice(0, 8)}`);

    await latest.locator('a').first().click();
    await expect(page).toHaveURL(new RegExp(`/orders\\?.*order=${newest[0].id}`));
    await expect(page.getByTestId('vendor-drawer')).toBeVisible();
  });

  test('Arabic on a phone: right-to-left, KPIs and chart shown, nothing clipped off-screen', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: VENDOR_A_STORAGE_STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(() => { try { localStorage.setItem('hatly_dashboard_locale', 'ar'); } catch { /* storage unavailable */ } });
    const page = await ctx.newPage();
    try {
      await page.goto('/overview');
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByTestId('vendor-overview-kpis')).toBeVisible();
      await expect(page.getByTestId('vendor-overview-chart')).toBeVisible();
      await page.waitForTimeout(800);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
      expect(await clippedElements(page), '/overview has content outside the screen').toEqual([]);
    } finally {
      await ctx.close();
    }
  });
});
