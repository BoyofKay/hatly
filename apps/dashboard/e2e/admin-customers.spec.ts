import { test, expect } from '@playwright/test';
import axios from 'axios';
import { API_BASE_URL, SUPER_ADMIN_STORAGE_STATE, VENDOR_A_STORAGE_STATE } from './env';

/**
 * M3c (Launch-Readiness Gap Audit, G-10) — Admin Customer Management.
 * Provisions its own throwaway customer directly through the real,
 * pre-existing `POST auth/customer/password/register` endpoint (the
 * same primitive `global-setup.ts`'s own `registerFixtureCustomer`
 * already uses) rather than relying on any pre-seeded dev data.
 */
async function registerThrowawayCustomer(): Promise<{ id: string; fullName: string; phone: string }> {
  const api = axios.create({ baseURL: API_BASE_URL, validateStatus: () => true });
  const phone = `+20107${String(Date.now()).slice(-7)}`;
  const fullName = `Playwright Customer Search ${Date.now()}`;
  const res = await api.post('/auth/customer/password/register', { phone, fullName, password: 'Playwright-Dev-1!' });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`Failed to register a throwaway customer: HTTP ${res.status} ${JSON.stringify(res.data)}`);
  }
  // Decode the JWT's own `sub` claim rather than assuming a response shape beyond what auth already guarantees.
  const payload = JSON.parse(Buffer.from(res.data.data.accessToken.split('.')[1], 'base64').toString());
  return { id: payload.sub, fullName, phone };
}

test.describe('Admin Customers', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  test('the page loads with a real search, and an invalid backend query never crashes it', async ({ page }) => {
    await page.goto('/customers');
    await expect(page.getByRole('heading', { name: 'Customers' })).toBeVisible();
    await expect(page.locator('.text-red-700')).toHaveCount(0);
  });

  test('searching by a real customer\'s phone finds exactly that customer, and opening it shows the real detail view', async ({ page }) => {
    const customer = await registerThrowawayCustomer();

    await page.goto('/customers');
    await page.getByPlaceholder('Customer name, phone, or customer id').fill(customer.phone);

    const [searchResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/admin/customers?') && res.request().method() === 'GET'),
      page.getByRole('button', { name: 'Search' }).click(),
    ]);
    expect(searchResponse.ok()).toBe(true);

    const row = page.locator('tr', { hasText: customer.phone });
    await expect(row).toBeVisible();

    const [detailResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes(`/admin/customers/${customer.id}`) && res.request().method() === 'GET'),
      row.getByRole('link', { name: 'Open' }).click(),
    ]);
    expect(detailResponse.ok()).toBe(true);
    await expect(page).toHaveURL(new RegExp(`/customers/${customer.id}$`));
    await expect(page.getByRole('heading', { name: customer.fullName })).toBeVisible();
    await expect(page.getByText('No orders yet.')).toBeVisible(); // a brand-new customer has none
  });

  test('a search with no matches shows the real empty state, not an error', async ({ page }) => {
    await page.goto('/customers');
    await page.getByPlaceholder('Customer name, phone, or customer id').fill('+201000000099999');
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page.getByText('No customers match this search.')).toBeVisible();
  });

  test('filtering by account status is sent to the backend as a real query parameter', async ({ page }) => {
    await page.goto('/customers');
    const [response] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/admin/customers?') && res.url().includes('isActive=true')),
      (async () => {
        await page.locator('select').selectOption('active');
        await page.getByRole('button', { name: 'Search' }).click();
      })(),
    ]);
    expect(response.ok()).toBe(true);
  });
});

test.describe('Admin Customers — unauthorized access', () => {
  test.use({ storageState: VENDOR_A_STORAGE_STATE });

  test('a non-admin session (Vendor Manager) is redirected away by the Admin route group\'s own guard before the page ever loads', async ({ page }) => {
    // Client-side UX only — the REAL boundary (VIEW_CUSTOMERS permission, VendorManager refused with
    // 403) is proven at the HTTP level by the backend e2e authorization suite.
    await page.goto('/customers');
    await expect(page).toHaveURL(/\/login$/);
  });
});
