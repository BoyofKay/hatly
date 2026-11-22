import { test, expect, Page } from '@playwright/test';
import { SUPER_ADMIN_STORAGE_STATE } from './env';
import { adminApi, cancelTestOrder, createOnlineDriver, orderDetail, placeReadyOrder, takeOffline, TestDriver, withAutomaticDispatch } from './control-tower-fixtures';

/**
 * The Operations Command Center is a different, purpose-built layout on each screen size: order CARDS with the urgent items first on a phone, cards in
 * two columns on a tablet, the operational table on a desktop. Verified in the real browser, in English and Arabic, with no horizontal scrolling,
 * touch-sized controls, and a real assignment through the phone's bottom sheet.
 */
const PHONES = [{ width: 360, height: 740 }, { width: 390, height: 844 }, { width: 430, height: 932 }];
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test.describe('Control Tower — responsive layouts', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });
  test.setTimeout(120_000);

  let driver: TestDriver;
  test.beforeAll(async () => { driver = await createOnlineDriver('Responsive'); });
  test.afterAll(async () => { if (driver) await takeOffline(driver); });

  for (const vp of PHONES) {
    for (const lang of ['en', 'ar'] as const) {
      test(`phone ${vp.width}px (${lang}): cards, urgent items first, no horizontal scroll, touch-sized controls`, async ({ browser }) => {
        const order = await placeReadyOrder();
        const ctx = await browser.newContext({ storageState: SUPER_ADMIN_STORAGE_STATE, viewport: vp, isMobile: true, hasTouch: true });
        await ctx.addInitScript((l) => { try { localStorage.setItem('hatly_dashboard_locale', l); } catch { /* storage unavailable */ } }, lang);
        const page = await ctx.newPage();
        try {
          await page.goto('/control-tower');
          await expect(page.getByRole('heading', { level: 1 })).toHaveText(lang === 'ar' ? 'برج التحكم' : 'Control Tower');
          await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
          await expect(page.getByTestId('ct-urgent')).toBeVisible();
          await expect(page.getByTestId('ct-cards')).toBeVisible();
          await expect(page.getByTestId('ct-table')).toHaveCount(0); // the 8-column table is NOT squeezed into a phone
          expect(await noOverflow(page)).toBeLessThanOrEqual(1);

          // The urgent block comes BEFORE the order list.
          const urgentBox = await page.getByTestId('ct-urgent').boundingBox();
          const cardsBox = await page.getByTestId('ct-cards').boundingBox();
          expect(urgentBox!.y).toBeLessThan(cardsBox!.y);

          // Every control a thumb has to hit is at least 40 px tall.
          for (const sel of ['[data-testid^="ct-stage-"]', '[data-testid="ct-search"]', '[data-testid="ct-refresh"]', '[data-testid="ct-cards"] button', '[data-testid="ct-urgent"] button, [data-testid="ct-urgent"] a']) {
            const boxes = await page.locator(sel).evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => (e as HTMLElement).getBoundingClientRect().height));
            for (const h of boxes) expect(h, `${sel} is ${h}px tall`).toBeGreaterThanOrEqual(39.5);
          }
          // Readable text: nothing in the main area is smaller than 12 px.
          const minFont = await page.evaluate(() => Math.min(...[...document.querySelectorAll('main *')].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim())).map((e) => parseFloat(getComputedStyle(e).fontSize))));
          expect(minFont).toBeGreaterThanOrEqual(12);

          // The shell banner folds on a phone: title and count stay, the list is behind a toggle.
          const banner = page.getByTestId('operations-banner');
          if (await banner.count()) {
            await expect(banner.locator('ul')).toBeHidden();
            await banner.getByRole('button', { expanded: false }).click();
            await expect(banner.locator('ul')).toBeVisible();
          }
        } finally {
          await ctx.close();
          await cancelTestOrder(order);
        }
      });
    }
  }

  test('phone: an order is assigned through the bottom sheet with the normal assignment (automatic dispatch off)', async ({ browser }) => {
    await withAutomaticDispatch(false, async () => {
      const order = await placeReadyOrder();
      const ctx = await browser.newContext({ storageState: SUPER_ADMIN_STORAGE_STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      try {
        await page.goto('/control-tower');
        await page.getByTestId('ct-search').fill(order.orderNumber);
        await page.getByRole('button', { name: 'Search', exact: true }).click();
        const card = page.getByTestId(`ct-row-${order.orderNumber}`);
        await expect(card).toBeVisible();
        await expect(card).toContainText('No driver');
        await card.getByTestId(`ct-action-${order.orderNumber}`).click();
        const sheet = page.getByTestId('ct-panel');
        await expect(sheet).toBeVisible();
        const box = await sheet.boundingBox();
        expect(box!.y + box!.height).toBeGreaterThanOrEqual(844 - 2); // anchored to the bottom edge
        await sheet.getByTestId('dispatch-driver-select').selectOption(driver.id);
        await sheet.getByTestId('dispatch-submit').click();
        await expect(page.getByTestId('ct-flash')).toContainText(driver.fullName);
        await expect.poll(async () => (await orderDetail(order.orderId)).driver?.id).toBe(driver.id);
        await expect(page.getByTestId('ct-panel')).toHaveCount(0);
      } finally {
        await ctx.close();
        await cancelTestOrder(order);
      }
    });
  });

  test('tablet 820px: cards in two columns, no horizontal scroll', async ({ browser }) => {
    const order = await placeReadyOrder();
    const ctx = await browser.newContext({ storageState: SUPER_ADMIN_STORAGE_STATE, viewport: { width: 820, height: 1180 }, hasTouch: true });
    const page = await ctx.newPage();
    try {
      await page.goto('/control-tower');
      await expect(page.getByTestId('ct-cards')).toBeVisible();
      await expect(page.getByTestId('ct-table')).toHaveCount(0);
      expect(await noOverflow(page)).toBeLessThanOrEqual(1);
      const cols = await page.getByTestId('ct-cards').evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(' ').length);
      expect(cols).toBe(2);
    } finally {
      await ctx.close();
      await cancelTestOrder(order);
    }
  });

  test('desktop 1440px: the operational table, KPI strip and no cards', async ({ browser }) => {
    const order = await placeReadyOrder(); // with no deliveries the page shows its empty state instead of the table
    const ctx = await browser.newContext({ storageState: SUPER_ADMIN_STORAGE_STATE, viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    try {
      await page.goto('/control-tower');
      await expect(page.getByTestId('ct-kpis')).toBeVisible();
      await expect(page.getByTestId('ct-table')).toBeVisible();
      await expect(page.getByTestId('ct-cards')).toHaveCount(0);
      expect(await noOverflow(page)).toBeLessThanOrEqual(1);
    } finally {
      await ctx.close();
      await cancelTestOrder(order);
    }
  });
});
void adminApi;
