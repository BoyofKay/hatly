import { test, expect } from '@playwright/test';
import { VENDOR_A_PHONE, VENDOR_A_STORAGE_STATE } from './env';
import { readFixtures } from './read-fixtures';

/**
 * Operational Completion milestone — the Vendor pages and the login page read the backend's real error envelope
 * (`{ error: { code, message, details } }`, via lib/api/errors.ts) instead of the non-existent `response.data.message`,
 * which replaced every server explanation with a generic fallback. The failing responses are intercepted (a vendor cannot
 * make the real backend fail on demand, and the real login throttle must not be burnt — see e2e/README.md); the page code,
 * the dashboard and the browser are real. Nothing reaches the backend for an intercepted call, so no fixture is mutated.
 */
const envelope = (status: number, code: string, message: string, details?: object) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify({ error: { code, message, ...(details ? { details } : {}), correlationId: 'pw-test' } }),
});

test.describe('Vendor pages — backend errors are shown with the backend’s reason', () => {
  test.use({ storageState: VENDOR_A_STORAGE_STATE });

  test('a server error loading the order list shows the server’s message, and Refresh recovers', async ({ page }) => {
    let fail = true;
    await page.route(/\/api\/v1\/vendor\/orders$/, (route) =>
      fail ? route.fulfill(envelope(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.')) : route.continue(),
    );
    await page.goto('/orders');
    await expect(page.getByText('Something went wrong. Please try again.')).toBeVisible();
    await expect(page.getByText('Failed to load orders.')).toHaveCount(0);

    fail = false;
    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect(page.getByText('Something went wrong. Please try again.')).toHaveCount(0);
    const { vendorAOrders } = readFixtures();
    await expect(page.locator(`a[href="/orders/${vendorAOrders[2].orderId}"]`)).toBeVisible();
  });

  test('a refused status change shows the backend’s reason (not a generic “Failed to update status.”)', async ({ page }) => {
    const { vendorAOrders } = readFixtures();
    const order = vendorAOrders[2]; // read-only fixture: the intercepted PATCH never reaches the backend
    await page.route(/\/vendor\/orders\/segments\/[0-9a-f-]+\/status$/, (route) =>
      route.fulfill(envelope(400, 'BAD_REQUEST', 'Invalid segment transition: PENDING → CONFIRMED is not allowed right now.')),
    );
    await page.goto(`/orders/${order.orderId}`);
    await expect(page.getByText('Your items — status: PENDING')).toBeVisible();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByText('Invalid segment transition: PENDING → CONFIRMED is not allowed right now.')).toBeVisible();
    await expect(page.getByText('Failed to update status.')).toHaveCount(0);
  });

  test('a server error loading products shows the server’s message', async ({ page }) => {
    await page.route(/\/api\/v1\/vendor\/products(\?.*)?$/, (route) =>
      route.request().method() === 'GET'
        ? route.fulfill(envelope(503, 'SERVICE_UNAVAILABLE', 'A required service is temporarily unavailable. Please try again shortly.'))
        : route.continue(),
    );
    await page.goto('/products');
    await expect(page.getByText('A required service is temporarily unavailable. Please try again shortly.')).toBeVisible();
  });
});

test.describe('Login — auth errors say what actually happened', () => {
  test('REGRESSION: the login rate limit (429) says so — it used to claim the phone/password was wrong', async ({ page }) => {
    await page.route(/\/auth\/dashboard\/login$/, (route) => route.fulfill(envelope(429, 'TOO_MANY_REQUESTS', 'Too many requests. Please try again later.')));
    await page.goto('/login');
    await page.getByLabel('Phone number').fill(VENDOR_A_PHONE);
    await page.getByLabel('Password').fill('any-password-1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Too many requests. Please try again later.')).toBeVisible();
    await expect(page.getByText(/invalid phone number or password/i)).toHaveCount(0);
    await expect(page).toHaveURL(/\/login$/);
  });

  test('a rejected login (401) keeps the clear credentials message; an outage shows the server’s message', async ({ page }) => {
    let status = 401;
    await page.route(/\/auth\/dashboard\/login$/, (route) =>
      route.fulfill(status === 401 ? envelope(401, 'UNAUTHORIZED', 'Invalid credentials.') : envelope(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.')),
    );
    await page.goto('/login');
    await page.getByLabel('Phone number').fill(VENDOR_A_PHONE);
    await page.getByLabel('Password').fill('any-password-1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Invalid phone number or password.')).toBeVisible();

    status = 500;
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Something went wrong. Please try again.')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });
});
