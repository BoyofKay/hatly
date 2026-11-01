import { createHmac } from 'crypto';
import { test, expect } from '@playwright/test';
import { API_BASE_URL, MFA_ADMIN_PASSWORD, MFA_ADMIN_PHONE } from './env';

/**
 * Two-factor authentication in a real browser: enrol an authenticator from the Security page, sign out, sign in with the code, turn it off
 * again. Uses the dedicated dev ADMIN (see env.ts); skips itself when that account does not exist. RFC 6238 TOTP is computed here with
 * Node's crypto, exactly as an authenticator app would. Leaves the account without an authenticator.
 */
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function totp(secretBase32: string, offsetSteps = 0): string {
  let bits = '';
  for (const ch of secretBase32.replace(/=+$/, '').toUpperCase()) bits += BASE32.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(Array.from({ length: Math.floor(bits.length / 8) }, (_, i) => parseInt(bits.slice(i * 8, i * 8 + 8), 2)));
  const counter = Math.floor(Date.now() / 1000 / 30) + offsetSteps;
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1_000_000).padStart(6, '0');
}

test('an admin enrols an authenticator, then signing in needs the code, and the second factor can be removed again', async ({ page, request }) => {
  const probe = await request.post(`${API_BASE_URL}/auth/dashboard/login`, { data: { phone: MFA_ADMIN_PHONE, password: MFA_ADMIN_PASSWORD } });
  test.skip(probe.status() === 401 && (await probe.json()).error?.details?.code !== 'MFA_REQUIRED', 'the dedicated MFA dev admin does not exist in this database');
  // If a previous interrupted run left an authenticator enabled we cannot continue without its secret.
  test.skip((await probe.json().catch(() => ({}))).error?.details?.code === 'MFA_REQUIRED', 'the MFA dev admin already has an authenticator from an interrupted run');

  // sign in (password only) and enrol
  await page.goto('/login');
  await page.getByLabel('Phone number').fill(MFA_ADMIN_PHONE);
  await page.getByLabel('Password').fill(MFA_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(home|control-tower|executive)$/);
  await page.goto('/security');
  await page.getByTestId('mfa-begin').click();
  const secret = (await page.getByTestId('mfa-secret').innerText()).trim();
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  await page.getByTestId('mfa-code').fill('000000');
  await page.getByTestId('mfa-enable').click();
  await expect(page.getByTestId('security-error')).toBeVisible(); // a wrong code does not enable it
  await page.getByTestId('mfa-code').fill(totp(secret));
  await page.getByTestId('mfa-enable').click();
  await expect(page.getByTestId('recovery-codes')).toBeVisible();
  await expect(page.getByTestId('recovery-codes').locator('li')).toHaveCount(8);
  const recoveryCode = (await page.getByTestId('recovery-codes').locator('li').first().innerText()).trim();
  await page.getByTestId('recovery-codes-done').click();
  await expect(page.getByTestId('mfa-status')).toHaveText(/ON/);

  // sign out, then password alone is no longer enough
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Phone number').fill(MFA_ADMIN_PHONE);
  await page.getByLabel('Password').fill(MFA_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByLabel('Verification code')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Verification code').fill('123456');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText(/verification code is not valid/i)).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Verification code').fill(totp(secret, 1)); // the NEXT step: the used one cannot be replayed
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(home|control-tower|executive)$/);

  // remove it again (password + a recovery code — the authenticator's current step was just used to sign in and a code works once)
  // so the account is left as found
  await page.goto('/security');
  await expect(page.getByTestId('mfa-status')).toBeVisible();
  await page.getByTestId('mfa-disable-password').fill(MFA_ADMIN_PASSWORD);
  await page.getByTestId('mfa-disable-code').fill(recoveryCode);
  await page.getByTestId('mfa-disable').click();
  await expect(page.getByTestId('mfa-begin')).toBeVisible();
});
