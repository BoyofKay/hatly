import { test, expect } from '@playwright/test';
import { SUPER_ADMIN_STORAGE_STATE, VENDOR_A_STORAGE_STATE, VENDOR_A_PRODUCT_ID } from './env';
import { adminApi, createOnlineDriver, takeOffline } from './control-tower-fixtures';
import { registerCustomerApi } from './hatly-service-fixtures';

/**
 * Decision register release 1 (2026-11-06), in a real browser against a real backend: the driver commission editor (R28), the
 * acknowledgement window setting (R16), and InstaPay / Vodafone Cash orders hidden from the vendor until verified (R2).
 */
const BELBEIS = { latitude: 30.4181, longitude: 31.5622 };

test.describe('Release 1 — admin', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  test('R28: the Drivers page edits a driver commission (stored in basis points); an invalid percentage is refused before sending', async ({ page }) => {
    const driver = await createOnlineDriver('Commission');
    try {
      await page.goto(`/drivers?search=${encodeURIComponent(driver.fullName)}`);
      const card = page.getByTestId(`driver-row-${driver.id}`);
      await expect(card.getByTestId('driver-commission-unset')).toBeVisible();
      const input = card.getByTestId('driver-commission-input');
      await input.fill('150');
      await expect(card.getByTestId('driver-commission-save')).toBeDisabled();
      await input.fill('10');
      const [res] = await Promise.all([
        page.waitForResponse((r) => r.url().includes(`/admin/drivers/${driver.id}/commission-rate`) && r.request().method() === 'PATCH'),
        card.getByTestId('driver-commission-save').click(),
      ]);
      expect(res.status()).toBe(200);
      const list = (await adminApi().get('/admin/drivers')).data.data as any[];
      expect(list.find((d) => d.id === driver.id)?.commissionRateBasisPoints).toBe(1000);
    } finally {
      await takeOffline(driver);
    }
  });

  test('R16: Settings shows the acknowledgement window; 12 is saved, 45 is refused by the backend; reset to the default 5 afterwards', async ({ page }) => {
    try {
      await page.goto('/settings');
      const input = page.getByTestId('config-input-DISPATCH_ACKNOWLEDGEMENT_WINDOW_MINUTES');
      await expect(input).toBeVisible();
      await expect(page.getByText('Driver Acknowledgement Window')).toBeVisible();
      expect((await adminApi().put('/admin/business-config/DISPATCH_ACKNOWLEDGEMENT_WINDOW_MINUTES', { value: 45 }).catch((e) => e.response)).status).toBe(400);
      expect((await adminApi().put('/admin/business-config/DISPATCH_ACKNOWLEDGEMENT_WINDOW_MINUTES', { value: 12 })).status).toBe(200);
      await page.reload();
      await expect(page.getByTestId('config-input-DISPATCH_ACKNOWLEDGEMENT_WINDOW_MINUTES')).toHaveValue('12');
    } finally {
      await adminApi().put('/admin/business-config/DISPATCH_ACKNOWLEDGEMENT_WINDOW_MINUTES', { value: 5 }).catch(() => undefined);
    }
  });
});

test.describe('Release 1 — vendor', () => {
  test.use({ storageState: VENDOR_A_STORAGE_STATE });

  test('R2: an InstaPay order is not on the vendor board until Operations verify it; then it appears', async ({ page }) => {
    const customer = await registerCustomerApi();
    await customer.delete('/cart');
    expect((await customer.post('/cart/items', { productId: VENDOR_A_PRODUCT_ID, quantity: 1 })).status).toBe(201);
    const deliveryAddress = { line1: 'Playwright Transfer Street 1', latitude: BELBEIS.latitude, longitude: BELBEIS.longitude };
    const body = { deliveryAddress, paymentMethod: 'MANUAL_TRANSFER', electronicPaymentMethod: 'INSTAPAY' };
    const quote = (await customer.post('/checkout/quote', body)).data.data;
    const order = (await customer.post('/orders', { ...body, quoteToken: quote.quoteToken })).data.data;
    expect(order?.id).toBeTruthy();

    await page.goto('/orders');
    await expect(page.getByTestId('vendor-board')).toBeVisible();
    await expect(page.getByTestId(`vendor-order-${order.id}`)).toHaveCount(0);
    const direct = await page.request.get(`${process.env.PLAYWRIGHT_API_BASE_URL ?? 'http://localhost:3000/api/v1'}/vendor/orders/${order.id}`);
    expect([401, 404]).toContain(direct.status()); // never the order

    await customer.post(`/payments/manual-transfer/orders/${order.id}/claim`, {});
    const pending = ((await adminApi().get('/admin/manual-transfer-payments')).data.data as any[]).find((p) => p.orderId === order.id);
    expect(pending).toBeTruthy();
    expect((await adminApi().post(`/admin/manual-transfer-payments/${pending.id}/approve`)).status).toBe(201);

    await page.reload();
    await expect(page.getByTestId(`vendor-order-${order.id}`).first()).toBeVisible();
  });
});

test.describe('Release 2A — admin settings', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  test('R21: the Transfer Verification Window can be set (60) and cleared back to "off"; an out-of-range value is refused', async ({ page }) => {
    const key = 'MANUAL_TRANSFER_VERIFICATION_WINDOW_MINUTES';
    try {
      await page.goto('/settings');
      const input = page.getByTestId(`config-input-${key}`);
      await expect(input).toBeVisible();
      await input.fill('5');
      await input.locator('xpath=..').getByRole('button', { name: 'Save' }).click();
      await expect(page.getByText('15 to 10080', { exact: false }).first()).toBeVisible();
      await input.fill('60');
      await input.locator('xpath=..').getByRole('button', { name: 'Save' }).click();
      await expect(input.locator('xpath=..').getByText('Saved')).toBeVisible();
      // (no extra API read here: the Settings page already spends most of the per-route read limit)
      await page.getByTestId(`config-clear-${key}`).click();
      await expect(input).toHaveValue('');
      await expect(input.locator('xpath=..').getByText('Saved')).toBeVisible();
    } finally {
      await adminApi().delete(`/admin/business-config/${key}`).catch(() => undefined);
    }
  });
});

test.describe('Release 2B — store requests (R8/R44)', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  test('a vendor pause request appears on Store Requests; approving it closes the store; a reopen request restores it', async ({ page }) => {
    const { vendorApi } = await import('./control-tower-fixtures');
    const { VENDOR_A_BRANCH_ID } = await import('./env');
    const branchState = async () => (await adminApi().get(`/admin/vendor-branches/${VENDOR_A_BRANCH_ID}`)).data?.data?.isOpen;
    if ((await branchState()) === false) await adminApi().patch(`/admin/vendor-branches/${VENDOR_A_BRANCH_ID}/open`);
    const paused = await vendorApi().patch(`/vendor/branches/${VENDOR_A_BRANCH_ID}`, { isOpen: false, reason: 'Playwright pause' });
    expect(paused.status).toBe(200);
    expect(paused.data.data.isOpen).toBe(true); // nothing changes before Hatly approves
    const requestId = paused.data.data.requests[0].id;
    try {
      await page.goto('/branch-requests');
      const row = page.getByTestId(`branch-request-${requestId}`);
      await expect(row).toContainText('Pause the store');
      await row.getByTestId(`approve-${requestId}`).click();
      await expect(page.getByTestId(`branch-request-${requestId}`)).toHaveCount(0); // left the waiting list
      expect(await branchState()).toBe(false);

      const reopen = await vendorApi().patch(`/vendor/branches/${VENDOR_A_BRANCH_ID}`, { isOpen: true });
      const reopenId = reopen.data.data.requests[0].id;
      await page.reload();
      await page.getByTestId(`approve-${reopenId}`).click();
      await expect(page.getByTestId(`branch-request-${reopenId}`)).toHaveCount(0);
      expect(await branchState()).toBe(true);
    } finally {
      await adminApi().patch(`/admin/vendor-branches/${VENDOR_A_BRANCH_ID}/open`).catch(() => undefined);
      await vendorApi().post(`/vendor/branches/${VENDOR_A_BRANCH_ID}/change-requests/${requestId}/withdraw`).catch(() => undefined);
    }
  });
});
