import { test, expect, Page } from '@playwright/test';
import { SUPER_ADMIN_STORAGE_STATE } from './env';
import { readFixtures } from './read-fixtures';
import {
  CustomerApi,
  PendingHatlyOrder,
  adminOrderDetail,
  confirmPriceViaApi,
  formatMinorForTest,
  placePendingHatlyOrder,
  registerCustomerApi,
} from './hatly-service-fixtures';

/**
 * Admin Orders — Hatly Service pending-price confirmation UI. Everything runs against the REAL dev backend and database: real
 * Hatly Service orders are placed through the customer API, and the confirmations go through the real
 * `POST admin/orders/items/:itemId/confirm-price`. The only intercepted responses are the ones a SUPER_ADMIN session can never
 * produce on its own — a 403 on the confirmation, a class-validator 400, and an ADMIN without MANAGE_HATLY_SERVICE_PRICING (the
 * backend e2e suite proves the real 403s; there is no HTTP way to create a plain ADMIN here, see admin-users-permissions.spec.ts).
 */
const CONFIRM_URL = /\/admin\/orders\/items\/[0-9a-f-]+\/confirm-price$/;
const ME_URL = /\/admin\/me\/permissions$/;

test.describe('Admin Orders — Hatly Service pricing', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  // Placing orders is rate limited and each test needs its own pending order to mutate; allow for waiting out a throttle window.
  test.setTimeout(120_000);

  let customer: CustomerApi;
  test.beforeAll(async () => {
    customer = await registerCustomerApi();
  });

  // Tests that never reach the backend with a confirmation (mocked 403/400, no permission, read-only rendering) share one order.
  let sharedPending: PendingHatlyOrder | undefined;
  const shared = async () => (sharedPending ??= await placePendingHatlyOrder(customer, ['Shared pending request']));

  async function openOrder(page: Page, orderId: string) {
    await page.goto(`/order-search/${orderId}`);
    await expect(page.getByTestId('order-totals')).toBeVisible();
  }
  const confirmRequests = (page: Page) => {
    const bodies: unknown[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && CONFIRM_URL.test(req.url())) bodies.push(req.postDataJSON());
    });
    return bodies;
  };

  test.describe('order list', () => {
    test('an order with a pending Hatly Service price is badged, the server-side filter keeps only such orders, and an ordinary order is neither badged nor listed', async ({ page }) => {
      const order = await shared();
      const { vendorAOrders } = readFixtures();
      const ordinary = vendorAOrders[2];

      await page.goto('/order-search');
      await page.getByPlaceholder('Order number, order id, customer phone, or customer name').fill(order.orderNumber);
      await page.getByRole('button', { name: 'Search' }).click();
      const pendingRow = page.locator('tr', { hasText: order.orderNumber });
      await expect(pendingRow.getByTestId('pending-price-badge')).toHaveText('Price pending');
      await expect(pendingRow).toContainText('Pending'); // the total column says pending, never a number or 0.00

      await page.getByPlaceholder('Order number, order id, customer phone, or customer name').fill(ordinary.orderNumber);
      await page.getByRole('button', { name: 'Search' }).click();
      const ordinaryRow = page.locator('tr', { hasText: ordinary.orderNumber });
      await expect(ordinaryRow).toBeVisible();
      await expect(ordinaryRow.getByTestId('pending-price-badge')).toHaveCount(0);

      // The filter is a real query parameter, applied by the backend, and keeps all the other filters/search.
      await page.getByPlaceholder('Order number, order id, customer phone, or customer name').fill('');
      await page.getByLabel('Hatly Service pricing').selectOption('PENDING');
      const [response] = await Promise.all([
        page.waitForResponse((res) => res.url().includes('/admin/orders?') && res.url().includes('hasPendingPricing=true')),
        page.getByRole('button', { name: 'Search' }).click(),
      ]);
      expect(response.ok()).toBe(true);
      const body = await response.json();
      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data.every((o: any) => o.hasPendingHatlyServicePricing === true)).toBe(true);
      await expect(page.locator('tr', { hasText: order.orderNumber })).toBeVisible();
      await expect(page.locator('tr', { hasText: ordinary.orderNumber })).toHaveCount(0);
    });

    test('with the filter on and nothing matching, the empty state says no order is waiting for pricing', async ({ page }) => {
      await page.goto('/order-search');
      await page.getByLabel('Hatly Service pricing').selectOption('PENDING');
      await page.getByPlaceholder('Order number, order id, customer phone, or customer name').fill('HT-999999999');
      await page.getByRole('button', { name: 'Search' }).click();
      await expect(page.getByText('No orders are waiting for Hatly Service pricing.')).toBeVisible();
    });

    test('Arabic: the badge reads «سعر معلق», the page is RTL, and the choice survives a reload', async ({ page }) => {
      const order = await shared();
      await page.goto('/order-search');
      await page.getByRole('button', { name: 'العربية' }).click();
      await expect(page.locator('[dir="rtl"]').first()).toBeVisible();
      await expect(page.getByRole('heading', { name: 'البحث عن الطلبات' })).toBeVisible();
      await page.getByPlaceholder('رقم الطلب أو المعرّف أو هاتف العميل أو اسمه').fill(order.orderNumber);
      await page.getByRole('button', { name: 'بحث' }).click();
      await expect(page.locator('tr', { hasText: order.orderNumber }).getByTestId('pending-price-badge')).toHaveText('سعر معلق');
      await page.reload();
      await expect(page.getByRole('heading', { name: 'البحث عن الطلبات' })).toBeVisible();
      await page.getByRole('button', { name: 'English' }).click(); // leave the browser profile in English for the other specs
    });
  });

  test.describe('order details', () => {
    test('a pending request shows its details, route, an explicit "price not set" state and a pending total — never a numeric total', async ({ page }) => {
      const order = await shared();
      await openOrder(page, order.orderId);

      const item = page.getByTestId(`hatly-item-${order.itemIds[0]}`);
      await expect(item).toContainText('Shared pending request');
      await expect(item.getByTestId('price-pending')).toHaveText('Price not set yet');
      await expect(item.getByLabel('Price (EGP)')).toBeEnabled();
      await expect(item.getByRole('button', { name: 'Confirm price' })).toBeEnabled();
      await expect(page.getByText('Hatly Service request', { exact: true })).toBeVisible();
      await expect(page.getByText('Buy from a place')).toBeVisible();
      await expect(page.getByText('Playwright Corner Pharmacy (30.3, 31.45)')).toBeVisible(); // BUY: origin = the customer's place
      // destination = the customer's address, led by its frozen delivery area ("City — Zone", PD-009) so ops can place it without a pin
      await expect(page.getByText(/^Customer address: .+ — .+ · Playwright Hatly Service Street 1$/)).toBeVisible();

      const totals = page.getByTestId('order-totals');
      await expect(totals).toHaveAttribute('data-total-pending', 'true');
      await expect(page.getByTestId('totals-total')).toContainText('Pending price confirmation');
      await expect(page.getByTestId('totals-amount-due')).toContainText('Pending price confirmation');
      await expect(page.getByTestId('totals-total')).not.toContainText('EGP');
      await expect(page.getByTestId('hatly-pending-summary')).toHaveText('1 Hatly Service price(s) pending');
    });

    test('confirming a price shows the confirmed amount and the backend\'s recalculated total at once, persists on reload, and removes the order from the pending filter', async ({ page }) => {
      const order = await placePendingHatlyOrder(customer, ['Confirm me']);
      const bodies = confirmRequests(page);
      await openOrder(page, order.orderId);

      const item = page.getByTestId(`hatly-item-${order.itemIds[0]}`);
      await item.getByLabel('Price (EGP)').fill('150.50');
      await item.getByRole('button', { name: 'Confirm price' }).click();

      await expect(item.getByTestId('price-confirmed')).toContainText('150.50 EGP');
      await expect(item.getByTestId('price-notice')).toHaveText('Price confirmed. The order totals were updated.');
      expect(bodies).toEqual([{ amountMinor: 15050 }]); // integer minor units, no float arithmetic

      const detail = await adminOrderDetail(order.orderId); // the backend's authoritative numbers
      expect(detail).toMatchObject({ hasPendingHatlyServicePricing: false, subtotalMinor: 15050, totalMinor: 15050 + order.deliveryFeeMinor });
      await expect(page.getByTestId('order-totals')).toHaveAttribute('data-total-pending', 'false');
      await expect(page.getByTestId('totals-hatly')).toContainText('150.50 EGP');
      await expect(page.getByTestId('totals-total')).toContainText(`${formatMinorForTest(detail.totalMinor)} EGP`);
      await expect(page.getByTestId('totals-amount-due')).toContainText(`${formatMinorForTest(detail.amountDueMinor)} EGP`);
      await expect(page.getByTestId('hatly-pending-summary')).toHaveText('No Hatly Service prices are pending for this order.');

      await page.reload();
      await expect(page.getByTestId(`hatly-item-${order.itemIds[0]}`).getByTestId('price-confirmed')).toContainText('150.50 EGP');

      await page.goto('/order-search');
      await page.getByLabel('Hatly Service pricing').selectOption('PENDING');
      await page.getByPlaceholder('Order number, order id, customer phone, or customer name').fill(order.orderNumber);
      await page.getByRole('button', { name: 'Search' }).click();
      await expect(page.getByText('No orders are waiting for Hatly Service pricing.')).toBeVisible();
    });

    test('several pending requests are confirmed independently; the total stays pending until the last one', async ({ page }) => {
      const order = await placePendingHatlyOrder(customer, ['First request', 'Second request']);
      await openOrder(page, order.orderId);
      const [first, second] = order.itemIds.map((id) => page.getByTestId(`hatly-item-${id}`));

      await second.getByLabel('Price (EGP)').fill('20');
      await second.getByRole('button', { name: 'Confirm price' }).click();
      await expect(second.getByTestId('price-confirmed')).toContainText('20.00 EGP');
      await expect(first.getByTestId('price-pending')).toBeVisible(); // untouched
      await expect(page.getByTestId('order-totals')).toHaveAttribute('data-total-pending', 'true');
      await expect(page.getByTestId('totals-hatly')).toContainText('1 of 2 confirmed');
      await expect(page.getByTestId('hatly-pending-summary')).toHaveText('1 Hatly Service price(s) pending');

      await first.getByLabel('Price (EGP)').fill('30');
      await first.getByRole('button', { name: 'Confirm price' }).click();
      await expect(first.getByTestId('price-confirmed')).toContainText('30.00 EGP');
      await expect(page.getByTestId('order-totals')).toHaveAttribute('data-total-pending', 'false');
      const detail = await adminOrderDetail(order.orderId);
      expect(detail.totalMinor).toBe(5000 + order.deliveryFeeMinor);
      await expect(page.getByTestId('totals-total')).toContainText(`${formatMinorForTest(detail.totalMinor)} EGP`);
    });

    test('invalid input is rejected in the form with a specific message and nothing is sent (empty, not a number, zero); Arabic-Indic digits are read as numbers', async ({ page }) => {
      const order = await placePendingHatlyOrder(customer, ['Validation request']);
      const bodies = confirmRequests(page);
      await openOrder(page, order.orderId);
      const item = page.getByTestId(`hatly-item-${order.itemIds[0]}`);
      const input = item.getByLabel('Price (EGP)');
      const submit = item.getByRole('button', { name: 'Confirm price' });

      await submit.click();
      await expect(item.getByTestId('price-error')).toHaveText('Enter the price first.');
      await input.fill('abc');
      await submit.click();
      await expect(item.getByTestId('price-error')).toHaveText('Enter a valid amount in EGP, with up to two decimal places.');
      await input.fill('12.345');
      await submit.click();
      await expect(item.getByTestId('price-error')).toHaveText('Enter a valid amount in EGP, with up to two decimal places.');
      await input.fill('-5');
      await submit.click();
      await expect(item.getByTestId('price-error')).toHaveText('Enter a valid amount in EGP, with up to two decimal places.');
      await input.fill('0');
      await submit.click();
      await expect(item.getByTestId('price-error')).toHaveText('The price must be greater than zero.');
      expect(bodies).toEqual([]);

      await input.fill('٢٥٫٥'); // 25.5 in Arabic-Indic digits
      await submit.click();
      await expect(item.getByTestId('price-confirmed')).toContainText('25.50 EGP');
      expect(bodies).toEqual([{ amountMinor: 2550 }]);
    });

    test('a rapid double click sends exactly one confirmation and disables the control while it is in flight', async ({ page }) => {
      const order = await placePendingHatlyOrder(customer, ['Double click request']);
      const bodies = confirmRequests(page);
      await page.route(CONFIRM_URL, async (route) => {
        await new Promise((r) => setTimeout(r, 600)); // keep the call in flight long enough to click again
        await route.continue();
      });
      await openOrder(page, order.orderId);
      const item = page.getByTestId(`hatly-item-${order.itemIds[0]}`);
      await item.getByLabel('Price (EGP)').fill('99');
      await item.getByRole('button', { name: 'Confirm price' }).dblclick();
      await expect(item.getByRole('button', { name: 'Confirming...' })).toBeDisabled();
      await expect(item.getByTestId('price-confirmed')).toContainText('99.00 EGP');
      expect(bodies).toEqual([{ amountMinor: 9900 }]);
    });

    test('a 409 (another admin priced it first with a different amount) reconciles to the current confirmed price instead of leaving a stale form', async ({ page }) => {
      const order = await placePendingHatlyOrder(customer, ['Conflict request']);
      await openOrder(page, order.orderId); // this page still believes the price is pending...
      expect((await confirmPriceViaApi(order.itemIds[0], 7700)).status).toBe(201); // ...but someone else just priced it

      const item = page.getByTestId(`hatly-item-${order.itemIds[0]}`);
      await item.getByLabel('Price (EGP)').fill('88');
      await item.getByRole('button', { name: 'Confirm price' }).click();
      await expect(item.getByTestId('price-error')).toHaveText('A different price was already confirmed for this request. Showing the current confirmed price.');
      await expect(item.getByTestId('price-confirmed')).toContainText('77.00 EGP');
      await expect(item.getByLabel('Price (EGP)')).toHaveCount(0);
    });

    test('repeating the same price another admin already confirmed is an idempotent success, not an error', async ({ page }) => {
      const order = await placePendingHatlyOrder(customer, ['Same price request']);
      await openOrder(page, order.orderId);
      expect((await confirmPriceViaApi(order.itemIds[0], 4400)).status).toBe(201);

      const item = page.getByTestId(`hatly-item-${order.itemIds[0]}`);
      await item.getByLabel('Price (EGP)').fill('44');
      await item.getByRole('button', { name: 'Confirm price' }).click();
      await expect(item.getByTestId('price-notice')).toHaveText('This price was already confirmed. Showing the current order.');
      await expect(item.getByTestId('price-confirmed')).toContainText('44.00 EGP');
      await expect(item.getByTestId('price-error')).toHaveCount(0);
    });

    test('a 403 from the backend shows the permission message (never a generic error) and leaves the request pending', async ({ page }) => {
      const order = await shared();
      await page.route(CONFIRM_URL, (route) =>
        route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action.' } }) }),
      );
      await openOrder(page, order.orderId);
      const item = page.getByTestId(`hatly-item-${order.itemIds[0]}`);
      await item.getByLabel('Price (EGP)').fill('10');
      await item.getByRole('button', { name: 'Confirm price' }).click();
      await expect(item.getByTestId('price-error')).toHaveText("You don't have permission to confirm Hatly Service prices.");
      await expect(item.getByTestId('price-pending')).toBeVisible();
    });

    test('a backend validation rejection (400) is shown as a localized validation message, without leaking the backend text', async ({ page }) => {
      const order = await shared();
      await page.route(CONFIRM_URL, (route) =>
        route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'amountMinor must not be less than 1', details: { code: 'INVALID_FINAL_AMOUNT' } } }) }),
      );
      await openOrder(page, order.orderId);
      const item = page.getByTestId(`hatly-item-${order.itemIds[0]}`);
      await item.getByLabel('Price (EGP)').fill('5');
      await item.getByRole('button', { name: 'Confirm price' }).click();
      await expect(item.getByTestId('price-error')).toHaveText('The amount is not valid. Enter a price greater than zero.');
      await expect(page.getByText('amountMinor must not be less than 1')).toHaveCount(0);
    });

    test('an admin WITHOUT MANAGE_HATLY_SERVICE_PRICING sees the pending state but no enabled control, and the explanation; nothing can be sent', async ({ page }) => {
      const order = await shared();
      const bodies = confirmRequests(page);
      await page.route(ME_URL, (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { role: 'ADMIN', permissions: ['VIEW_ORDERS'] } }) }),
      );
      await openOrder(page, order.orderId);
      const item = page.getByTestId(`hatly-item-${order.itemIds[0]}`);
      await expect(item.getByTestId('price-pending')).toHaveText('Price not set yet');
      await expect(item.getByRole('button', { name: 'Confirm price' })).toBeDisabled();
      await expect(item.getByLabel('Price (EGP)')).toHaveCount(0);
      await expect(item.getByTestId('no-permission')).toHaveText("You don't have permission to confirm Hatly Service prices.");
      expect(bodies).toEqual([]);
    });

    test('Arabic: «السعر لم يتم تحديده», «تأكيد السعر», the permission note and the confirmed state render right-to-left', async ({ page }) => {
      const order = await placePendingHatlyOrder(customer, ['Arabic detail request']);
      await openOrder(page, order.orderId);
      await page.getByRole('button', { name: 'العربية' }).click();
      await expect(page.locator('[dir="rtl"]').first()).toBeVisible();
      const item = page.getByTestId(`hatly-item-${order.itemIds[0]}`);
      await expect(item.getByTestId('price-pending')).toHaveText('السعر لم يتم تحديده');
      await expect(page.getByTestId('totals-total')).toContainText('بانتظار تأكيد الأسعار');
      await expect(page.getByText('طلب خدمة هاتلي', { exact: true })).toBeVisible();
      await item.getByLabel('السعر (ج.م)').fill('12.5');
      await item.getByRole('button', { name: 'تأكيد السعر' }).click();
      await expect(item.getByTestId('price-confirmed')).toContainText('12.50 ج.م');
      await expect(item.getByTestId('price-notice')).toHaveText('تم تأكيد السعر وتحديث إجماليات الطلب.');

      const noPermission = await shared();
      await page.route(ME_URL, (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { role: 'ADMIN', permissions: ['VIEW_ORDERS'] } }) }),
      );
      await openOrder(page, noPermission.orderId);
      await expect(page.getByTestId('no-permission')).toHaveText('ليس لديك صلاحية تأكيد أسعار خدمة هاتلي.');
      await page.getByRole('button', { name: 'English' }).click();
    });

    test('a normal vendor order is unchanged: no Hatly Service section, a numeric total, no pricing controls', async ({ page }) => {
      const { vendorAOrders } = readFixtures();
      await openOrder(page, vendorAOrders[2].orderId);
      await expect(page.getByTestId('order-totals')).toHaveAttribute('data-total-pending', 'false');
      await expect(page.getByTestId('totals-total')).toContainText('EGP');
      await expect(page.getByText('Hatly Service request', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Confirm price' })).toHaveCount(0);
    });
  });
});
