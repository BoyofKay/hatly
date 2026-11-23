import { test, expect, Page } from '@playwright/test';
import { SUPER_ADMIN_STORAGE_STATE } from './env';

/**
 * PD-009 — Admin Delivery Zones, in a real browser against the REAL dev backend/database. Every zone a test creates is left
 * DEACTIVATED at the end, so it never appears in the customer app's zone list. The only intercepted responses are the ones a
 * SUPER_ADMIN session cannot produce (an ADMIN without the pricing permission, a 403): the backend e2e suite proves the real
 * 403s (test/e2e/82-delivery-zones).
 */
const ME_URL = /\/admin\/me\/permissions$/;
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

async function openPage(page: Page) {
  await page.goto('/delivery-zones');
  await expect(page.getByRole('heading', { name: 'Delivery Zones' })).toBeVisible();
}

async function createZone(page: Page, opts: { name: string; nameAr: string; fee: string }) {
  await page.getByTestId('zone-new').click();
  const form = page.getByTestId('zone-form');
  await form.getByTestId('zone-advanced-toggle').click();
  await form.getByTestId('zone-service-area').selectOption({ label: 'Belbeis / بلبيس' });
  await form.getByTestId('zone-city').fill('Belbeis');
  await form.getByTestId('zone-city-ar').fill('بلبيس');
  await form.getByTestId('parent-zone-name').fill('Belbeis Zone');
  await form.getByTestId('parent-zone-name-ar').fill('منطقة بلبيس');
  await form.getByTestId('zone-name').fill(opts.name);
  await form.getByTestId('zone-name-ar').fill(opts.nameAr);
  await form.getByTestId('zone-display-order').fill('90');
  await form.getByTestId('zone-fee').fill(opts.fee);
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/admin/delivery-zones') && r.request().method() === 'POST'),
    form.getByRole('button', { name: 'Add neighborhood / village' }).click(),
  ]);
  expect(res.status()).toBe(201);
  return (await res.json()).data as { id: string };
}

async function deactivate(page: Page, id: string) {
  const row = page.getByTestId(`zone-row-${id}`);
  if ((await row.getByTestId('zone-status').textContent()) === 'Active') {
    await row.getByTestId('zone-toggle').click();
    await expect(row.getByTestId('zone-status')).toHaveText('Inactive');
  }
}

test.describe('Admin — Delivery Zones', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  test('lists zones (Abu Naseeb is seeded) with city, fee and status', async ({ page }) => {
    await openPage(page);
    await expect(page.getByTestId('zones-hatly-rule')).toHaveText("Hatly & Wasally: fee = base fee × the Hatly & Wasally multiplier (Settings). For a manually chosen area the base fee is this zone's fee; a GPS address uses road distance instead.");
    const table = page.getByTestId('zones-table');
    await expect(table).toBeVisible();
    await expect(table).toContainText('أبو نصيب');
    await expect(table).toContainText('بلبيس');
    await expect(table).toContainText('EGP');
  });

  test('create → edit → change fee → deactivate/activate, all through the real API', async ({ page }) => {
    const id = unique();
    await openPage(page);
    const zone = await createZone(page, { name: `PW Zone ${id}`, nameAr: `منطقة تجربة ${id}`, fee: '17.50' });
    const row = page.getByTestId(`zone-row-${zone.id}`);
    await expect(row.getByTestId('zone-fee-value')).toHaveText('17.50 EGP');
    await expect(row.getByTestId('zone-status')).toHaveText('Active');

    // edit names / order / representative point
    await row.getByTestId('zone-edit').click();
    const form = page.getByTestId('zone-form');
    await form.getByTestId('zone-name').fill(`PW Zone ${id} edited`);
    await form.getByTestId('zone-advanced-toggle').click();
    await form.getByTestId('zone-lat').fill('30.41');
    await form.getByTestId('zone-lng').fill('31.55');
    await form.getByRole('button', { name: 'Save changes' }).click();
    await expect(row).toContainText(`PW Zone ${id} edited`);
    await expect(row).toContainText('30.41, 31.55');

    // fee change — applies to new quotes only (the backend e2e proves placed orders keep theirs)
    await row.getByTestId('zone-fee-edit').click();
    await row.getByTestId('zone-fee-input').fill('22');
    const [feeRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(`/admin/delivery-zones/${zone.id}/delivery-fee`)),
      row.getByTestId('zone-fee-save').click(),
    ]);
    expect(await feeRes.json()).toMatchObject({ data: { deliveryFeeMinor: 2200 } });
    await expect(row.getByTestId('zone-fee-value')).toHaveText('22.00 EGP');

    await row.getByTestId('zone-toggle').click();
    await expect(row.getByTestId('zone-status')).toHaveText('Inactive');
    await row.getByTestId('zone-toggle').click();
    await expect(row.getByTestId('zone-status')).toHaveText('Active');
    await deactivate(page, zone.id);
  });

  test('form validation happens before anything is sent: missing names, a bad fee, half a point', async ({ page }) => {
    let posted = 0;
    page.on('request', (r) => r.method() === 'POST' && r.url().endsWith('/admin/delivery-zones') && posted++);
    await openPage(page);
    await page.getByTestId('zone-new').click();
    const form = page.getByTestId('zone-form');
    // With a single service area it is preselected; the first missing required field is then the city.
    await form.getByRole('button', { name: 'Add neighborhood / village' }).click();
    await expect(page.getByTestId('zone-form-error')).toHaveText('City (EN) is required.');
    await form.getByTestId('zone-advanced-toggle').click();
  await form.getByTestId('zone-service-area').selectOption({ label: 'Belbeis / بلبيس' });
    await form.getByTestId('zone-city').fill('Belbeis');
    await form.getByTestId('zone-city-ar').fill('بلبيس');
    await form.getByTestId('parent-zone-name').fill('Belbeis Zone');
    await form.getByTestId('parent-zone-name-ar').fill('منطقة بلبيس');
    await form.getByTestId('zone-name').fill('X');
    await form.getByTestId('zone-name-ar').fill('س');
    await form.getByTestId('zone-fee').fill('abc');
    await form.getByRole('button', { name: 'Add neighborhood / village' }).click();
    await expect(page.getByTestId('zone-form-error')).toContainText('Delivery fee must be an amount in EGP');
    await form.getByTestId('zone-fee').fill('15');
    await form.getByTestId('zone-lat').fill('30.4');
    await form.getByRole('button', { name: 'Add neighborhood / village' }).click();
    await expect(page.getByTestId('zone-form-error')).toHaveText('Enter both representative latitude and longitude, or neither.');
    expect(posted).toBe(0);
  });

  test('a duplicate child under the SAME parent is a 409; same name under another parent remains allowed', async ({ page }) => {
    await openPage(page);
    const en = `Dup Child ${unique()}`;
    const ar = `حي مكرر ${unique()}`;
    const first = await createZone(page, { name: en, nameAr: ar, fee: '15' });
    try {
      await page.getByTestId('zone-new').click();
      const form = page.getByTestId('zone-form');
      await form.getByTestId('zone-advanced-toggle').click();
  await form.getByTestId('zone-service-area').selectOption({ label: 'Belbeis / بلبيس' });
      await form.getByTestId('zone-city').fill('Belbeis');
      await form.getByTestId('zone-city-ar').fill('بلبيس');
      await form.getByTestId('parent-zone-name').fill('Belbeis Zone');
      await form.getByTestId('parent-zone-name-ar').fill('منطقة بلبيس');
      await form.getByTestId('zone-name').fill(en);
      await form.getByTestId('zone-name-ar').fill(ar);
      await form.getByTestId('zone-fee').fill('15');
      await form.getByRole('button', { name: 'Add neighborhood / village' }).click();
      await expect(page.getByTestId('zone-form-error')).toHaveText('A neighborhood/village with this name already exists in this delivery zone.');
    } finally {
      await page.getByTestId('zone-new').click();
      await deactivate(page, first.id);
    }
  });

  test('rejects multiple villages in one name before posting', async ({ page }) => {
    let posted = 0;
    page.on('request', (r) => r.method() === 'POST' && r.url().endsWith('/admin/delivery-zones') && posted++);
    await openPage(page);
    await page.getByTestId('zone-new').click();
    const form = page.getByTestId('zone-form');
    await form.getByTestId('zone-advanced-toggle').click();
  await form.getByTestId('zone-service-area').selectOption({ label: 'Belbeis / بلبيس' });
    await form.getByTestId('zone-city').fill('Belbeis');
    await form.getByTestId('zone-city-ar').fill('بلبيس');
    await form.getByTestId('parent-zone-name').fill('Belbeis Zone');
    await form.getByTestId('parent-zone-name-ar').fill('منطقة بلبيس');
    await form.getByTestId('zone-name').fill('North, South');
    await form.getByTestId('zone-name-ar').fill('الشمال، الجنوب');
    await form.getByTestId('zone-fee').fill('15');
    await form.getByRole('button', { name: 'Add neighborhood / village' }).click();
    await expect(page.getByTestId('zone-form-error')).toContainText('Add each neighborhood/village separately');
    expect(posted).toBe(0);
  });

  test('an admin WITHOUT the delivery-pricing permission cannot create zones or change fees, but can still manage structure', async ({ page }) => {
    await page.route(ME_URL, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { role: 'ADMIN', permissions: ['MANAGE_SERVICE_AREAS'] } }) }),
    );
    await openPage(page);
    await expect(page.getByTestId('zone-new')).toBeDisabled();
    const firstRow = page.locator('[data-testid^="zone-row-"]').first();
    await expect(firstRow.getByTestId('zone-fee-edit')).toBeDisabled();
    await expect(firstRow.getByTestId('zone-edit')).toBeEnabled();
    await expect(firstRow.getByTestId('zone-toggle')).toBeEnabled();
  });

  test('a backend 403 on a fee change is shown, never swallowed', async ({ page }) => {
    await openPage(page);
    const zone = await createZone(page, { name: `PW 403 ${unique()}`, nameAr: `منطقة ٤٠٣ ${unique()}`, fee: '15' });
    await page.route(/\/admin\/delivery-zones\/[0-9a-f-]+\/delivery-fee$/, (route) =>
      route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Forbidden' } }) }),
    );
    const row = page.getByTestId(`zone-row-${zone.id}`);
    await row.getByTestId('zone-fee-edit').click();
    await row.getByTestId('zone-fee-input').fill('30');
    await row.getByTestId('zone-fee-save').click();
    await expect(row.getByTestId('zone-fee-error')).toHaveText('You do not have permission for this action.');
    await page.unroute(/\/admin\/delivery-zones\/[0-9a-f-]+\/delivery-fee$/);
    await row.getByRole('button', { name: 'Cancel' }).click();
    await deactivate(page, zone.id);
  });

  test('Settings: the Hatly & Wasally multiplier explains the formula and refuses an invalid value', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByText('Hatly / Wasally fee = base fee × this multiplier', { exact: false })).toBeVisible();
    // The multiplier applies once to the base fee (zone fee or GPS road-distance fee) — never to the per-100 m price itself.
    const help = page.locator('p', { hasText: 'Hatly / Wasally fee = base fee' });
    await expect(help).toContainText('never applied to the per-100 m price itself');
    await expect(page.getByText('Normal Delivery Fee', { exact: false })).toHaveCount(0);
    const input = page.getByTestId('config-input-HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER');
    await expect(input).toHaveValue('1.5');
    const row = page.locator('div', { has: input }).last();
    await input.fill('0');
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(row.getByText('Enter a positive number up to 10 (e.g. 1.5).')).toBeVisible();
    await input.fill('1.5');
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(row.getByText('Saved')).toBeVisible();
  });

  test('Settings: a load that arrives AFTER the admin typed never overwrites what they typed (no silent save of the old value)', async ({ page }) => {
    // The field appears after the first load; any LATER load of the same value (React StrictMode re-runs the effect in
    // development) is held back until the admin has typed — its late response must not replace their value.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let gets = 0;
    await page.route(/\/admin\/business-config\/HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER$/, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      if (++gets > 1) await held;
      await route.continue();
    });
    await page.goto('/settings');
    const input = page.getByTestId('config-input-HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER');
    await expect(input).toBeVisible();
    await expect(input).toHaveValue('1.5');
    await input.fill('0');
    release();
    await page.waitForLoadState('networkidle');
    await expect(input).toHaveValue('0');
    const row = page.locator('div', { has: input }).last();
    let puts = 0;
    page.on('request', (r) => r.method() === 'PUT' && r.url().includes('HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER') && puts++);
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(row.getByText('Enter a positive number up to 10 (e.g. 1.5).')).toBeVisible();
    expect(puts).toBe(0);
  });
});
