import { test, expect } from '@playwright/test';
import { VENDOR_A_PHONE, VENDOR_A_PASSWORD, VENDOR_A_STORAGE_STATE } from './env';

/**
 * Sales Release Candidate hardening milestone — Vendor authentication, over a REAL browser against
 * the REAL Next.js dev server and REAL backend.
 *
 * `auth/password/login` is REAL-throttled (10 requests/60s — a genuine, intentional brute-force
 * guard, not a test artifact: reproduced once already, confirmed via the exact "Invalid phone
 * number or password" fallback text a 429 also produces). Only the two tests that must exercise the
 * login FORM itself submit it for real; every other scenario starts from a pre-authenticated
 * `storageState` instead of spending more of that same budget on a redundant UI login.
 */
test.describe('Vendor authentication — real login form', () => {
  // The Vendor area is Arabic-first; these tests assert the English wording, so the browser starts in English (the Arabic default has its own test in vendor-hub.spec.ts).
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { try { if (!window.localStorage.getItem('hatly_dashboard_locale')) window.localStorage.setItem('hatly_dashboard_locale', 'en'); } catch { /* storage unavailable */ } });
  });
  test('an unauthenticated visitor to a vendor route is redirected to /login', async ({ page }) => {
    await page.goto('/orders');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('wrong credentials show a clear error and never navigate past /login', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Phone number').fill(VENDOR_A_PHONE);
    await page.getByLabel('Password').fill('definitely-the-wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByText(/invalid phone number or password/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('a real login navigates to the order list, and the session survives a reload', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Phone number').fill(VENDOR_A_PHONE);
    await page.getByLabel('Password').fill(VENDOR_A_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(/\/orders$/);
    await expect(page.getByRole('heading', { name: 'Incoming Orders' })).toBeVisible();

    // Reload while authenticated: the vendor stays in, never bounced back to /login.
    await page.reload();
    await expect(page).toHaveURL(/\/orders$/);
    await expect(page.getByRole('heading', { name: 'Incoming Orders' })).toBeVisible();
  });
});

test.describe('Vendor authentication — session lifecycle', () => {
  test.use({ storageState: VENDOR_A_STORAGE_STATE });

  test('sign out clears the session — the next visit to a vendor route redirects to /login', async ({ page }) => {
    await page.goto('/orders');
    await expect(page.getByRole('heading', { name: 'Incoming Orders' })).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto('/orders');
    await expect(page).toHaveURL(/\/login$/);
  });

  test(
    'REGRESSION (session-expiry fix): an invalid/expired session is not left stuck on a broken page — the first API call ' +
      'ends the session cleanly and redirects to /login',
    async ({ page, context }) => {
      await page.goto('/orders');
      await expect(page.getByRole('heading', { name: 'Incoming Orders' })).toBeVisible();

      // The session now lives in HttpOnly cookies: replace BOTH with garbage, as a revoked / tampered session looks from the browser.
      // The page still has its locally-kept profile (so its own mount-time guard lets it render), but the API rejects the cookie (401),
      // the transparent refresh is refused too, and the only sensible outcome is the login screen.
      const cookies = await context.cookies();
      await context.addCookies(cookies.filter((c) => c.name === 'hatly_at' || c.name === 'hatly_rt').map((c) => ({ ...c, value: 'not-a-real-token' })));

      await page.reload();
      await expect(page).toHaveURL(/\/login$/, { timeout: 10_000 });
      expect(await page.evaluate(() => window.localStorage.getItem('hatly_dashboard_user'))).toBeNull();
    },
  );
});
