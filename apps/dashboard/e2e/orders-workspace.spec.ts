import { test, expect } from '@playwright/test';
import { SUPER_ADMIN_STORAGE_STATE, VENDOR_A_STORAGE_STATE } from './env';
import { adminApi, cancelTestOrder, createOnlineDriver, orderDetail, placeNewOrder, placeReadyOrder, takeOffline, withAutomaticDispatch } from './control-tower-fixtures';

/**
 * The Orders workspace (Admin) and the incoming-orders board (Vendor): the redesigned, few-clicks screens. Real orders, real drivers, the real backend;
 * Automatic Dispatch is switched OFF while a test needs an order to stay unassigned (and restored afterwards).
 */
test.describe('Admin — Orders workspace', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  test('"Needs a driver" lists a ready delivery order with the backend count; the row opens the order in a drawer on the same page; Esc closes it', async ({ page }) => {
    await withAutomaticDispatch(false, async () => {
      const order = await placeReadyOrder();
      try {
        await page.goto('/order-management?view=needsDriver');
        const summary = await adminApi().get('/admin/control-tower/summary');
        const awaiting = summary.data.data.attention.awaitingAssignment as number;
        await expect(page.getByTestId('view-needsDriver')).toContainText(String(awaiting));

        const row = page.getByTestId(`order-row-${order.orderNumber}`);
        await page.getByTestId('orders-search').fill(order.orderNumber);
        await expect(row).toBeVisible();
        await expect(row).toContainText('Ready for pickup');

        // one click → the full order, in place
        await row.getByText(order.orderNumber).click();
        await expect(page.getByTestId('order-drawer')).toBeVisible();
        await expect(page.getByTestId('order-drawer-body')).toContainText(order.orderNumber);
        await expect(page).toHaveURL(/\/order-management\?.*order=/);
        // the list is still there behind the drawer — nothing navigated
        await expect(page.getByTestId('orders-table')).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(page.getByTestId('order-drawer')).toHaveCount(0);
        await expect(page).not.toHaveURL(/order=/);
      } finally {
        await cancelTestOrder(order).catch(() => undefined);
      }
    });
  });

  test('a driver is assigned straight from the row (no page change); the order leaves "Needs a driver" and the row names the driver', async ({ page }) => {
    await withAutomaticDispatch(false, async () => {
      const driver = await createOnlineDriver('Workspace');
      const order = await placeReadyOrder();
      try {
        await page.goto('/order-management?view=needsDriver');
        await page.getByTestId('orders-search').fill(order.orderNumber);
        const row = page.getByTestId(`order-row-${order.orderNumber}`);
        await expect(row).toBeVisible();

        const startUrl = page.url();
        await row.getByTestId('dispatch-driver-select').selectOption(driver.id);
        await row.getByTestId('dispatch-submit').click();

        await expect(page.getByTestId('orders-notice')).toContainText(order.orderNumber);
        await expect.poll(async () => (await orderDetail(order.orderId)).driver?.id, { timeout: 15_000 }).toBe(driver.id);
        expect((await orderDetail(order.orderId)).status).toBe('ASSIGNED_TO_DRIVER');
        // it is no longer in the "needs a driver" queue, and it did not navigate
        await expect(row).toHaveCount(0, { timeout: 15_000 });
        expect(page.url().split('?')[0]).toBe(startUrl.split('?')[0]);

        // …and in "With a driver" the row names the driver
        await page.getByTestId('view-withDriver').click();
        await expect(page.getByTestId(`order-row-${order.orderNumber}`)).toContainText(driver.fullName);
      } finally {
        await takeOffline(driver);
        await cancelTestOrder(order).catch(() => undefined);
      }
    });
  });

  test('keyboard: j moves to the first order, Enter opens it, "next" moves the drawer to the following order, Esc closes', async ({ page }) => {
    await page.goto('/order-management');
    await expect(page.getByTestId('orders-table')).toBeVisible();
    const rows = page.locator('[data-testid^="order-row-"]');
    expect(await rows.count()).toBeGreaterThan(1);
    const first = (await rows.nth(0).getAttribute('data-testid'))!.replace('order-row-', '');
    const second = (await rows.nth(1).getAttribute('data-testid'))!.replace('order-row-', '');

    await page.keyboard.press('j');
    await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('order-drawer-body')).toContainText(first);
    await page.getByTestId('drawer-next').click();
    await expect(page.getByTestId('order-drawer-body')).toContainText(second);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('order-drawer')).toHaveCount(0);
  });

  test('search by order number, and a search with no match is an explicit empty state with a way out', async ({ page }) => {
    await withAutomaticDispatch(false, async () => {
      const order = await placeReadyOrder();
      try {
        await page.goto('/order-management');
        await page.getByTestId('orders-search').fill(order.orderNumber);
        await expect(page.locator('[data-testid^="order-row-"]')).toHaveCount(1);
        await page.getByTestId('orders-search').fill('HT-999999999');
        await expect(page.getByText('No orders match.')).toBeVisible();
        await page.getByRole('button', { name: 'Clear all' }).first().click();
        await expect(page.getByTestId('orders-table')).toBeVisible();
      } finally {
        await cancelTestOrder(order).catch(() => undefined);
      }
    });
  });

  test('a link with a plain ?status= from an older bookmark still filters, and shows what it is filtering by', async ({ page }) => {
    const [request] = await Promise.all([
      page.waitForRequest((r) => /\/admin\/orders\?/.test(r.url()) && new URL(r.url()).searchParams.get('statuses') === 'CONFIRMED'),
      page.goto('/order-management?status=CONFIRMED'),
    ]);
    expect(new URL(request.url()).searchParams.get('statuses')).toBe('CONFIRMED');
    await expect(page.getByTestId('raw-status-chip')).toContainText('Confirmed');
  });

  test('phone width: the list becomes cards, the drawer fills the screen, and nothing overflows sideways', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/order-management');
    await expect(page.getByTestId('orders-cards')).toBeVisible();
    await page.locator('[data-testid="orders-cards"] button').first().click();
    const drawer = page.getByTestId('order-drawer');
    await expect(drawer).toBeVisible();
    const box = (await drawer.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(388);
    await page.keyboard.press('Escape');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('Arabic: the views and the table are in Arabic, the page is RTL, and the drawer slides in from the left (the end edge)', async ({ page }) => {
    await page.goto('/order-management');
    await page.getByRole('button', { name: 'Switch to Arabic' }).click();
    await expect(page.locator('[dir="rtl"]').first()).toBeVisible();
    await expect(page.getByTestId('view-needsDriver')).toContainText('تحتاج سائقًا');
    await expect(page.getByRole('heading', { name: 'الطلبات' })).toBeVisible();
    await page.locator('[data-testid^="order-row-"]').first().click();
    const box = (await page.getByTestId('order-drawer').boundingBox())!;
    expect(box.x).toBeLessThanOrEqual(1); // anchored to the left edge in RTL
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'التبديل إلى الإنجليزية' }).click(); // the shell's own label for the language switch while the page is Arabic
  });

  test('the sidebar is the reference\'s ten sections; Orders opens the workspace with its pages as tabs; the old "Order Search" link is gone', async ({ page }) => {
    await page.goto('/order-management');
    await expect(page.locator('[data-testid^="nav-section-"]')).toHaveCount(10);
    const orders = page.getByTestId('nav-section-orders');
    await expect(orders).toHaveAttribute('aria-current', 'page');
    await expect(orders).toHaveAttribute('href', '/order-management');
    const tabs = page.getByRole('navigation', { name: 'Section pages' });
    await expect(tabs.getByRole('link', { name: 'Orders', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(tabs.getByRole('link', { name: 'Control Tower', exact: true })).toHaveAttribute('href', '/control-tower');
    await expect(page.getByRole('link', { name: 'Order Search', exact: true })).toHaveCount(0);
    // another section opens its first page, and the tab bar follows it
    await page.getByTestId('nav-section-customers').click();
    await expect(page).toHaveURL(/\/customers$/);
    await expect(page.getByTestId('nav-section-customers')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('navigation', { name: 'Section pages' }).getByRole('link', { name: 'Reviews', exact: true })).toBeVisible();
  });

  test('Ctrl+K opens quick find and an order found there opens in the workspace drawer', async ({ page }) => {
    await withAutomaticDispatch(false, async () => {
      const order = await placeReadyOrder();
      try {
        await page.goto('/control-tower');
        await page.keyboard.press('Control+k');
        await page.getByRole('dialog').getByRole('textbox').fill(order.orderNumber);
        await page.getByRole('dialog').getByRole('button', { name: new RegExp(order.orderNumber) }).first().click();
        await expect(page).toHaveURL(/\/order-management\?.*order=/);
        await expect(page.getByTestId('order-drawer-body')).toContainText(order.orderNumber);
      } finally {
        await cancelTestOrder(order).catch(() => undefined);
      }
    });
  });
});

test.describe('Vendor — incoming orders board', () => {
  test.use({ storageState: VENDOR_A_STORAGE_STATE });

  test('a new order sits in "Waiting for you"; one tap on Confirm moves it to "Being prepared"; Details opens it in a drawer without leaving the board', async ({ page }) => {
    const order = await placeNewOrder();
    try {
      await page.goto('/orders');
      const card = page.getByTestId(`vendor-order-${order.orderId}`);
      await expect(page.getByTestId('vendor-col-new').getByTestId(`vendor-order-${order.orderId}`)).toBeVisible();

      await card.getByTestId(`vendor-advance-${order.segmentId}`).click();
      await expect(page.getByTestId('vendor-col-preparing').getByTestId(`vendor-order-${order.orderId}`)).toBeVisible({ timeout: 15_000 });
      expect((await orderDetail(order.orderId)).segments.find((s: any) => s.id === order.segmentId).status).toBe('CONFIRMED');
      await expect(page.getByTestId(`vendor-advance-${order.segmentId}`)).toContainText('Start preparing');

      await page.getByTestId(`vendor-details-${order.orderId}`).click();
      await expect(page.getByTestId('vendor-drawer')).toBeVisible();
      await expect(page.getByTestId('vendor-drawer-body')).toBeVisible();
      await expect(page).toHaveURL(/\/orders\?order=/);
      // privacy: the vendor's view never carries a customer phone number
      expect(await page.getByTestId('vendor-drawer').innerText()).not.toMatch(/\+?20\d{9,10}/);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('vendor-drawer')).toHaveCount(0);
    } finally {
      await cancelTestOrder(order).catch(() => undefined);
    }
  });

  test('phone width: the board becomes three tabs with counts and the card buttons stay full-size', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/orders');
    await expect(page.getByTestId('vendor-board-tabs')).toBeVisible();
    await expect(page.getByTestId('vendor-board-tabs').getByRole('tab')).toHaveCount(3);
    const advance = page.locator('[data-testid^="vendor-advance-"]').first();
    if (await advance.count()) expect((await advance.boundingBox())!.height).toBeGreaterThanOrEqual(38);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('a vendor cannot reach the admin order workspace data (the API refuses)', async ({ page }) => {
    await page.goto('/orders');
    // the browser context carries the vendor's real session cookies
    const res = await page.request.get('http://localhost:3000/api/v1/admin/orders?limit=1');
    expect([401, 403]).toContain(res.status());
  });
});
