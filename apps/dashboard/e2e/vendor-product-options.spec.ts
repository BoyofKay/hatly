import { test, expect } from '@playwright/test';
import { VENDOR_A_PRODUCT_ID, VENDOR_A_STORAGE_STATE } from './env';

/**
 * Vendor product options ("modifiers") in a real browser against the REAL dev backend/database. The vendor manages the option groups of
 * their own product through the same UI/API an admin would use; every group the test creates is deleted again (also on failure) so the
 * fixture product stays option-free for the other specs. The server's rules (coherent limits, no negative prices…) are proven in the backend
 * e2e suite (test/e2e/42-product-option-management); here we check the screen drives them and shows the server's refusals.
 */
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

test.describe('Vendor — product options', () => {
  test.use({ storageState: VENDOR_A_STORAGE_STATE });

  test('create a group, change a price, add a value, see the server refuse a bad one, delete the group', async ({ page }) => {
    page.on('dialog', (d) => d.accept());
    const name = `PW Size ${unique()}`;
    await page.goto('/products');
    await page.getByTestId(`product-options-toggle-${VENDOR_A_PRODUCT_ID}`).click();
    const editor = page.getByTestId(`options-editor-${VENDOR_A_PRODUCT_ID}`);
    await expect(editor).toBeVisible();

    let groupId: string | null = null;
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
      groupId = (await created.json()).data.id as string;

      const card = editor.getByTestId(`option-group-${groupId}`);
      await expect(card.getByTestId('option-group-summary')).toHaveText('Single choice · required');
      await expect(card).toContainText('Small');
      await expect(card).toContainText('+6.50 EGP');

      // change the price of "Large"
      const large = card.locator('li', { hasText: 'Large' });
      await large.getByTestId('option-value-price-edit').click();
      await large.getByTestId('option-value-price-input').fill('7');
      await large.getByTestId('option-value-price-save').click();
      await expect(large.getByTestId('option-value-price-text')).toHaveText('+7.00 EGP');

      // add a value
      await card.getByTestId('option-value-name').fill('Family');
      await card.getByTestId('option-value-price').fill('12');
      await card.getByTestId('option-value-add').click();
      await expect(card).toContainText('Family');

      // a duplicate name is refused by the SERVER and the message is shown
      await card.getByTestId('option-value-name').fill('family');
      await card.getByTestId('option-value-add').click();
      await expect(card.getByTestId('option-group-error')).toContainText(/already has a value/i);

      // a price that is not an amount never reaches the server
      await card.getByTestId('option-value-name').fill('Weird');
      await card.getByTestId('option-value-price').fill('abc');
      await card.getByTestId('option-value-add').click();
      await expect(card.getByTestId('option-group-error')).toContainText('Enter the price in EGP');
    } finally {
      if (groupId) {
        const card = editor.getByTestId(`option-group-${groupId}`);
        if (await card.count()) {
          await Promise.all([
            page.waitForResponse((r) => r.url().includes(`/vendor/product-options/${groupId}`) && r.request().method() === 'DELETE'),
            card.getByTestId('option-group-delete').click(),
          ]);
          await expect(card).toHaveCount(0);
        }
      }
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
