import { test, expect } from '@playwright/test';
import { SUPER_ADMIN_STORAGE_STATE, VENDOR_A_STORAGE_STATE } from './env';
import { adminApi, cancelTestOrder, orderDetail, placeReadyOrder, vendorApi, withAutomaticDispatch } from './control-tower-fixtures';

/**
 * Slice 2 in a real browser against the real backend: the alerts bell (Operations and vendor), financially isolated cases in the Operations
 * queue, and live updates from the change feed instead of full-list polling — with the old polling as the fallback.
 */
test.describe('Staff alerts, isolated cases and live updates', () => {
  test.setTimeout(150_000);

  test('a vendor sees the alert Operations raised, opens it, and the unread count goes down', async ({ browser }) => {
    await withAutomaticDispatch(false, async () => {
      // Start from a readable count: after many runs the fixture vendor can hold over 99 unread alerts, which the bell shows as "99+".
      await vendorApi().post('/staff/notifications/read-all');
      const order = await placeReadyOrder();
      const detail = await orderDetail(order.orderId);
      const marked = await adminApi().post(`/admin/orders/segments/${order.segmentId}/unavailable-items`, { itemIds: [detail.segments[0].items[0].id] });
      expect(marked.status).toBe(201);
      const asked = await adminApi().post(`/admin/order-exceptions/${marked.data.data.id}/request-vendor-action`, { note: 'Please confirm stock with the customer' });
      expect(asked.status).toBe(201);

      const ctx = await browser.newContext({ storageState: VENDOR_A_STORAGE_STATE });
      const page = await ctx.newPage();
      try {
        await page.goto('/orders');
        const bell = page.getByTestId('staff-alerts-bell');
        await expect(page.getByTestId('staff-alerts-count')).toBeVisible();
        const before = Number(await page.getByTestId('staff-alerts-count').innerText());
        await bell.click();
        const menu = page.getByRole('dialog', { name: 'Alerts' });
        const alert = menu.getByRole('link').filter({ hasText: detail.orderNumber }).filter({ hasText: 'Hatly operations need your action' });
        await expect(alert).toBeVisible();
        await expect(alert).toContainText('Critical');
        await expect(alert).toContainText('Please confirm stock with the customer');
        await alert.click();
        await expect(page).toHaveURL(new RegExp(`/orders/${order.orderId}$`));
        const badge = page.getByTestId('staff-alerts-count');
        await expect.poll(async () => ((await badge.count()) === 0 ? 0 : Number(await badge.innerText())), { timeout: 15_000 }).toBeLessThan(before);
      } finally {
        await ctx.close();
        await cancelTestOrder(order);
      }
    });
  });

  test('a financially isolated case is in the queue with its reason, priority, responsible employee and next step — and is not lost when the order ends', async ({ browser }) => {
    await withAutomaticDispatch(false, async () => {
      const order = await placeReadyOrder(); // a single item: continuing without it would empty the order
      const detail = await orderDetail(order.orderId);
      const marked = await adminApi().post(`/admin/orders/segments/${order.segmentId}/unavailable-items`, { itemIds: [detail.segments[0].items[0].id] });
      const exceptionId = marked.data.data.id as string;
      const decided = await adminApi().post(`/admin/order-exceptions/${exceptionId}/record-decision`, { decision: 'CONTINUE_WITHOUT', channel: 'PHONE', note: 'Customer said to continue without it' });
      expect(decided.data.data).toMatchObject({ executed: false, isolated: 'ORDER_WOULD_BE_EMPTY' });

      const ctx = await browser.newContext({ storageState: SUPER_ADMIN_STORAGE_STATE });
      const page = await ctx.newPage();
      try {
        await page.goto('/exceptions');
        await page.getByRole('tab', { name: 'Needs review' }).click();
        await page.getByLabel('Order number or customer').fill(detail.orderNumber);
        const row = page.getByRole('row').filter({ hasText: detail.orderNumber });
        await expect(row).toContainText('Nothing changed — needs a person');
        await expect(row).toContainText('High');
        await expect(row).toContainText('Nobody yet');
        await expect(row).toContainText('Nothing was changed — speak to the customer again and decide');

        // The alerts bell: critical alerts cannot be switched off in the inbox, push is the member of staff's own choice.
        await page.getByTestId('staff-alerts-bell').click();
        const menu = page.getByRole('dialog', { name: 'Alerts' });
        await menu.getByRole('button', { name: 'Settings' }).click();
        const isolatedPref = menu.getByRole('listitem').filter({ hasText: 'A case needs a person — nothing was changed' });
        await expect(isolatedPref.getByRole('checkbox', { name: /In the app/ })).toBeDisabled();
        await expect(isolatedPref.getByRole('checkbox', { name: /Push to my device/ })).toBeEnabled();
        await menu.getByRole('button', { name: 'Back' }).click();
        await page.keyboard.press('Escape');

        // An alert links straight to its case.
        await page.goto(`/exceptions?case=${exceptionId}`);
        const panel = page.getByRole('dialog').filter({ hasText: `Case — order ${detail.orderNumber}` });
        await expect(panel.getByTestId('case-isolation')).toContainText('Nothing was changed on this order.');
        await expect(panel.getByTestId('case-isolation')).toContainText('would leave the order empty');
        await expect(panel.getByTestId('case-responsible')).toContainText('Nobody yet');
        await panel.getByRole('button', { name: 'Assign to me' }).click();
        await expect(panel.getByTestId('case-responsible')).not.toContainText('Nobody yet');
      } finally {
        await ctx.close();
      }

      // The order ends by another path; the critical case is still in the queue until a person closes it.
      const cancelled = await adminApi().post(`/admin/orders/${order.orderId}/cancel`, { reasonCode: 'OUT_OF_STOCK', reasonText: 'cancelled outside the case' });
      expect(cancelled.status).toBe(201);
      const open = (await adminApi().get(`/admin/order-exceptions?isolated=true&q=${encodeURIComponent(detail.orderNumber)}`)).data.data as any[];
      expect(open.map((c) => c.id)).toContain(exceptionId);
      expect(open[0]).toMatchObject({ requiredAction: 'REVIEW_ISOLATED_CASE', isolation: { code: 'ORDER_WOULD_BE_EMPTY' } });
      expect(open[0].responsible).not.toBeNull();

      const ctx2 = await browser.newContext({ storageState: SUPER_ADMIN_STORAGE_STATE });
      const page2 = await ctx2.newPage();
      try {
        await page2.goto(`/exceptions?case=${exceptionId}`);
        const panel = page2.getByRole('dialog').filter({ hasText: `Case — order ${detail.orderNumber}` });
        await panel.getByLabel('Internal note').fill('The order was cancelled separately');
        await panel.getByRole('button', { name: /Close the case/ }).click();
        await expect.poll(async () => ((await adminApi().get(`/admin/order-exceptions?isolated=true&q=${encodeURIComponent(detail.orderNumber)}`)).data.data as any[]).length, { timeout: 15_000 }).toBe(0);
      } finally {
        await ctx2.close();
      }
    });
  });

  test('the vendor order list follows the change feed: an idle list is not re-downloaded, and a new order appears without waiting for a timer', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: VENDOR_A_STORAGE_STATE });
    const page = await ctx.newPage();
    let lists = 0;
    let feeds = 0;
    page.on('request', (r) => {
      const url = new URL(r.url());
      if (/\/vendor\/orders\/changes$/.test(url.pathname)) feeds++;
      else if (/\/vendor\/orders$/.test(url.pathname)) lists++;
    });
    let order: Awaited<ReturnType<typeof placeReadyOrder>> | undefined;
    try {
      await page.goto('/orders');
      await expect(page.getByRole('heading', { level: 1 }).or(page.getByRole('heading').first())).toBeVisible();
      await page.waitForTimeout(26_000); // longer than the old 20 s full-list interval
      expect(lists).toBe(1); // the list was loaded once; idle time cost only feed requests
      expect(feeds).toBeGreaterThanOrEqual(3);

      order = await placeReadyOrder();
      await expect(page.getByText(order.orderNumber, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
      expect(lists).toBe(2); // exactly one reload, caused by the change
    } finally {
      await ctx.close();
      if (order) await cancelTestOrder(order);
    }
  });

  test('if the change feed is unavailable the list falls back to reloading on the old interval', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: VENDOR_A_STORAGE_STATE });
    const page = await ctx.newPage();
    await page.route('**/vendor/orders/changes**', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":{"message":"not found"}}' }));
    let lists = 0;
    page.on('request', (r) => {
      if (/\/vendor\/orders$/.test(new URL(r.url()).pathname)) lists++;
    });
    try {
      await page.goto('/orders');
      await expect.poll(() => lists, { timeout: 5_000 }).toBeGreaterThanOrEqual(1);
      await expect.poll(() => lists, { timeout: 30_000 }).toBeGreaterThanOrEqual(2); // the 20 s fallback reload
    } finally {
      await ctx.close();
    }
  });
});
