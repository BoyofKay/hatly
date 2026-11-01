import { test, expect } from '@playwright/test';
import { SUPER_ADMIN_STORAGE_STATE } from './env';
import { cancelTestOrder, createOnlineDriver, orderDetail, placeReadyOrder, takeOffline, withAutomaticDispatch } from './control-tower-fixtures';

/**
 * One complete operational scenario across Backend, Admin Panel and the Driver API (the exact endpoints the Driver app calls):
 * a customer order is prepared by the vendor → it shows in Admin → an admin assigns a driver (Automatic Dispatch OFF, so the
 * assignment is the admin's) → the driver sees it, picks up, is on the way, delivers with proof → Admin shows DELIVERED.
 * Test data only (a throwaway driver and customer on the dev database); nothing is written outside the product's own operations.
 */
// 1×1 transparent PNG — the smallest valid image the upload endpoint accepts.
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test.describe('Admin ↔ Driver — one order from READY to DELIVERED', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  test('manual assignment in Admin, driver progress, final state consistent everywhere', async ({ page }) => {
    test.setTimeout(120_000);
    await withAutomaticDispatch(false, async () => {
      const driver = await createOnlineDriver('Integrated');
      const order = await placeReadyOrder();
      try {
        // 1 — the order is in Admin, ready, and nobody is assigned (Automatic Dispatch is OFF).
        let detail = await orderDetail(order.orderId);
        expect(detail.status).toBe('READY_FOR_PICKUP');
        expect(detail.driver ?? null).toBeNull();

        // 2 — an admin assigns the driver from the Control Tower (confirmed).
        await page.goto('/control-tower');
        await expect(page.getByTestId('ct-attention')).toBeVisible();
        await page.getByTestId('ct-search').fill(order.orderNumber);
        await page.getByRole('button', { name: 'Search' }).click();
        const row = page.getByTestId(`ct-row-${order.orderNumber}`);
        await expect(row).toBeVisible({ timeout: 20_000 });
        page.once('dialog', (d) => d.accept());
        await row.getByTestId('dispatch-driver-select').selectOption(driver.id);
        await row.getByTestId('dispatch-submit').click();
        await expect.poll(async () => (await orderDetail(order.orderId)).driver?.id, { timeout: 15_000 }).toBe(driver.id);
        detail = await orderDetail(order.orderId);
        expect(detail.status).toBe('ASSIGNED_TO_DRIVER');

        // 3 — the driver (Driver app API) sees exactly that delivery, with pickup and delivery information.
        const list = (await driver.api.get('/driver/deliveries')).data.data as any[];
        const mine = list.find((d) => d.orderId === order.orderId);
        expect(mine, 'the assigned order is in the driver list').toBeTruthy();
        const full = (await driver.api.get(`/driver/deliveries/${mine.id}`)).data.data;
        expect(full.id).toBe(mine.id);
        expect(JSON.stringify(full)).toContain('Playwright Control Tower Street 1'); // delivery address visible to the driver

        // 4 — pickup → on the way, each visible in Admin.
        for (const status of ['PICKED_UP', 'ON_THE_WAY']) {
          const res = await driver.api.patch(`/driver/deliveries/${mine.id}/status`, { status });
          expect(res.status, `driver → ${status}: ${JSON.stringify(res.data)}`).toBe(200);
          expect((await orderDetail(order.orderId)).status).toBe(status);
        }

        // 5 — delivery needs real evidence: a missing proof is refused, a proper one completes it.
        const refused = await driver.api.patch(`/driver/deliveries/${mine.id}/status`, { status: 'DELIVERED' });
        expect(refused.status).toBeGreaterThanOrEqual(400);
        const upload = await driver.api.post('/uploads', { base64Content: PNG_BASE64, filename: 'proof.png' });
        expect(upload.status, JSON.stringify(upload.data)).toBeLessThan(300);
        const done = await driver.api.patch(`/driver/deliveries/${mine.id}/status`, { status: 'DELIVERED', proofPhotoUrl: upload.data.data.url, recipientName: 'Test Recipient' });
        expect(done.status, JSON.stringify(done.data)).toBe(200);

        // 6 — Admin shows the final state, its timeline, and the page renders it.
        detail = await orderDetail(order.orderId);
        expect(['DELIVERED', 'COMPLETED']).toContain(detail.status);
        await page.goto(`/order-search/${order.orderId}`);
        await expect(page.getByTestId('order-totals')).toBeVisible();
        await expect(page.getByText(/Delivered/i).first()).toBeVisible();
      } finally {
        await takeOffline(driver);
        await cancelTestOrder(order).catch(() => undefined);
      }
    });
  });
});
