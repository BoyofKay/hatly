import { test, expect, Page } from '@playwright/test';
import { SUPER_ADMIN_STORAGE_STATE } from './env';
import {
  TestDriver,
  cancelTestOrder,
  createOnlineDriver,
  ensureAssignedTo,
  orderDetail,
  placeReadyOrder,
  reassignViaApi,
  releaseByDriver,
  takeOffline,
  withAutomaticDispatch,
} from './control-tower-fixtures';

/**
 * Admin Control Tower — real browser, REAL dev backend and database. Orders, drivers, assignment and the driver's own release
 * all go through the product's real endpoints (see control-tower-fixtures.ts). The only intercepted responses are the ones a
 * SUPER_ADMIN session cannot produce on its own (an ADMIN without ASSIGN_REASSIGN_ORDERS, a server error, a slow response);
 * the real 403/409s are proven in the backend e2e suite (test/e2e/83-control-tower). Every test cleans up after itself:
 * its order is handed back and cancelled by the vendor, its drivers go offline.
 */
const ME_URL = /\/admin\/me\/permissions$/;
const REASSIGN_URL = /\/admin\/orders\/[0-9a-f-]+\/reassign-driver$/;
const ASSIGN_URL = /\/admin\/orders\/[0-9a-f-]+\/assign-driver$/;

test.describe('Admin — Control Tower', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });
  test.setTimeout(90_000);

  let driverA: TestDriver;
  let driverB: TestDriver;
  test.beforeAll(async () => {
    driverA = await createOnlineDriver('A');
    driverB = await createOnlineDriver('B');
  });
  test.afterAll(async () => {
    for (const d of [driverA, driverB]) if (d) await takeOffline(d);
  });

  async function openTower(page: Page) {
    await page.goto('/control-tower');
    await expect(page.getByRole('heading', { name: 'Control Tower' })).toBeVisible();
    await expect(page.getByTestId('ct-attention')).toBeVisible();
  }
  async function findRow(page: Page, orderNumber: string) {
    await page.getByTestId('ct-search').fill(orderNumber);
    await page.getByRole('button', { name: 'Search' }).click();
    const row = page.getByTestId(`ct-row-${orderNumber}`);
    await expect(row).toBeVisible();
    return row;
  }

  test('overview: attention facts, drivers, active orders by status — and Refresh re-reads the backend', async ({ page }) => {
    await openTower(page);
    await expect(page.getByTestId('ct-auto-dispatch')).toContainText('Automatic dispatch');
    await expect(page.getByTestId('ct-drivers')).toBeVisible(); // SUPER_ADMIN may see drivers
    await expect(page.getByTestId('ct-by-status')).toContainText('READY FOR PICKUP');
    const [summary] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/admin/control-tower/summary') && r.ok()),
      page.getByTestId('ct-refresh').click(),
    ]);
    const body = await summary.json();
    await expect(page.getByTestId('ct-awaiting')).toContainText(String(body.data.attention.awaitingAssignment));
  });

  test('a status count opens the matching, pre-filtered order search', async ({ page }) => {
    await openTower(page);
    await page.getByTestId('ct-status-ASSIGNED_TO_DRIVER').click();
    await expect(page).toHaveURL(/\/order-search\?status=ASSIGNED_TO_DRIVER/);
    await expect(page.locator('select').filter({ has: page.locator('option[value="ASSIGNED_TO_DRIVER"]') }).first()).toHaveValue('ASSIGNED_TO_DRIVER');
    // and the listed orders really are filtered by the backend
    const rows = page.locator('tbody tr');
    if ((await rows.count()) > 0) await expect(rows.first()).toContainText('ASSIGNED_TO_DRIVER');
  });

  test('the "pickup orders ready" count opens the order search filtered to ready PICKUP orders (filtered by the backend)', async ({ page }) => {
    await openTower(page);
    const [request] = await Promise.all([
      page.waitForRequest((r) => /\/admin\/orders\?/.test(r.url())),
      page.getByTestId('ct-pickup-ready').getByRole('link').click(),
    ]);
    await expect(page).toHaveURL(/\/order-search\?status=READY_FOR_PICKUP&fulfillmentType=PICKUP/);
    const params = new URL(request.url()).searchParams;
    expect([params.get('status'), params.get('fulfillmentType')]).toEqual(['READY_FOR_PICKUP', 'PICKUP']);
    await expect(page.getByTestId('list-fulfillment')).toHaveValue('PICKUP');
    const rows = page.locator('tbody tr');
    const n = await rows.count();
    for (let i = 0; i < n; i++) await expect(rows.nth(i).getByTestId('pickup-badge')).toBeVisible();
  });

  test('find an order, see its delivery state, reassign it (confirmed), the UI shows the backend’s new state; a dismissed confirmation sends nothing', async ({ page }) => {
    const order = await placeReadyOrder();
    try {
      await ensureAssignedTo(order.orderId, driverA);
      await openTower(page);
      let row = await findRow(page, order.orderNumber);
      await expect(row.getByTestId('ct-row-status')).toHaveText('ASSIGNED TO DRIVER');
      await expect(row.getByTestId('ct-row-driver')).toContainText(driverA.fullName);

      let posted = 0;
      page.on('request', (r) => r.method() === 'POST' && REASSIGN_URL.test(r.url()) && posted++);
      await row.getByTestId('dispatch-driver-select').selectOption(driverB.id);

      page.once('dialog', (d) => d.dismiss());
      await row.getByTestId('dispatch-submit').click();
      expect(posted).toBe(0);

      page.once('dialog', (d) => {
        expect(d.message()).toContain(order.orderNumber);
        d.accept();
      });
      const [res] = await Promise.all([page.waitForResponse((r) => REASSIGN_URL.test(r.url())), row.getByTestId('dispatch-submit').click()]);
      expect(res.status()).toBe(201);
      expect(res.request().postDataJSON()).toMatchObject({ driverId: driverB.id, expectedCurrentDriverId: driverA.id });
      await expect(page.getByTestId('ct-flash')).toHaveText(`${order.orderNumber} reassigned to ${driverB.fullName}.`);
      row = page.getByTestId(`ct-row-${order.orderNumber}`);
      await expect(row.getByTestId('ct-row-driver')).toContainText(driverB.fullName);
      await expect(row.getByTestId('ct-flag-reassigned')).toBeVisible();
      expect((await orderDetail(order.orderId)).driver.id).toBe(driverB.id);
    } finally {
      await cancelTestOrder(order);
    }
  });

  test('a double click sends exactly ONE reassignment', async ({ page }) => {
    const order = await placeReadyOrder();
    try {
      await ensureAssignedTo(order.orderId, driverA);
      await openTower(page);
      const row = await findRow(page, order.orderNumber);
      let posted = 0;
      page.on('request', (r) => r.method() === 'POST' && REASSIGN_URL.test(r.url()) && posted++);
      // Hold the response so the second click lands while the first is still in flight.
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      await page.route(REASSIGN_URL, async (route) => {
        await held;
        await route.continue();
      });
      page.on('dialog', (d) => d.accept());
      await row.getByTestId('dispatch-driver-select').selectOption(driverB.id);
      await row.getByTestId('dispatch-submit').click();
      await row.getByTestId('dispatch-submit').click({ force: true });
      await expect(row.getByTestId('dispatch-submit')).toBeDisabled();
      release();
      await expect(page.getByTestId('ct-flash')).toContainText('reassigned');
      expect(posted).toBe(1);
    } finally {
      await page.unroute(REASSIGN_URL);
      await cancelTestOrder(order);
    }
  });

  test('stale view: another admin reassigned the order meanwhile → the backend refuses, the reason is shown, the row reloads to the truth', async ({ page }) => {
    const order = await placeReadyOrder();
    try {
      await ensureAssignedTo(order.orderId, driverA);
      await openTower(page);
      const row = await findRow(page, order.orderNumber);
      await expect(row.getByTestId('ct-row-driver')).toContainText(driverA.fullName);
      // another admin moves it to driver B while this page still shows driver A
      expect((await reassignViaApi(order.orderId, driverB.id)).status).toBe(201);

      page.once('dialog', (d) => d.accept());
      await row.getByTestId('dispatch-driver-select').selectOption(driverB.id); // still offered (shown as busy) — the backend decides
      const [res] = await Promise.all([page.waitForResponse((r) => REASSIGN_URL.test(r.url())), row.getByTestId('dispatch-submit').click()]);
      expect(res.status()).toBe(409);
      expect((await res.json()).error.details.code).toBe('ASSIGNMENT_CHANGED');
      await expect(page.getByTestId('ct-flash')).toContainText('The assignment of this order changed since you loaded it');
      await expect(page.getByTestId(`ct-row-${order.orderNumber}`).getByTestId('ct-row-driver')).toContainText(driverB.fullName);
      expect((await orderDetail(order.orderId)).driver.id).toBe(driverB.id); // nothing was overridden
    } finally {
      await cancelTestOrder(order);
    }
  });

  test('automatic dispatch OFF: an order handed back by its driver waits for a driver; it is assigned from the ORDER DETAIL page, whose timeline shows what happened', async ({ page }) => {
    const order = await placeReadyOrder();
    try {
      await ensureAssignedTo(order.orderId, driverA);
      await withAutomaticDispatch(false, () => releaseByDriver(order.orderId, driverA));

      await openTower(page);
      await page.getByTestId('ct-stage-AWAITING_ASSIGNMENT').click();
      const row = await findRow(page, order.orderNumber);
      await expect(row.getByTestId('ct-row-driver')).toContainText('No driver'); // never the released driver
      await row.getByRole('link', { name: order.orderNumber }).click();

      const ops = page.getByTestId('order-operations');
      await expect(ops).toBeVisible();
      await expect(page.getByTestId('od-timeline')).toContainText('READY FOR PICKUP');
      await ops.getByTestId('dispatch-driver-select').selectOption(driverB.id);
      const [res] = await Promise.all([page.waitForResponse((r) => ASSIGN_URL.test(r.url())), ops.getByTestId('dispatch-submit').click()]);
      expect(res.status()).toBe(201);
      await expect(page.getByTestId('od-flash')).toHaveText(`${order.orderNumber} assigned to ${driverB.fullName}.`);
      await expect(ops.getByTestId('dispatch-submit')).toHaveText('Reassign'); // the page re-read the order: now assigned
      await expect(page.getByTestId('od-timeline').locator('li').last()).toContainText('ASSIGNED TO DRIVER');
    } finally {
      await cancelTestOrder(order);
    }
  });

  test('automatic dispatch OFF: a released order is unmistakable: counted under "needs attention", flagged on its row, filterable — and assigning it clears the flag', async ({ page }) => {
    const order = await placeReadyOrder();
    try {
      await ensureAssignedTo(order.orderId, driverA);
      await withAutomaticDispatch(false, () => releaseByDriver(order.orderId, driverA));

      await openTower(page);
      const released = page.getByTestId('ct-released');
      await expect(released).toContainText('released by a driver — waiting for a manual assignment');
      expect(Number(await released.locator('b').innerText())).toBeGreaterThanOrEqual(1);
      await released.getByRole('button').click();
      await expect(page.getByTestId('ct-released-filter')).toBeVisible();
      await expect(page.getByTestId('ct-stage-AWAITING_ASSIGNMENT')).toHaveAttribute('aria-selected', 'true');
      const row = await findRow(page, order.orderNumber); // found WITHIN the released-only list
      await expect(row.getByTestId('ct-flag-released')).toContainText('Released by the driver');

      await row.getByTestId('dispatch-driver-select').selectOption(driverB.id);
      const [res] = await Promise.all([page.waitForResponse((r) => ASSIGN_URL.test(r.url())), row.getByTestId('dispatch-submit').click()]);
      expect(res.status()).toBe(201);
      await expect(page.getByTestId('ct-flash')).toHaveText(`${order.orderNumber} assigned to ${driverB.fullName}.`);
      await expect(row).toHaveCount(0); // no longer released → gone from the released-only list
      await page.getByTestId('ct-released-filter').getByRole('button', { name: 'Clear' }).click();
      await page.getByTestId('ct-stage-ALL').click();
      const after = await findRow(page, order.orderNumber);
      await expect(after.getByTestId('ct-flag-released')).toHaveCount(0);
    } finally {
      await cancelTestOrder(order);
    }
  });

  test('U3 — automatic dispatch ON: a driver hand-back is redispatched at once and NEVER back to the driver who handed it back', async ({ page }) => {
    const order = await placeReadyOrder();
    try {
      await ensureAssignedTo(order.orderId, driverA);
      await withAutomaticDispatch(true, () => releaseByDriver(order.orderId, driverA));
      const detail = await orderDetail(order.orderId);
      expect(detail.driver?.id ?? null).not.toBe(driverA.id);

      await openTower(page);
      const row = await findRow(page, order.orderNumber);
      if (detail.status === 'ASSIGNED_TO_DRIVER') {
        // another eligible driver (driverB, or any eligible dev driver) got it — shown as a normal assignment, not "released"
        await expect(row.getByTestId('ct-row-driver')).toContainText(detail.driver.fullName);
        await expect(row.getByTestId('ct-flag-released')).toHaveCount(0);
      } else {
        // nobody else was eligible: it waits, flagged released, carried by the existing "no eligible driver" alert
        expect(detail.status).toBe('READY_FOR_PICKUP');
        await expect(row.getByTestId('ct-flag-released')).toContainText('Released by the driver');
        await expect(row.getByTestId('ct-flag-alert')).toBeVisible();
      }
    } finally {
      await cancelTestOrder(order);
    }
  });

  test('the drivers page shows which order a driver is on', async ({ page }) => {
    const order = await placeReadyOrder();
    try {
      await ensureAssignedTo(order.orderId, driverA);
      await page.goto('/drivers');
      const row = page.getByTestId(`driver-row-${driverA.id}`);
      await expect(row.getByTestId('driver-active-delivery')).toContainText(order.orderNumber);
    } finally {
      await cancelTestOrder(order);
    }
  });

  test('an admin WITHOUT ASSIGN_REASSIGN_ORDERS sees the operational view but no dispatch controls or alerts', async ({ page }) => {
    await page.route(ME_URL, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { role: 'ADMIN', permissions: ['VIEW_ORDERS'] } }) }),
    );
    await openTower(page);
    await expect(page.getByTestId('ct-table').or(page.getByTestId('ct-empty'))).toBeVisible();
    await expect(page.getByTestId('dispatch-submit')).toHaveCount(0);
    await expect(page.getByTestId('ct-alerts')).toHaveCount(0);
  });

  test('a backend refusal (403) on reassignment is shown, never swallowed', async ({ page }) => {
    const order = await placeReadyOrder();
    try {
      await ensureAssignedTo(order.orderId, driverA);
      await page.route(REASSIGN_URL, (route) =>
        route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action.' } }) }),
      );
      await openTower(page);
      const row = await findRow(page, order.orderNumber);
      page.once('dialog', (d) => d.accept());
      await row.getByTestId('dispatch-driver-select').selectOption(driverB.id);
      await row.getByTestId('dispatch-submit').click();
      await expect(page.getByTestId('ct-flash')).toHaveText('You do not have permission to perform this action.');
    } finally {
      await page.unroute(REASSIGN_URL);
      await cancelTestOrder(order);
    }
  });

  test('loading, empty search, and a server error with Retry', async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    await page.route(/\/admin\/control-tower\/summary$/, async (route) => {
      await held;
      await route.continue();
    });
    await page.goto('/control-tower');
    await expect(page.getByText('Loading...').first()).toBeVisible(); // loading is not shown as "no data"
    release();
    await expect(page.getByTestId('ct-attention')).toBeVisible();
    await page.unroute(/\/admin\/control-tower\/summary$/);

    await page.getByTestId('ct-search').fill('HT-000000');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByTestId('ct-empty')).toHaveText('No delivery matches this search.');

    await page.route(/\/admin\/control-tower\/deliveries/, (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Something went wrong. Please try again.' } }) }),
    );
    await page.getByTestId('ct-stage-ASSIGNED').click();
    await expect(page.getByText('Something went wrong. Please try again.')).toBeVisible();
    await page.unroute(/\/admin\/control-tower\/deliveries/);
    await page.getByRole('button', { name: 'Retry' }).first().click();
    await expect(page.getByTestId('ct-table').or(page.getByTestId('ct-empty'))).toBeVisible();
  });

  test('Arabic: the Control Tower renders right-to-left with Arabic labels', async ({ page }) => {
    await page.goto('/control-tower?lang=ar');
    await expect(page.getByRole('heading', { name: 'برج التحكم' })).toBeVisible();
    await expect(page.locator('[dir="rtl"]').first()).toBeVisible();
    await page.getByRole('button', { name: 'English' }).click(); // leave the remembered locale as English for other specs
  });

  test('the old /dispatch address forwards to the Control Tower', async ({ page }) => {
    await page.goto('/dispatch');
    await expect(page).toHaveURL(/\/control-tower$/);
    await expect(page.getByTestId('ct-alerts')).toBeVisible();
  });
});
