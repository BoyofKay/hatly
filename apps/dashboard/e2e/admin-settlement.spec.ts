import { test, expect, Page } from '@playwright/test';
import { SUPER_ADMIN_STORAGE_STATE, VENDOR_A_BRANCH_ID } from './env';
import { adminApi, createOnlineDriver, ensureAssignedTo, placeReadyOrder, takeOffline, TestDriver, withAutomaticDispatch } from './control-tower-fixtures';

/**
 * Courier shift closing, store period closing, statements and history (2026-11-13) — against the real (isolated) backend.
 * A real COD order is delivered by a real courier WITHOUT a photo, then closed from the Admin: preview → review → confirm → reference →
 * saved statement → history search. The figures on screen are the backend's; the tests compare them with the API's own preview.
 */
async function deliveredCodOrder(): Promise<{ driver: TestDriver; orderId: string; orderNumber: string }> {
  return withAutomaticDispatch(false, async () => {
    const driver = await createOnlineDriver('Closing');
    const r = await adminApi().patch(`/admin/drivers/${driver.id}/commission-rate`, { commissionRateBasisPoints: 2500 });
    if (r.status !== 200) throw new Error(`commission rate: ${r.status} ${JSON.stringify(r.data)}`);
    const order = await placeReadyOrder();
    await ensureAssignedTo(order.orderId, driver);
    const deliveries = (await driver.api.get('/driver/deliveries', { params: { scope: 'active' } })).data.data as any[];
    const delivery = deliveries.find((d) => d.orderId === order.orderId);
    for (const status of ['PICKED_UP', 'ON_THE_WAY', 'DELIVERED']) {
      const res = await driver.api.patch(`/driver/deliveries/${delivery.id}/status`, { status }); // no photo (optional)
      if (res.status !== 200) throw new Error(`${status}: ${res.status} ${JSON.stringify(res.data)}`);
    }
    return { driver, orderId: order.orderId, orderNumber: order.orderNumber };
  });
}

const pickCourier = async (page: Page, driver: TestDriver) => {
  await page.getByTestId('courier-picker').getByRole('textbox').fill(driver.fullName);
  await page.getByTestId(`courier-picker-${driver.id}`).click();
};

test.describe('Courier shift closing', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });
  test.setTimeout(90_000);

  test('COD order: preview shows goods excluded and "owed by the courier" = the commission; dismissing sends nothing; confirming gives a reference, a statement, and history finds it', async ({ page }) => {
    const { driver, orderId, orderNumber } = await deliveredCodOrder();
    const preview = (await adminApi().get(`/admin/settlement/drivers/${driver.id}/close-preview`)).data.data;
    const line = preview.lines.find((l: any) => l.orderId === orderId);
    expect(line).toMatchObject({ paymentFlow: 'COD', goodsReimbursementMinor: 0, netToCourierMinor: -line.commissionMinor });

    let closeSent = false;
    await page.route('**/admin/settlement/drivers/*/close', async (route) => { closeSent = true; await route.continue(); });
    await page.goto('/settlement');
    await pickCourier(page, driver);
    const card = page.getByTestId('courier-preview');
    await expect(card).toBeVisible();
    await expect(page.getByRole('link', { name: orderNumber })).toBeVisible();
    await expect(page.getByTestId('courier-preview-totals-net')).toContainText('Owed by the courier');
    await expect(page.getByTestId('part-goodsPassThroughMinor')).toContainText('excluded from the net');
    await expect(page.getByTestId('part-goodsReimbursementMinor')).toBeVisible(); // shown as 0 — never a goods payable for COD
    await expect(page.getByTestId('part-cashHeldMinor')).toBeVisible();

    await page.getByTestId('courier-confirm').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    expect(closeSent).toBe(false);

    await page.getByTestId('courier-confirm').click();
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().includes(`/admin/settlement/drivers/${driver.id}/close`) && r.request().method() === 'POST'),
      page.getByRole('dialog').getByRole('button', { name: 'Close the shift' }).click(),
    ]);
    expect(res.status()).toBe(201);
    const closed = (await res.json()).data;
    expect(closed.netPayableMinor).toBe(preview.totals.netToCourierMinor);
    await expect(page.getByTestId('courier-closed')).toContainText(closed.reference);

    await page.getByRole('link', { name: /Open the saved statement/ }).click();
    await expect(page.getByTestId('period-breakdown')).toBeVisible();
    await expect(page.getByTestId('period-breakdown-net')).toContainText('Owed by the courier');

    await page.goto('/settlements');
    await page.getByRole('tab', { name: 'Drivers' }).click();
    await page.getByTestId('settlements-search').fill(closed.reference);
    await expect(page.getByRole('cell', { name: closed.reference })).toBeVisible(); // the search found exactly this closing

    await takeOffline(driver);
  });

  test('Arabic: the closing page and the statement read right-to-left with the approved labels', async ({ page }) => {
    const { driver } = await deliveredCodOrder();
    await page.goto('/settlement');
    await page.getByRole('button', { name: 'Switch to Arabic' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('tab', { name: 'تقفيل وردية المندوب' })).toBeVisible();
    await pickCourier(page, driver);
    await expect(page.getByTestId('courier-preview-totals-net')).toContainText('مستحق على المندوب');
    await expect(page.getByTestId('courier-preview-totals')).toContainText('عمولة Hatly');
    await expect(page.getByTestId('courier-preview-totals')).toContainText('رسوم التوصيل');
    await expect(page.getByTestId('courier-preview-totals')).toContainText('تعويض المندوب');
    await expect(page.getByTestId('courier-preview-totals')).toContainText('النقدية المحصلة من العميل');
    await page.goto('/settlement-statements');
    await expect(page.getByRole('heading', { name: 'الكشوف حسب الفترة' })).toBeVisible();
    await page.evaluate(() => localStorage.removeItem('hatly_dashboard_locale'));
    await takeOffline(driver);
  });
});

test.describe('Store period closing', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  test('preview shows parts, sales and the commission owed by the store; dismissing the confirmation sends nothing', async ({ page }) => {
    let closeSent = false;
    await page.route('**/admin/settlement/vendor-branches/*/close', async (route) => { closeSent = true; await route.continue(); });
    await page.goto('/settlement');
    await page.getByRole('tab', { name: 'Store period closing' }).click();
    await page.getByTestId(`branch-picker-${VENDOR_A_BRANCH_ID}`).click();
    await expect(page.getByTestId('vendor-preview')).toBeVisible();
    const api = (await adminApi().get(`/admin/settlement/vendor-branches/${VENDOR_A_BRANCH_ID}/close-preview`)).data.data;
    await expect(page.getByTestId('vendor-preview-commission')).toContainText((api.totals.commissionOwedByVendorMinor / 100).toFixed(2));
    if (api.lines.length > 0) {
      await page.getByTestId('vendor-confirm').click();
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    }
    expect(closeSent).toBe(false);
  });
});
