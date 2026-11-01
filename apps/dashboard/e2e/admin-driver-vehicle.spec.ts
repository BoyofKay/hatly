import { test, expect, Page } from '@playwright/test';
import { SUPER_ADMIN_STORAGE_STATE } from './env';
import { adminApi } from './control-tower-fixtures';

/**
 * Operational Completion milestone — an admin sets, changes and clears a driver's vehicle type on the Drivers page, through
 * the real `PATCH admin/drivers/:id/vehicle-type` against the real dev backend. The vehicle type used is a Playwright-owned
 * catalog row created (or reactivated) through the real `admin/vehicle-types` API and DEACTIVATED again afterwards, so the
 * dev picker is left as it was (the catalog has no delete). The throwaway driver is created through `POST admin/drivers`
 * and left with no vehicle type. Only the backend REFUSAL case is intercepted (an inactive type cannot be offered by the
 * page itself, which lists active types only); the real refusal is proven in the backend e2e suite (84-operational-completion).
 */
const VEHICLE_NAME = 'Playwright Motorbike';
const VEHICLE_URL = /\/admin\/drivers\/[0-9a-f-]+\/vehicle-type$/;

test.describe('Admin — driver vehicle type', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  let vehicleTypeId: string;
  let driver: { id: string; fullName: string };

  test.beforeAll(async () => {
    const all = (await adminApi().get('/admin/vehicle-types', { params: { includeInactive: 'true' } })).data.data as any[];
    const existing = all.find((v) => v.name === VEHICLE_NAME);
    if (existing) {
      const res = await adminApi().patch(`/admin/vehicle-types/${existing.id}`, { isActive: true });
      if (res.status !== 200) throw new Error(`reactivate vehicle type: HTTP ${res.status}`);
      vehicleTypeId = existing.id;
    } else {
      const res = await adminApi().post('/admin/vehicle-types', { name: VEHICLE_NAME, nameAr: 'موتوسيكل بلايرايت', maxActiveDeliveries: 1 });
      if (res.status !== 201) throw new Error(`create vehicle type: HTTP ${res.status} ${JSON.stringify(res.data)}`);
      vehicleTypeId = res.data.data.id;
    }
    const stamp = `${Date.now()}`.slice(-7);
    const fullName = `PW Vehicle Driver ${stamp}`;
    const created = await adminApi().post('/admin/drivers', { fullName, phone: `+20107${stamp}`, password: 'Playwright-Dev-1!' });
    if (created.status !== 201) throw new Error(`create driver: HTTP ${created.status} ${JSON.stringify(created.data)}`);
    driver = { id: created.data.data.id, fullName };
  });

  test.afterAll(async () => {
    if (driver) await adminApi().patch(`/admin/drivers/${driver.id}/vehicle-type`, { vehicleTypeId: null });
    if (vehicleTypeId) await adminApi().patch(`/admin/vehicle-types/${vehicleTypeId}`, { isActive: false });
  });

  async function driverRow(page: Page) {
    await page.goto(`/drivers?search=${encodeURIComponent(driver.fullName)}`);
    const row = page.getByTestId(`driver-row-${driver.id}`);
    await expect(row.getByTestId('driver-vehicle-select')).toBeVisible();
    return row;
  }
  const backendVehicle = async () =>
    ((await adminApi().get('/admin/drivers')).data.data as any[]).find((d) => d.id === driver.id).vehicleTypeId as string | null;

  test('set a vehicle type, then clear it — each saved by the backend and re-read; Save is only enabled for a real change', async ({ page }) => {
    const row = await driverRow(page);
    await expect(row.getByTestId('driver-vehicle-name')).toContainText('no vehicle type');
    await expect(row.getByTestId('driver-vehicle-save')).toBeDisabled();

    await row.getByTestId('driver-vehicle-select').selectOption(vehicleTypeId);
    await expect(row.getByTestId('driver-vehicle-save')).toBeEnabled();
    const [res] = await Promise.all([
      page.waitForResponse((r) => VEHICLE_URL.test(r.url()) && r.request().method() === 'PATCH'),
      row.getByTestId('driver-vehicle-save').click(),
    ]);
    expect(res.status()).toBe(200);
    await expect(row.getByTestId('driver-vehicle-result')).toHaveText(`Vehicle type of "${driver.fullName}" saved.`);
    await expect(row.getByTestId('driver-vehicle-name')).toContainText(VEHICLE_NAME);
    await expect(row.getByTestId('driver-vehicle-save')).toBeDisabled();
    expect(await backendVehicle()).toBe(vehicleTypeId);

    await row.getByTestId('driver-vehicle-select').selectOption('');
    await Promise.all([page.waitForResponse((r) => VEHICLE_URL.test(r.url())), row.getByTestId('driver-vehicle-save').click()]);
    await expect(row.getByTestId('driver-vehicle-name')).toContainText('no vehicle type');
    expect(await backendVehicle()).toBeNull();
  });

  test('a double click sends exactly ONE update', async ({ page }) => {
    const row = await driverRow(page);
    let patches = 0;
    page.on('request', (r) => r.method() === 'PATCH' && VEHICLE_URL.test(r.url()) && patches++);
    await row.getByTestId('driver-vehicle-select').selectOption(vehicleTypeId);
    await row.getByTestId('driver-vehicle-save').dblclick();
    await expect(row.getByTestId('driver-vehicle-result')).toBeVisible();
    expect(patches).toBe(1);
    expect(await backendVehicle()).toBe(vehicleTypeId);
    await adminApi().patch(`/admin/drivers/${driver.id}/vehicle-type`, { vehicleTypeId: null });
  });

  test('a backend refusal is shown with the backend’s reason and the row re-reads the saved value', async ({ page }) => {
    const row = await driverRow(page);
    await page.route(VEHICLE_URL, (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'This vehicle type is inactive.', details: { code: 'VEHICLE_TYPE_INACTIVE' } } }),
      }),
    );
    await row.getByTestId('driver-vehicle-select').selectOption(vehicleTypeId);
    await row.getByTestId('driver-vehicle-save').click();
    await expect(row.getByTestId('driver-vehicle-result')).toHaveText('This vehicle type is inactive.');
    await expect(row.getByTestId('driver-vehicle-select')).toHaveValue(''); // the saved value, re-read — not the refused pick
    expect(await backendVehicle()).toBeNull();
  });

  test('Arabic: the Drivers page renders right-to-left with Arabic labels and the Arabic vehicle name', async ({ page }) => {
    await page.goto(`/drivers?lang=ar&search=${encodeURIComponent(driver.fullName)}`);
    await expect(page.getByRole('heading', { name: 'السائقون' })).toBeVisible();
    await expect(page.locator('[dir="rtl"]').first()).toBeVisible();
    const row = page.getByTestId(`driver-row-${driver.id}`);
    await expect(row.getByText('نوع المركبة')).toBeVisible();
    await expect(row.getByTestId('driver-vehicle-select').locator('option', { hasText: 'موتوسيكل بلايرايت' })).toHaveCount(1);
  });
});
