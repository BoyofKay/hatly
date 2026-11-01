import { test, expect } from '@playwright/test';
import { SUPER_ADMIN_STORAGE_STATE, VENDOR_A_STORAGE_STATE } from './env';
import { adminApi, cancelTestOrder, orderDetail, placeReadyOrder, withAutomaticDispatch } from './control-tower-fixtures';

/**
 * PD-016 in a real browser against the real backend: the vendor says an item is not available; Operations sees the case, records what the
 * customer said by phone, and — because the customer asked to cancel — cancels through the existing cancellation. There is no replacement.
 */
test.describe('Order exceptions — vendor control and Operations queue', () => {
  test.setTimeout(120_000);

  test('the vendor marks an item unavailable from the order page; there is no replacement option', async ({ browser }) => {
    const order = await placeReadyOrder();
    const ctx = await browser.newContext({ storageState: VENDOR_A_STORAGE_STATE });
    const page = await ctx.newPage();
    try {
      await page.goto(`/orders/${order.orderId}`);
      await page.getByTestId('vendor-open-unavailable').click();
      await expect(page.getByText(/cannot suggest a replacement/i)).toBeVisible();
      await expect(page.getByText(/replacement product|substitute/i)).toHaveCount(0);
      await page.getByRole('checkbox').first().check();
      await page.getByTestId('vendor-send-unavailable').click();
      await expect(page.getByText(/The customer was asked/i)).toBeVisible();
      const cases = (await adminApi().get(`/admin/order-exceptions?q=${encodeURIComponent((await orderDetail(order.orderId)).orderNumber)}`)).data.data as any[];
      expect(cases).toHaveLength(1);
      expect(cases[0]).toMatchObject({ type: 'ITEM_UNAVAILABLE', status: 'AWAITING_CUSTOMER' });
    } finally {
      await ctx.close();
      await cancelTestOrder(order);
    }
  });

  test('Operations opens the case, must document the call, and cancels the order the customer asked to cancel', async ({ browser }) => {
    await withAutomaticDispatch(false, async () => {
      const order = await placeReadyOrder();
      const detail = await orderDetail(order.orderId);
      const itemId = detail.segments[0].items[0].id;
      const marked = await adminApi().post(`/admin/orders/segments/${order.segmentId}/unavailable-items`, { itemIds: [itemId] });
      expect(marked.status).toBe(201);

      const ctx = await browser.newContext({ storageState: SUPER_ADMIN_STORAGE_STATE });
      const page = await ctx.newPage();
      try {
        await page.goto('/exceptions');
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Order exceptions');
        await page.getByLabel('Order number or customer').fill(detail.orderNumber);
        await page.getByRole('button', { name: detail.orderNumber }).click();

        const panel = page.getByRole('dialog');
        await expect(panel.getByText('Unavailable items')).toBeVisible();
        await expect(panel.getByText(/You cannot decide for them/i)).toBeVisible();
        // The record button stays disabled until the conversation is documented — nothing is decided for the customer.
        const record = panel.getByRole('button', { name: 'Record and carry out' });
        await expect(record).toBeDisabled();
        await panel.getByLabel('Decision').selectOption('CANCEL_ORDER');
        await panel.getByLabel('Note of the conversation (required)').fill('Called the customer, they asked to cancel the whole order');
        await expect(record).toBeEnabled();
        await record.click();
        await page.getByRole('dialog').filter({ hasText: 'Cancel the entire order?' }).getByRole('button', { name: 'Cancel the order' }).click();

        await expect.poll(async () => (await orderDetail(order.orderId)).status, { timeout: 20_000 }).toBe('CANCELLED');
        const ex = (await adminApi().get(`/admin/order-exceptions?status=RESOLVED&includeClosedOrders=true&q=${encodeURIComponent(detail.orderNumber)}`)).data.data as any[];
        expect(ex[0]).toMatchObject({ status: 'RESOLVED', customerDecision: 'CANCEL_ORDER', decisionChannel: 'PHONE' });
      } finally {
        await ctx.close();
      }
    });
  });

  test('the Exceptions page is right-to-left in Arabic and does not overflow a phone screen', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: SUPER_ADMIN_STORAGE_STATE, viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    try {
      await page.goto('/exceptions');
      await page.getByRole('button', { name: 'Switch to Arabic' }).click();
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('استثناءات الطلبات');
      await page.waitForLoadState('networkidle');
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
      await page.getByRole('button', { name: 'التبديل إلى الإنجليزية' }).click();
    } finally {
      await ctx.close();
    }
  });
});
