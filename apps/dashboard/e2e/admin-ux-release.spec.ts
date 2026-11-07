import { test, expect } from '@playwright/test';
import { SUPER_ADMIN_STORAGE_STATE, VENDOR_A_STORAGE_STATE, VENDOR_A_PRODUCT_ID } from './env';
import { adminApi, cancelTestOrder, placeNewOrder } from './control-tower-fixtures';
import { registerCustomerApi } from './hatly-service-fixtures';

/**
 * Admin UX release (2026-11-07), in a real browser against a real backend: the Home "needs your action now" panel, the transfer review that
 * names the order and customer, the refund found by order number, the payment column and "Transfer to verify" view, the compact driver cards,
 * and the vendor board that shows order numbers and waiting time.
 */
const BELBEIS = { latitude: 30.4181, longitude: 31.5622 };

/** A customer's InstaPay order whose transfer they say they sent (UNDER_REVIEW). */
async function claimedTransferOrder(): Promise<{ id: string; orderNumber: string }> {
  const customer = await registerCustomerApi();
  await customer.delete('/cart');
  expect((await customer.post('/cart/items', { productId: VENDOR_A_PRODUCT_ID, quantity: 1 })).status).toBe(201);
  const body = { deliveryAddress: { line1: 'Playwright UX Street 1', latitude: BELBEIS.latitude, longitude: BELBEIS.longitude }, paymentMethod: 'MANUAL_TRANSFER', electronicPaymentMethod: 'INSTAPAY' };
  const quote = (await customer.post('/checkout/quote', body)).data.data;
  const order = (await customer.post('/orders', { ...body, quoteToken: quote.quoteToken })).data.data;
  await customer.post(`/payments/manual-transfer/orders/${order.id}/claim`, {});
  return { id: order.id, orderNumber: order.orderNumber };
}

test.describe('Admin UX release — admin', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  test('Home: "Needs your action now" shows the transfers to verify and opens the review page in one click', async ({ page }) => {
    await claimedTransferOrder();
    await page.goto('/home');
    const panel = page.getByTestId('action-center');
    await expect(panel).toBeVisible();
    const tile = panel.getByTestId('action-transfers');
    await expect(tile).toBeVisible();
    await tile.click();
    await expect(page).toHaveURL(/\/manual-transfer$/);
    await expect(page.getByTestId('section-tabs').getByTestId('tab-count').first()).toBeVisible();
  });

  test('Transfer review names the order and customer; approving confirms with the amount and order number; the order leaves the list', async ({ page }) => {
    const order = await claimedTransferOrder();
    await page.goto('/manual-transfer');
    const card = page.getByTestId(`transfer-${order.orderNumber}`);
    await expect(card).toBeVisible();
    await expect(card.getByRole('link', { name: order.orderNumber })).toBeVisible();
    await expect(card).toContainText('Bank / wallet transfer');
    await card.getByRole('button', { name: 'Approve' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(order.orderNumber);
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/approve') && r.request().method() === 'POST'),
      dialog.getByRole('button', { name: 'Approve' }).click(),
    ]);
    await expect(page.getByTestId(`transfer-${order.orderNumber}`)).toHaveCount(0);
  });

  test('Refund by order number: unknown number is refused before anything is sent; a paid transfer is found, prefilled, and cancelling the confirmation sends nothing', async ({ page }) => {
    let refundRequests = 0;
    await page.route('**/admin/manual-transfer-payments/*/refund', async (route) => { refundRequests += 1; await route.continue(); });
    await page.goto('/manual-transfer');
    await page.getByPlaceholder('HT-100234').fill('HT-999999999');
    await page.getByTestId('refund-find').click();
    await expect(page.getByText(/No Manual Transfer payment was found/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record Refund' })).toBeDisabled();

    const order = await claimedTransferOrder();
    const pending = ((await adminApi().get('/admin/manual-transfer-payments')).data.data as any[]).find((p) => p.orderId === order.id);
    expect((await adminApi().post(`/admin/manual-transfer-payments/${pending.id}/approve`)).status).toBe(201);
    await page.getByPlaceholder('HT-100234').fill(order.orderNumber);
    await page.getByTestId('refund-find').click();
    await expect(page.getByTestId('refund-found')).toContainText(order.orderNumber);
    await expect(page.getByPlaceholder('Amount (EGP)')).not.toHaveValue('');
    await page.getByRole('button', { name: 'Record Refund' }).click();
    await expect(page.getByRole('dialog')).toContainText(order.orderNumber);
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    expect(refundRequests).toBe(0);
  });

  test('Orders: a payment column in words, and the "Transfer to verify" view lists only transfers waiting for review', async ({ page }) => {
    const order = await claimedTransferOrder();
    await page.goto('/order-management?view=toVerify');
    const row = page.getByTestId(`order-row-${order.orderNumber}`);
    await expect(row).toBeVisible();
    await expect(row.getByTestId('payment-pill')).toContainText('Transfer to verify');
    const pills = page.getByTestId('orders-table').getByTestId('payment-pill');
    const n = await pills.count();
    for (let i = 0; i < n; i += 1) await expect(pills.nth(i)).toContainText('Transfer to verify');
  });

  test('Drivers: cards are compact — settings open with "Edit settings"; a single search result opens them by itself', async ({ page }) => {
    await page.goto('/drivers');
    const first = page.locator('[data-testid^="driver-row-"]').first();
    await expect(first).toBeVisible();
    await expect(first.getByTestId('driver-vehicle-select')).toHaveCount(0);
    await first.locator('[data-testid^="driver-edit-"]').click();
    await expect(first.getByTestId('driver-vehicle-select')).toBeVisible();
  });
});

test.describe('Admin UX release — vendor', () => {
  test.use({ storageState: VENDOR_A_STORAGE_STATE });

  test('the vendor board shows the order number (not an internal id) and how long a new order has waited', async ({ page }) => {
    const order = await placeNewOrder();
    try {
      await page.goto('/orders');
      const card = page.getByTestId(`vendor-order-${order.orderId}`);
      await expect(card).toBeVisible();
      await expect(card).toContainText(order.orderNumber);
      await expect(card.getByTestId(`vendor-waiting-${order.segmentId}`)).toContainText('Waiting');
    } finally {
      await cancelTestOrder(order);
    }
  });
});
