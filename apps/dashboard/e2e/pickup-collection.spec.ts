import { test, expect, Page } from '@playwright/test';
import { SUPER_ADMIN_STORAGE_STATE, VENDOR_A_PRODUCT_ID, VENDOR_A_STORAGE_STATE, VENDOR_B_STORAGE_STATE } from './env';
import { adminApi, vendorApi } from './control-tower-fixtures';
import { registerCustomerApi } from './hatly-service-fixtures';

/**
 * U2 (approved) — a PICKUP order is completed when the customer collects it at the branch: the branch's vendor staff mark it
 * COLLECTED (terminal); an admin with MANAGE_ORDER_ISSUES can do it as a support fallback. Real browser, REAL dev backend:
 * the order is placed by a real customer (cash — the only method a pickup allows) and prepared by the Vendor A manager.
 * Only the "admin without the permission" case intercepts the permissions response (a SUPER_ADMIN session holds them all);
 * the real 403 is proven in the backend e2e suite (86-pickup-collection-and-redispatch). An order a test leaves READY is
 * cancelled by the vendor in `finally`; a COLLECTED order is a completed order and stays as such.
 */
const ME_URL = /\/admin\/me\/permissions$/;
const STATUS_URL = /\/api\/v1\/orders\/[0-9a-f-]+\/status$/;

async function placeReadyPickupOrder(): Promise<{ orderId: string; orderNumber: string; segmentId: string }> {
  const customer = await registerCustomerApi();
  await customer.delete('/cart');
  const must = (res: { status: number; data: any }, what: string) => {
    if (res.status >= 300) throw new Error(`${what}: HTTP ${res.status} ${JSON.stringify(res.data)}`);
    return res.data?.data;
  };
  must(await customer.post('/cart/items', { productId: VENDOR_A_PRODUCT_ID, quantity: 1 }), 'add to cart');
  must(await customer.patch('/cart/fulfillment-type', { fulfillmentType: 'PICKUP' }), 'pickup');
  const order = must(await customer.post('/orders', { paymentMethod: 'COD' }), 'place pickup order');
  const segmentId = order.segments[0].id;
  for (const status of ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP']) {
    must(await vendorApi().patch(`/vendor/orders/segments/${segmentId}/status`, { status }), `vendor → ${status}`);
  }
  return { orderId: order.id, orderNumber: order.orderNumber, segmentId };
}
const backendStatus = async (orderId: string) => (await adminApi().get(`/admin/orders/${orderId}`)).data.data.status as string;
async function cancelIfStillReady(order: { orderId: string; segmentId: string }) {
  if ((await backendStatus(order.orderId)) === 'READY_FOR_PICKUP') {
    await vendorApi().patch(`/vendor/orders/segments/${order.segmentId}/status`, { status: 'CANCELLED' });
  }
}

test.describe('Vendor — the customer collected a pickup order', () => {
  test.use({ storageState: VENDOR_A_STORAGE_STATE });

  async function openOrder(page: Page, orderId: string) {
    await page.goto(`/orders/${orderId}`);
    await expect(page.getByTestId('vendor-order-status')).toBeVisible();
  }

  test('ready pickup: the vendor confirms, the order becomes COLLECTED and the action disappears', async ({ page }) => {
    const order = await placeReadyPickupOrder();
    try {
      await openOrder(page, order.orderId);
      await expect(page.getByTestId('vendor-pickup-ready')).toContainText('waiting for the customer to collect it');
      await expect(page.getByTestId('vendor-pickup-ready')).toContainText('pays you in cash');
      page.once('dialog', (d) => d.accept());
      const [res] = await Promise.all([
        page.waitForResponse((r) => STATUS_URL.test(r.url()) && r.request().method() === 'PATCH'),
        page.getByTestId('vendor-mark-collected').click(),
      ]);
      expect(res.status()).toBe(200);
      await expect(page.getByTestId('vendor-order-collected')).toHaveText('Order marked as collected.');
      await expect(page.getByTestId('vendor-order-status')).toHaveText('COLLECTED');
      await expect(page.getByTestId('vendor-mark-collected')).toHaveCount(0);
      // the segment still reads READY_FOR_PICKUP, but the order is complete: no "Cancel" the backend would refuse
      await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
      await expect(page.getByText('No further action available.')).toBeVisible();
      expect(await backendStatus(order.orderId)).toBe('COLLECTED');
    } finally {
      await cancelIfStillReady(order);
    }
  });

  test('dismissing the confirmation sends nothing; a double click sends exactly ONE request', async ({ page }) => {
    const order = await placeReadyPickupOrder();
    try {
      await openOrder(page, order.orderId);
      let patches = 0;
      page.on('request', (r) => r.method() === 'PATCH' && STATUS_URL.test(r.url()) && patches++);
      page.once('dialog', (d) => d.dismiss());
      await page.getByTestId('vendor-mark-collected').click();
      expect(patches).toBe(0);
      expect(await backendStatus(order.orderId)).toBe('READY_FOR_PICKUP');

      page.on('dialog', (d) => d.accept());
      await page.getByTestId('vendor-mark-collected').dblclick();
      await expect(page.getByTestId('vendor-order-collected')).toBeVisible();
      expect(patches).toBe(1);
      await expect(page.locator('.border-red-200')).toHaveCount(0); // no misleading failure for the absorbed second click
    } finally {
      await cancelIfStillReady(order);
    }
  });

  test('stale page: someone else already completed it — the backend refusal is shown and the page re-reads the truth', async ({ page }) => {
    const order = await placeReadyPickupOrder();
    try {
      await openOrder(page, order.orderId);
      await expect(page.getByTestId('vendor-mark-collected')).toBeVisible();
      const meanwhile = await adminApi().patch(`/orders/${order.orderId}/status`, { status: 'COLLECTED' }); // the admin fallback, from another screen
      expect(meanwhile.status).toBe(200);
      page.once('dialog', (d) => d.accept());
      const [res] = await Promise.all([
        page.waitForResponse((r) => STATUS_URL.test(r.url())),
        page.getByTestId('vendor-mark-collected').click(),
      ]);
      expect(res.status()).toBe(400);
      await expect(page.getByText('Cannot transition order from COLLECTED to COLLECTED.')).toBeVisible();
      await expect(page.getByTestId('vendor-order-status')).toHaveText('COLLECTED');
      await expect(page.getByTestId('vendor-mark-collected')).toHaveCount(0);
    } finally {
      await cancelIfStillReady(order);
    }
  });
});

test.describe('Vendor isolation — another branch cannot see or collect it', () => {
  test.use({ storageState: VENDOR_B_STORAGE_STATE });

  test("vendor B opening vendor A's pickup order gets the backend's not-found answer and no collect action", async ({ page }) => {
    const order = await placeReadyPickupOrder();
    try {
      await page.goto(`/orders/${order.orderId}`);
      await expect(page.getByText('Order not found.')).toBeVisible();
      await expect(page.getByTestId('vendor-mark-collected')).toHaveCount(0);
      expect(await backendStatus(order.orderId)).toBe('READY_FOR_PICKUP');
    } finally {
      await cancelIfStillReady(order);
    }
  });
});

test.describe('Admin — pickup collection fallback', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  test('an admin with MANAGE_ORDER_ISSUES marks it collected from the order detail; the timeline shows it, no driver/dispatch controls', async ({ page }) => {
    const order = await placeReadyPickupOrder();
    try {
      await page.goto(`/order-search/${order.orderId}`);
      const ops = page.getByTestId('order-operations');
      await expect(ops).toContainText('the customer collects it at the branch');
      await expect(ops.getByTestId('dispatch-submit')).toHaveCount(0);
      page.once('dialog', (d) => d.accept());
      const [res] = await Promise.all([page.waitForResponse((r) => STATUS_URL.test(r.url())), ops.getByTestId('od-mark-collected').click()]);
      expect(res.status()).toBe(200);
      await expect(ops.getByTestId('od-collected')).toHaveText(`${order.orderNumber} marked as collected.`);
      await expect(page.getByTestId('od-timeline').locator('li').last()).toContainText('COLLECTED');
      await expect(ops.getByTestId('od-mark-collected')).toHaveCount(0);
      expect(await backendStatus(order.orderId)).toBe('COLLECTED');
    } finally {
      await cancelIfStillReady(order);
    }
  });

  test('an admin WITHOUT MANAGE_ORDER_ISSUES sees no collect action, only why', async ({ page }) => {
    const order = await placeReadyPickupOrder();
    try {
      await page.route(ME_URL, (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { role: 'ADMIN', permissions: ['VIEW_ORDERS'] } }) }),
      );
      await page.goto(`/order-search/${order.orderId}`);
      const ops = page.getByTestId('order-operations');
      await expect(ops).toContainText('Only the branch, or an admin with the order-issues permission, can mark it collected.');
      await expect(ops.getByTestId('od-mark-collected')).toHaveCount(0);
    } finally {
      await cancelIfStillReady(order);
    }
  });

  test('order search can filter COLLECTED orders (filtered by the backend)', async ({ page }) => {
    await page.goto('/order-search?status=COLLECTED');
    const [request] = await Promise.all([
      page.waitForRequest((r) => /\/admin\/orders\?/.test(r.url()) && new URL(r.url()).searchParams.get('status') === 'COLLECTED'),
      page.reload(),
    ]);
    expect(new URL(request.url()).searchParams.get('status')).toBe('COLLECTED');
    const rows = page.locator('tbody tr');
    const n = await rows.count();
    for (let i = 0; i < n; i++) await expect(rows.nth(i)).toContainText('COLLECTED');
  });

  test('Arabic: the admin collect action is translated', async ({ page }) => {
    const order = await placeReadyPickupOrder();
    try {
      await page.goto(`/order-search/${order.orderId}?lang=ar`);
      await expect(page.getByTestId('od-mark-collected')).toHaveText('تأكيد الاستلام (دعم)');
    } finally {
      await cancelIfStillReady(order);
    }
  });
});
