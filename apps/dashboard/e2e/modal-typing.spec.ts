import { test, expect } from '@playwright/test';
import { SUPER_ADMIN_STORAGE_STATE } from './env';

/**
 * Owner report (2026-11-15): "typing numbers in the admin panel stops after the first digit or letter". Every modal reset the focus on
 * each keystroke (its effect depended on the caller's inline onClose). Typing a whole value into a field that is NOT the first one must
 * keep the focus in that field and keep every character. Nothing is saved: the modal is closed with Cancel.
 */
test.describe('Modals keep the cursor while typing', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  test('New vehicle type: a whole word in the 2nd field and a multi-digit number in the 3rd stay as typed', async ({ page }) => {
    await page.goto('/vehicle-types');
    await page.getByRole('button', { name: 'New vehicle type' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const arabic = dialog.getByLabel('Name (Arabic, optional)');
    await arabic.click();
    await page.keyboard.type('موتوسيكل', { delay: 40 });
    await expect(arabic).toHaveValue('موتوسيكل');
    await expect(arabic).toBeFocused();
    const max = dialog.getByLabel('Max active deliveries');
    await max.fill('');
    await max.click();
    await page.keyboard.type('123', { delay: 40 });
    await expect(max).toHaveValue('123');
    await expect(max).toBeFocused();
    await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue(''); // the first field was never refocused and typed into
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });
});
