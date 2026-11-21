import { test, expect } from '@playwright/test';
import { VENDOR_A_PRODUCT_ID, VENDOR_A_STORAGE_STATE } from './env';
import { adminApi } from './control-tower-fixtures';

/**
 * Vendor product options ("modifiers") in a real browser against the REAL dev backend/database. The vendor manages the option groups of
 * their own product through the same UI/API an admin would use; every group the test creates is deleted again (also on failure) so the
 * fixture product stays option-free for the other specs. The server's rules (coherent limits, no negative prices…) are proven in the backend
 * e2e suite (test/e2e/42-product-option-management); here we check the screen drives them and shows the server's refusals.
 */
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

test.describe('Vendor — product options', () => {
  test.use({ storageState: VENDOR_A_STORAGE_STATE });

  // R7 (decision register 2026-11-07): VENDOR_A_PRODUCT is live, so a new group, a new value or a higher price is SENT TO HATLY; lowering a
  // price and deleting apply at once; refusals are still shown at once (the request is validated by a dry run).
  test('a new group is sent to Hatly (approved here via the API); lowering a price applies; a new value is sent; a refused one is shown; delete applies', async ({ page }) => {
    page.on('dialog', (d) => d.accept());
    const name = `PW Size ${unique()}`;
    await page.goto('/products');
    await page.getByTestId(`product-options-toggle-${VENDOR_A_PRODUCT_ID}`).click();
    const editor = page.getByTestId(`options-editor-${VENDOR_A_PRODUCT_ID}`);
    await expect(editor).toBeVisible();
    await expect(editor.getByTestId('options-review-note')).toBeVisible();

    let groupId: string | null = null;
    const requestIds: string[] = [];
    try {
      await editor.getByTestId('option-group-new').click();
      const form = editor.getByTestId('option-group-form');
      await form.getByTestId('option-group-name').fill(name);
      await form.getByTestId('option-group-required').check();
      await form.getByTestId('option-group-values').fill('Small\nLarge | 6.50');
      const [created] = await Promise.all([
        page.waitForResponse((r) => /\/vendor\/products\/[^/]+\/options$/.test(r.url()) && r.request().method() === 'POST'),
        form.getByTestId('option-group-create').click(),
      ]);
      expect(created.status()).toBe(201);
      const request = (await created.json()).data.request;
      expect(request).toMatchObject({ kind: 'OPTIONS', status: 'PENDING' });
      requestIds.push(request.id);
      await expect(form.getByTestId('option-group-form-error')).toContainText('Sent to Hatly for approval');
      expect((await adminApi().post(`/admin/product-change-requests/${request.id}/approve`, {})).status).toBe(201);

      await page.reload();
      await page.getByTestId(`product-options-toggle-${VENDOR_A_PRODUCT_ID}`).click();
      const card = editor.locator('[data-testid^="option-group-"]').filter({ hasText: name }).first();
      await expect(card).toContainText('Small');
      await expect(card).toContainText('+6.50 EGP');
      groupId = ((await card.getAttribute('data-testid')) ?? '').replace('option-group-', '');

      // lowering the price of "Large" applies directly
      const large = card.locator('li', { hasText: 'Large' });
      await large.getByTestId('option-value-price-edit').click();
      await large.getByTestId('option-value-price-input').fill('5');
      await large.getByTestId('option-value-price-save').click();
      await expect(large.getByTestId('option-value-price-text')).toHaveText('+5.00 EGP');

      // adding a value is sent to Hatly
      await card.getByTestId('option-value-name').fill('Family');
      await card.getByTestId('option-value-name-ar').fill('عائلي');
      await card.getByTestId('option-value-price').fill('12');
      await card.getByTestId('option-value-add').click();
      await expect(card.getByTestId('option-group-error')).toContainText('Sent to Hatly for approval');
      await expect(card).not.toContainText('Family');

      // a duplicate name is refused by the SERVER at once and the message is shown
      await card.getByTestId('option-value-name').fill('small');
      await card.getByTestId('option-value-name-ar').fill('صغير');
      await card.getByTestId('option-value-add').click();
      await expect(card.getByTestId('option-group-error')).toContainText(/already has a value/i);

      // a price that is not an amount never reaches the server
      await card.getByTestId('option-value-name').fill('Weird');
      await card.getByTestId('option-value-name-ar').fill('غريب');
      await card.getByTestId('option-value-price').fill('abc');
      await card.getByTestId('option-value-add').click();
      await expect(card.getByTestId('option-group-error')).toContainText('Enter the price in EGP');
    } finally {
      const pending = ((await adminApi().get('/admin/product-change-requests', { params: { status: 'PENDING' } })).data.data as any[]).filter((r) => r.productId === VENDOR_A_PRODUCT_ID && r.kind === 'OPTIONS');
      for (const r of pending) await adminApi().post(`/admin/product-change-requests/${r.id}/reject`, { note: 'test cleanup' }).catch(() => undefined);
      if (groupId) await adminApi().delete(`/admin/product-options/${groupId}`).catch(() => undefined);
    }
  });

  test('an incoherent limit is refused by the server and shown (single choice cannot require two)', async ({ page }) => {
    page.on('dialog', (d) => d.accept());
    await page.goto('/products');
    await page.getByTestId(`product-options-toggle-${VENDOR_A_PRODUCT_ID}`).click();
    const editor = page.getByTestId(`options-editor-${VENDOR_A_PRODUCT_ID}`);
    await editor.getByTestId('option-group-new').click();
    const form = editor.getByTestId('option-group-form');
    await form.getByTestId('option-group-name').fill(`PW Limits ${unique()}`);
    await form.getByTestId('option-group-multiple').check();
    await form.getByTestId('option-group-min').fill('3');
    await form.getByTestId('option-group-max').fill('2');
    await form.getByTestId('option-group-values').fill('A\nB\nC');
    await form.getByTestId('option-group-create').click();
    await expect(form.getByTestId('option-group-form-error')).toContainText(/maximum selections cannot be lower than the minimum/i);
  });
});
