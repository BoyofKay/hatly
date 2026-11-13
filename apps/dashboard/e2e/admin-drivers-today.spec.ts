import { test, expect } from '@playwright/test';
import { SUPER_ADMIN_STORAGE_STATE } from './env';
import { adminApi, createOnlineDriver, ensureAssignedTo, placeReadyOrder, takeOffline, TestDriver, withAutomaticDispatch } from './control-tower-fixtures';

/**
 * Stage 3 of the Admin simplification (2026-11-13): "Drivers today" — a real COD order delivered by a real courier, then closed from the row
 * with the cash handed over recorded in the same step (approved shortcut). Two records result — the closing (its reference) and a CASH
 * payment on it — each through its existing endpoint; the figures on screen are compared with the backend's own.
 */
async function deliveredCodOrder(): Promise<{ driver: TestDriver; orderId: string; orderNumber: string }> {
  return withAutomaticDispatch(false, async () => {
    const driver = await createOnlineDriver('Today');
    const r = await adminApi().patch(`/admin/drivers/${driver.id}/commission-rate`, { commissionRateBasisPoints: 2500 });
    if (r.status !== 200) throw new Error(`commission rate: ${r.status} ${JSON.stringify(r.data)}`);
    const order = await placeReadyOrder();
    await ensureAssignedTo(order.orderId, driver);
    const deliveries = (await driver.api.get('/driver/deliveries', { params: { scope: 'active' } })).data.data as any[];
    const delivery = deliveries.find((d) => d.orderId === order.orderId);
    for (const status of ['PICKED_UP', 'ON_THE_WAY', 'DELIVERED']) {
      const res = await driver.api.patch(`/driver/deliveries/${delivery.id}/status`, { status });
      if (res.status !== 200) throw new Error(`${status}: ${res.status} ${JSON.stringify(res.data)}`);
    }
    return { driver, orderId: order.orderId, orderNumber: order.orderNumber };
  });
}
const todayRow = async (driverId: string) => ((await adminApi().get('/admin/settlement/couriers/today')).data.data as any[]).find((r) => r.id === driverId);
const egp = (minor: number) => (minor / 100).toFixed(2);

test.describe('Drivers today', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });
  test.setTimeout(120_000);

  test('row → "Close shift" → the cash due is pre-filled → "Close and record the cash received" → confirm: one closing and one CASH payment, nothing left', async ({ page }) => {
    const { driver } = await deliveredCodOrder();
    try {
      const before = await todayRow(driver.id);
      const owed = -before.open.netToCourierMinor;
      expect(owed).toBeGreaterThan(0); // COD: the courier owes the commission only

      await page.goto('/drivers-today');
      await page.getByTestId('dt-search').fill(driver.fullName);
      const row = page.getByTestId(`dt-row-${driver.id}`);
      await expect(row.getByTestId('dt-open')).toContainText('Owed by the courier');
      await expect(row.getByTestId('dt-open')).toContainText(egp(owed));
      await row.getByTestId('dt-close').click();

      const panel = page.getByTestId('dt-panel');
      await expect(panel.getByTestId('dt-totals-net')).toContainText(egp(owed));
      await expect(panel.getByTestId('dt-cash-toggle')).toBeChecked();
      await expect(panel.getByTestId('dt-cash-amount')).toHaveValue(egp(owed));
      await expect(panel.getByTestId('dt-submit')).toHaveText('Close and record the cash received');
      await panel.getByTestId('dt-submit').click();
      await expect(panel.getByTestId('dt-confirm-box')).toContainText(`receive`);
      await panel.getByTestId('dt-confirm').click();

      await expect(panel.getByTestId('dt-reference')).toHaveText(/^CS-\d{8}-[0-9A-F]{6}$/);
      await expect(panel.getByTestId('dt-paid')).toContainText('recorded on');
      const reference = await panel.getByTestId('dt-reference').innerText();

      const after = await todayRow(driver.id);
      expect(after.open.orders).toBe(0);
      expect(after.lastClosing.reference).toBe(reference);
      expect(after.unpaidClosings).toEqual([]); // paid in full at the desk
    } finally {
      await takeOffline(driver);
    }
  });

  test('a partial cash amount leaves the rest due on that closing; more than due cannot be submitted', async ({ page }) => {
    const { driver } = await deliveredCodOrder();
    try {
      const owed = -(await todayRow(driver.id)).open.netToCourierMinor;
      await page.goto('/drivers-today');
      await page.getByTestId('dt-search').fill(driver.fullName);
      await page.getByTestId(`dt-row-${driver.id}`).getByTestId('dt-close').click();
      const panel = page.getByTestId('dt-panel');
      const amount = panel.getByTestId('dt-cash-amount');
      await amount.fill(egp(owed + 100));
      await expect(panel.getByTestId('dt-cash-invalid')).toBeVisible();
      await expect(panel.getByTestId('dt-submit')).toBeDisabled();
      const part = Math.floor(owed / 2);
      await amount.fill(egp(part));
      await panel.getByTestId('dt-submit').click();
      await panel.getByTestId('dt-confirm').click();
      await expect(panel.getByTestId('dt-paid')).toBeVisible();
      const after = await todayRow(driver.id);
      expect(after.unpaidClosings).toEqual([expect.objectContaining({ direction: 'COLLECTION', remainingMinor: owed - part })]);
      // the drawer and the row now show the remainder as unpaid on an earlier closing
      await page.keyboard.press('Escape');
      await expect(page.getByTestId(`dt-row-${driver.id}`).getByTestId('dt-unpaid')).toContainText(egp(owed - part));
    } finally {
      await takeOffline(driver);
    }
  });

  test('Arabic: the page and the one-step action read in Arabic', async ({ page }) => {
    const { driver } = await deliveredCodOrder();
    try {
      await page.goto('/drivers-today');
      await page.getByRole('button', { name: 'Switch to Arabic' }).click();
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByRole('heading', { name: 'المندوبون اليوم' })).toBeVisible();
      await page.getByTestId('dt-search').fill(driver.fullName);
      await page.getByTestId(`dt-row-${driver.id}`).getByTestId('dt-close').click();
      await expect(page.getByTestId('dt-submit')).toHaveText('تقفيل وتسجيل الاستلام');
      await expect(page.getByTestId('dt-cash')).toContainText('استلمت المبلغ من المندوب نقدًا الآن');
    } finally {
      await page.evaluate(() => localStorage.removeItem('hatly_dashboard_locale')).catch(() => undefined);
      await takeOffline(driver);
    }
  });
});
