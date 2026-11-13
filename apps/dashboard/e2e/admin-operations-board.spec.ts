import { test, expect } from '@playwright/test';
import { SUPER_ADMIN_STORAGE_STATE } from './env';
import { adminApi, cancelTestOrder, createOnlineDriver, orderDetail, placeNewOrder, placeReadyOrder, takeOffline, withAutomaticDispatch } from './control-tower-fixtures';

/**
 * Operations board (stage 1 of the Admin simplification, 2026-11-13) against the real (isolated) backend: operations staff land on it;
 * a new order is accepted AND set to preparing from its row in one tap; "Ready" from the row; the suggested driver is assigned in one tap;
 * the overview stays one tap away and the choice is remembered.
 */
test.describe('Operations board', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });
  test.setTimeout(120_000);

  test('operations staff land on the board; the overview is one tap away and the choice is remembered', async ({ page }) => {
    await page.goto('/home');
    await expect(page.getByTestId('operations-board')).toBeVisible();
    await page.getByTestId('home-mode-overview').click();
    await expect(page.getByTestId('admin-overview')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('admin-overview')).toBeVisible();
    await page.getByTestId('home-mode-ops').click();
    await expect(page.getByTestId('operations-board')).toBeVisible();
  });

  test('new order → one tap "Accept & start preparing" → one tap "Ready" → one tap "Assign to <suggested>" — each is the real backend change', async ({ page }) => {
    const driver = await createOnlineDriver('Board');
    const order = await placeNewOrder();
    try {
      await withAutomaticDispatch(false, async () => {
        await page.goto('/home');
        await page.getByTestId('home-mode-ops').click();
        await page.getByTestId('board-search').fill(order.orderNumber);
        const row = page.getByTestId(`board-row-${order.orderNumber}`);
        await expect(row).toBeVisible({ timeout: 20_000 });
        await expect(row.getByTestId('board-reason')).toContainText(/New order|Store has not accepted/);

        await row.getByTestId('board-accept-prepare').click();
        await expect(page.getByRole('status').filter({ hasText: `${order.orderNumber}: accepted and preparing` })).toBeVisible();
        await expect.poll(async () => (await orderDetail(order.orderId)).segments.find((s: any) => s.id === order.segmentId)?.status, { timeout: 10_000 }).toBe('PREPARING');

        await page.getByTestId('board-filter-all').click();
        await row.getByTestId('board-ready').click();
        await expect.poll(async () => (await orderDetail(order.orderId)).status, { timeout: 10_000 }).toBe('READY_FOR_PICKUP');

        await page.getByTestId('board-filter-NEEDS_DRIVER').click();
        const assign = row.getByTestId('board-assign-suggested');
        await expect(assign).toBeVisible({ timeout: 20_000 });
        const label = await assign.innerText();
        await assign.click();
        await expect(page.getByRole('status').filter({ hasText: `${order.orderNumber} assigned to` })).toBeVisible();
        expect((await orderDetail(order.orderId)).status).toBe('ASSIGNED_TO_DRIVER');
        const boardRow = ((await adminApi().get('/admin/operations/board')).data.data.items as any[]).find((i) => i.id === order.orderId);
        expect(label).toContain(boardRow.driver.name); // the driver named on the button is the one assigned
      });
    } finally {
      await takeOffline(driver);
      await cancelTestOrder(order);
    }
  });

  test('stage 2: tick three orders → "Assign to…" → search the driver → one tap; within capacity they land, the rest is refused by the backend and stays selected', async ({ page }) => {
    const driver = await createOnlineDriver('Bulk');
    const capacity = await adminApi().patch(`/admin/drivers/${driver.id}/capacity`, { capacity: 2, reason: 'Playwright bulk assignment' });
    expect(capacity.status).toBe(200);
    const orders: Array<{ orderId: string; orderNumber: string; segmentId: string }> = [];
    try {
      await withAutomaticDispatch(false, async () => {
        for (let i = 0; i < 3; i++) orders.push(await placeReadyOrder());
        await page.goto('/home');
        await page.getByTestId('home-mode-ops').click();
        await page.getByTestId('board-filter-NEEDS_DRIVER').click();
        for (const o of orders) {
          const row = page.getByTestId(`board-row-${o.orderNumber}`);
          await expect(row).toBeVisible({ timeout: 20_000 });
          await row.getByTestId('board-select').check();
        }
        await expect(page.getByTestId('board-bulk-count')).toContainText('3 order(s) selected');
        await page.getByTestId('board-bulk-assign').click();
        const picker = page.getByTestId('board-bulk-bar').getByTestId('driver-picker');
        await picker.getByTestId('driver-picker-search').fill(driver.fullName);
        const option = picker.getByTestId(`driver-option-${driver.id}`);
        await expect(option.getByTestId('driver-load')).toHaveText('0/2');
        await expect(option.getByTestId('driver-partial')).toContainText('room for 2 of 3');
        await option.click();
        await expect(page.getByRole('status').filter({ hasText: `2 order(s) assigned to ${driver.fullName}` })).toBeVisible({ timeout: 20_000 });
        await expect(page.getByRole('status').filter({ hasText: 'the driver is full' }).or(page.getByRole('alert').filter({ hasText: 'the driver is full' })).first()).toBeVisible();
        const states = await Promise.all(orders.map(async (o) => (await orderDetail(o.orderId)).status));
        expect(states).toEqual(['ASSIGNED_TO_DRIVER', 'ASSIGNED_TO_DRIVER', 'READY_FOR_PICKUP']); // board order = oldest first among equals
        await expect(page.getByTestId('board-bulk-count')).toContainText('1 order(s) selected');
        await expect(page.getByTestId(`board-row-${orders[2].orderNumber}`).getByTestId('board-select')).toBeChecked();
      });
    } finally {
      await adminApi().patch(`/admin/drivers/${driver.id}/capacity`, { capacity: null, reason: 'Playwright cleanup' });
      await takeOffline(driver);
      for (const o of orders) await cancelTestOrder(o);
    }
  });

  test('stage 2: "Another driver…" opens a searchable ordered list (suggested first, load / capacity) and assigns in one tap', async ({ page }) => {
    const driver = await createOnlineDriver('Picker');
    let order: { orderId: string; orderNumber: string; segmentId: string } | null = null;
    try {
      await withAutomaticDispatch(false, async () => {
        order = await placeReadyOrder();
        await page.goto('/home');
        await page.getByTestId('home-mode-ops').click();
        await page.getByTestId('board-search').fill(order.orderNumber);
        const row = page.getByTestId(`board-row-${order.orderNumber}`);
        await expect(row).toBeVisible({ timeout: 20_000 });
        await row.getByTestId('board-assign-other').click();
        const picker = row.getByTestId('driver-picker');
        await expect(picker.locator('[data-rank="0"]')).toContainText('Suggested');
        await picker.getByTestId('driver-picker-search').fill('no-such-driver-xyz');
        await expect(picker.getByTestId('driver-picker-empty')).toBeVisible();
        await picker.getByTestId('driver-picker-search').fill(driver.fullName);
        await picker.getByTestId(`driver-option-${driver.id}`).click();
        await expect(page.getByRole('status').filter({ hasText: `${order.orderNumber} assigned to ${driver.fullName}` })).toBeVisible();
        expect((await orderDetail(order.orderId)).status).toBe('ASSIGNED_TO_DRIVER');
      });
    } finally {
      await takeOffline(driver);
      if (order) await cancelTestOrder(order);
    }
  });

  test('Arabic: the board reads right-to-left with Arabic actions', async ({ page }) => {
    const order = await placeNewOrder();
    try {
      await page.goto('/home');
      await page.getByRole('button', { name: 'Switch to Arabic' }).click();
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await page.getByTestId('home-mode-ops').click();
      await expect(page.getByRole('heading', { name: 'لوحة التشغيل' })).toBeVisible();
      await page.getByTestId('board-search').fill(order.orderNumber);
      const row = page.getByTestId(`board-row-${order.orderNumber}`);
      await expect(row).toBeVisible({ timeout: 20_000 });
      await expect(row.getByTestId('board-accept-prepare')).toHaveText('قبول وبدء التحضير');
      await expect(row.getByTestId('board-accept')).toHaveText('قبول فقط');
    } finally {
      await page.evaluate(() => localStorage.removeItem('hatly_dashboard_locale')).catch(() => undefined);
      await cancelTestOrder(order);
    }
  });

  test('the board refuses nothing silently: an action the backend rejects shows its message and the board refreshes', async ({ page }) => {
    const order = await placeNewOrder();
    try {
      await page.goto('/home');
      await page.getByTestId('home-mode-ops').click();
      await page.getByTestId('board-search').fill(order.orderNumber);
      const row = page.getByTestId(`board-row-${order.orderNumber}`);
      await expect(row).toBeVisible({ timeout: 20_000 });
      // another operator accepts meanwhile → our "Accept only" is now an invalid transition
      await adminApi().patch(`/admin/orders/segments/${order.segmentId}/status`, { status: 'CONFIRMED' });
      await row.getByTestId('board-accept').click();
      await expect(page.getByRole('alert').first()).toBeVisible();
      // accepted now → no longer "needs action"; under "All live" it shows its real next step
      await page.getByTestId('board-filter-all').click();
      await expect(row.getByTestId('board-prepare')).toBeVisible({ timeout: 15_000 });
    } finally {
      await cancelTestOrder(order);
    }
  });
});
