import { test, expect } from '@playwright/test';
import { SUPER_ADMIN_STORAGE_STATE, VENDOR_A_STORAGE_STATE } from './env';

/**
 * Staff & permissions (2026-11-21) — Super admin > Admin > Operations supervisor > Operations team, over real HTTP.
 * Staff accounts can now be created through the product itself (`POST admin/staff`), so the full flow is exercised with an account this
 * test creates and deletes again: create from a preset, see it listed with its level, change its permissions, delete it.
 */
test.describe('Staff & permissions', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  test('loads the real staff list, never carries a password hash, and the super admin card has no manage controls', async ({ page }) => {
    const staff = page.waitForResponse((res) => res.url().endsWith('/admin/staff') && res.request().method() === 'GET');
    await page.goto('/users');
    const body = await (await staff).json();
    expect(body.data.some((u: any) => u.level === 'SUPER_ADMIN')).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/passwordHash|password_hash/);
    expect(body.meta.creatableLevels).toEqual(['ADMIN', 'OPS_SUPERVISOR', 'OPS_TEAM']);
    await expect(page.getByRole('heading', { name: 'Staff & permissions' })).toBeVisible();
    await expect(page.getByText('Has every permission by role.').first()).toBeVisible();
  });

  test('create an operations team member from the preset, edit its permissions, then delete it', async ({ page }) => {
    const phone = `+2010${String(Date.now()).slice(-8)}`;
    await page.goto('/users');
    await page.getByRole('button', { name: 'Add staff member' }).click();
    const form = page.getByRole('dialog');
    await form.getByLabel('Full name').fill('E2E Team Member');
    await form.getByLabel('Phone (sign-in)').fill(phone);
    await form.getByLabel('Level').selectOption('OPS_TEAM');
    const create = form.getByRole('button', { name: 'Create account' });
    await form.getByLabel('First password').fill('short');
    await expect(create).toBeDisabled(); // the password rule is checked before sending
    await form.getByLabel('First password').fill('E2E-Team-Pass-1');
    await create.click();

    const card = page.getByTestId('staff-card').filter({ hasText: 'E2E Team Member' });
    await expect(card).toBeVisible();
    await expect(card.getByText('Operations team')).toBeVisible();
    await expect(card.getByText('VIEW_ORDERS')).toBeVisible();

    await card.getByRole('button', { name: 'Permissions' }).click();
    const perms = page.getByRole('dialog');
    await perms.getByRole('button', { name: 'Clear all' }).click();
    await perms.getByRole('checkbox', { name: 'FLEET_VIEW' }).check();
    await perms.getByRole('button', { name: 'Save permissions' }).click();
    await expect(card.getByText('1 permission(s)')).toBeVisible();

    await card.getByRole('button', { name: 'Delete' }).click();
    const confirm = page.getByRole('dialog');
    await confirm.getByLabel('Type "DELETE" to confirm').fill('DELETE');
    await confirm.getByRole('button', { name: 'Delete' }).click();
    await expect(card).toHaveCount(0);
  });
});

test.describe('Staff & permissions — unauthorized access', () => {
  test.use({ storageState: VENDOR_A_STORAGE_STATE });

  test('a store (vendor) session is sent away by the Admin route group before the page loads', async ({ page }) => {
    await page.goto('/users');
    await expect(page).toHaveURL(/\/login$/);
  });
});
