import { test, expect, Page } from '@playwright/test';
import { VENDOR_A_BRANCH_ID, VENDOR_A_PRODUCT_ID, VENDOR_A_STORAGE_STATE, SUPER_ADMIN_STORAGE_STATE } from './env';
import { adminApi } from './control-tower-fixtures';

/**
 * The vendor operations screens in a real browser against the REAL dev backend: a manager's team management, branch closures (and their effect on the
 * branch status), the stock history and stocktake, and the Financial Centre. Money, isolation and authorization are proven in the backend suite
 * (test/e2e/129-vendor-operations); here the screens must drive them and show their refusals. Everything a test creates is undone in `finally`.
 */
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Visible elements that stick out of the viewport and are NOT inside a horizontally scrollable container (i.e. content the person cannot reach). */
async function clippedElements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const scrolls = (el: Element | null): boolean => {
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        const o = getComputedStyle(n).overflowX;
        if (o === 'auto' || o === 'scroll') return true;
      }
      return false;
    };
    return [...document.querySelectorAll('main *')]
      .filter((e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.position !== 'fixed' && (document.documentElement.dir === 'rtl' ? r.left < -2 : r.right > vw + 2) && !scrolls(e.parentElement); })
      .slice(0, 5)
      .map((e) => `${e.tagName}.${String(e.className).slice(0, 50)}`);
  });
}

test.describe('Vendor — operations', () => {
  test.use({ storageState: VENDOR_A_STORAGE_STATE });

  test('team: a manager adds an operator, switches the account off and on, and sees what stays with Hatly', async ({ page }) => {
    const phone = `+20110${String(Date.now()).slice(-7)}`;
    const name = `PW Operator ${unique()}`;
    await page.goto('/team');
    await expect(page.getByTestId('team-hatly-only')).toBeVisible();
    await page.getByTestId('team-add').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Full name').fill(name);
    await dialog.getByLabel('Phone number').fill(phone);
    await dialog.getByLabel('Password').fill('Playwright-Dev-1!');
    const [created] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/vendor/team/members') && r.request().method() === 'POST'),
      dialog.getByRole('button', { name: 'Create account' }).click(),
    ]);
    expect(created.status()).toBe(201);
    const userId = (await created.json()).data.id as string;
    try {
      const row = page.locator('tr', { hasText: name });
      await expect(row).toBeVisible();
      await expect(row).toContainText('Operator');
      // The refusal for a phone that already has an account is shown, not swallowed.
      await page.getByTestId('team-add').click();
      await page.getByRole('dialog').getByLabel('Full name').fill('Duplicate');
      await page.getByRole('dialog').getByLabel('Phone number').fill(phone);
      await page.getByRole('dialog').getByLabel('Password').fill('Playwright-Dev-1!');
      await page.getByRole('dialog').getByRole('button', { name: 'Create account' }).click();
      await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

      await row.getByRole('button', { name: 'Deactivate' }).click();
      await Promise.all([
        page.waitForResponse((r) => r.url().endsWith(`/vendor/team/members/${userId}/active`) && r.ok()),
        page.getByRole('dialog').getByRole('button', { name: 'Deactivate' }).click(),
      ]);
      await expect(row).toContainText('Inactive');
      await row.getByRole('button', { name: 'Activate' }).click();
      await Promise.all([
        page.waitForResponse((r) => r.url().endsWith(`/vendor/team/members/${userId}/active`) && r.ok()),
        page.getByRole('dialog').getByRole('button', { name: 'Activate' }).click(),
      ]);
      await expect(row).toContainText('Active');
      // Managers and the caller themself offer no management buttons.
      const you = page.locator('tr', { hasText: 'You' }).first();
      await expect(you.getByRole('button', { name: /Deactivate|Activate/ })).toHaveCount(0);
    } finally {
      await adminApi().patch(`/admin/vendor-staff/${userId}/deactivate`).catch(() => undefined);
    }
  });

  // R44 (decision register 2026-11-07): a vendor REQUESTS a closure and its early end; each takes effect only when Hatly approves it.
  test('closures: a closure request waits for Hatly; once approved the branch is closed to customers; an approved early end reopens it', async ({ page }) => {
    const approve = async (id: string) => expect((await adminApi().post(`/admin/branch-change-requests/${id}/approve`, {})).status).toBe(201);
    await page.goto('/my-branches');
    const box = page.getByTestId(`closures-${VENDOR_A_BRANCH_ID}`);
    await expect(box).toBeVisible();
    await page.getByTestId(`closure-new-${VENDOR_A_BRANCH_ID}`).click();
    const dialog = page.getByRole('dialog');
    // A reason shorter than 3 characters is refused by the server and the refusal is shown.
    await dialog.getByLabel('Reason').fill('x');
    await dialog.getByRole('button', { name: 'Schedule', exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await dialog.getByLabel('Reason').fill(`PW water cut ${unique()}`);
    const [created] = await Promise.all([
      page.waitForResponse((r) => /\/vendor\/branches\/[^/]+\/closures$/.test(r.url()) && r.request().method() === 'POST'),
      dialog.getByRole('button', { name: 'Schedule', exact: true }).click(),
    ]);
    expect(created.status()).toBe(201);
    const request = (await created.json()).data.request as { id: string; kind: string; status: string };
    expect(request).toMatchObject({ kind: 'CLOSURE', status: 'PENDING' });
    let closureId: string | null = null;
    try {
      await expect(page.getByTestId(`branch-requests-${VENDOR_A_BRANCH_ID}`)).toContainText('Waiting for Hatly');
      await expect(box).not.toContainText('Closed to customers'); // nothing changes before approval
      await approve(request.id);
      closureId = (await adminApi().get(`/admin/vendor-branches/${VENDOR_A_BRANCH_ID}/closures`)).data.data.current.active.id;
      await page.reload();
      await expect(box).toContainText('Closed to customers');
      await expect(page.getByText('Closed by a scheduled closure')).toBeVisible();

      await box.getByRole('button', { name: 'Cancel', exact: true }).first().click();
      const [ended] = await Promise.all([
        page.waitForResponse((r) => r.url().endsWith(`/closures/${closureId}`) && r.request().method() === 'DELETE' && r.ok()),
        page.getByRole('dialog').getByRole('button', { name: 'Cancel closure' }).click(),
      ]);
      await expect(box).toContainText('Closed to customers'); // the early end also waits for Hatly
      await approve((await ended.json()).data.request.id);
      await page.reload();
      await expect(box).not.toContainText('Closed to customers');
    } finally {
      const reqs = (await adminApi().get('/admin/branch-change-requests', { params: { status: 'PENDING' } })).data.data as any[];
      for (const r of reqs.filter((x) => x.branchId === VENDOR_A_BRANCH_ID)) await adminApi().post(`/admin/branch-change-requests/${r.id}/reject`, { note: 'test cleanup' }).catch(() => undefined);
      if (closureId) await adminApi().delete(`/admin/vendor-branches/${VENDOR_A_BRANCH_ID}/closures/${closureId}`).catch(() => undefined);
    }
  });

  test('stock history: the ledger banner, a tracked product’s movements, and a stocktake from count to variance to apply', async ({ page }) => {
    const original = (await adminApi().get(`/admin/products/${VENDOR_A_PRODUCT_ID}`)).data.data;
    await adminApi().patch(`/admin/products/${VENDOR_A_PRODUCT_ID}`, { inventoryMode: 'TRACKED', quantity: 10 });
    let stocktakeId: string | null = null;
    try {
      await page.goto('/stock-history');
      await expect(page.getByTestId('ledger-started')).toContainText('complete from');
      await page.getByTestId('movements-search').fill(original.name);
      const rows = page.locator('tr', { hasText: original.name });
      await expect(rows.first()).toBeVisible();
      await expect(rows.first()).toContainText('+10');

      await page.getByRole('tab', { name: 'Stocktake' }).click();
      const [started] = await Promise.all([
        page.waitForResponse((r) => r.url().endsWith('/vendor/inventory/stocktakes') && r.request().method() === 'POST'),
        (async () => { await page.getByTestId('stocktake-start').click(); await page.getByRole('dialog').getByRole('button', { name: 'Start', exact: true }).click(); })(),
      ]);
      expect(started.status()).toBe(201);
      stocktakeId = (await started.json()).data.id as string;
      const detail = page.getByTestId('stocktake-detail');
      await expect(detail).toBeVisible();
      const input = page.getByTestId(`st-count-${VENDOR_A_PRODUCT_ID}`);
      await Promise.all([page.waitForResponse((r) => r.url().includes(`/lines/${VENDOR_A_PRODUCT_ID}`) && r.ok()), (async () => { await input.fill('7'); await input.blur(); })()]);
      const line = page.getByTestId(`st-line-${VENDOR_A_PRODUCT_ID}`);
      await expect(line).toContainText('-3');
      await Promise.all([
        page.waitForResponse((r) => r.url().endsWith(`/stocktakes/${stocktakeId}/apply`) && r.ok()),
        (async () => { await page.getByTestId('stocktake-apply').click(); await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click(); })(),
      ]);
      expect((await adminApi().get(`/admin/products/${VENDOR_A_PRODUCT_ID}`)).data.data.quantity).toBe(7);
      stocktakeId = null;
      await page.getByRole('button', { name: /All stocktakes/ }).click();
      await page.getByRole('tab', { name: 'Movements' }).click();
      await page.getByTestId('movements-search').fill(original.name);
      await expect(page.locator('tr', { hasText: 'Stocktake' }).first()).toContainText('-3');
    } finally {
      if (stocktakeId) await page.request.post(`${process.env.PLAYWRIGHT_API_BASE_URL ?? 'http://localhost:3000/api/v1'}/vendor/inventory/stocktakes/${stocktakeId}/cancel`).catch(() => undefined);
      await adminApi().patch(`/admin/products/${VENDOR_A_PRODUCT_ID}`, { inventoryMode: original.inventoryMode, quantity: original.quantity ?? undefined }).catch(() => undefined);
    }
  });

  test('financial centre: each concept on its own, “not configured” frequency, and an honest “not recorded” section', async ({ page }) => {
    await page.goto('/finance');
    await expect(page.getByRole('heading', { name: 'Financial centre' })).toBeVisible();
    await expect(page.getByTestId('finance-terms')).toBeVisible();
    await expect(page.getByTestId('finance-not-recorded')).toContainText('not recorded');
    await expect(page.getByTestId('finance-not-recorded')).toContainText('no balance is shown');
    await expect(page.getByText('Commission owed to Hatly').first()).toBeVisible();
    await expect(page.getByText(/net payable|balance due/i)).toHaveCount(0);
    // The statement downloads as a CSV file with the documented columns and no customer data.
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('finance-export').click()]);
    expect(download.suggestedFilename()).toMatch(/^hatly-vendor-statement-.*\.csv$/);
    const stream = await download.createReadStream();
    let text = '';
    for await (const chunk of stream) text += chunk.toString();
    expect(text.replace(/^\ufeff/, '').split('\n')[0]).toBe('order_number,completed_on,branch,payment_method,goods_egp,commission_owed_to_hatly_egp');
    expect(text).not.toMatch(/phone|address|\+20\d{9}/i);
  });

  test('Arabic and phone width: the new screens read right-to-left and nothing is clipped off-screen', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: VENDOR_A_STORAGE_STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(() => { try { localStorage.setItem('hatly_dashboard_locale', 'ar'); } catch { /* storage unavailable */ } });
    const page = await ctx.newPage();
    try {
      for (const path of ['/team', '/my-branches', '/stock-history', '/finance']) {
        await page.goto(path);
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await page.waitForTimeout(800);
        expect(await clippedElements(page), `${path} has content outside the screen`).toEqual([]);
      }
      await page.goto('/finance');
      await expect(page.getByTestId('finance-frequency')).toContainText(/لم تُحدَّد|أسبوعيًا|شهريًا/); // contractual, the platform default, or not configured
    } finally {
      await ctx.close();
    }
  });
});

test.describe('Admin — settlement terms and branch closures', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  test('Admin sets a vendor’s settlement frequency (confirmed) and the vendor sees it; clearing returns to “not configured”', async ({ page, browser }) => {
    const vendorId = (await adminApi().get(`/admin/vendor-branches/${VENDOR_A_BRANCH_ID}`)).data.data.vendorId as string;
    await page.goto(`/vendors/${vendorId}`);
    const card = page.getByTestId('settlement-terms');
    await expect(card).toBeVisible();
    try {
      await card.getByLabel('Contractual frequency').selectOption('MONTHLY');
      await card.getByRole('button', { name: 'Save' }).click();
      await Promise.all([
        page.waitForResponse((r) => r.url().endsWith(`/admin/vendors/${vendorId}/settlement-terms`) && r.request().method() === 'PUT' && r.ok()),
        page.getByRole('dialog').getByRole('button', { name: 'Save' }).click(),
      ]);
      await expect(card).toContainText('Monthly');
      const vendorCtx = await browser.newContext({ storageState: VENDOR_A_STORAGE_STATE });
      const vp = await vendorCtx.newPage();
      await vp.goto('/finance');
      await expect(vp.getByTestId('finance-frequency')).toHaveText(/Monthly|شهريًا/);
      await vendorCtx.close();
    } finally {
      await adminApi().put(`/admin/vendors/${vendorId}/settlement-terms`, { frequency: null }).catch(() => undefined);
    }
    await page.reload();
    await expect(page.getByTestId('settlement-terms')).toContainText('Not configured');
  });
});
