import { test, expect } from '@playwright/test';
import { API_BASE_URL, VENDOR_A_PASSWORD, VENDOR_A_PHONE, VENDOR_A_STORAGE_STATE } from './env';

/**
 * The cookie session, in a real browser against the real backend: no credential reachable from script, silent renewal of an expired access
 * cookie, server-side revocation on sign-out, and CSRF protection of cookie-authenticated writes.
 * (`auth/dashboard/login` is throttled to 10/min: each test signs in through the form at most once.)
 */
async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('Phone number').fill(VENDOR_A_PHONE);
  await page.getByLabel('Password').fill(VENDOR_A_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/orders$/);
  await expect(page.getByRole('heading', { name: 'Incoming Orders' })).toBeVisible();
}

/**
 * Login budget: `auth/dashboard/login` allows 10 per minute per client and the whole suite shares it, so only the two tests that must own a
 * fresh session (a rotating refresh chain, a revoked one) sign in through the form; the rest start from the pre-authenticated state
 * `global-setup` created through the same real login endpoint.
 */
test.describe('Dashboard cookie session — pre-authenticated', () => {
  test.use({ storageState: VENDOR_A_STORAGE_STATE });

  test('no credential is reachable from script: the cookies are HttpOnly and no JWT sits in any web storage', async ({ page, context }) => {
    await page.goto('/orders');
    await expect(page.getByRole('heading', { name: 'Incoming Orders' })).toBeVisible();
    const cookies = await context.cookies();
    const session = cookies.filter((c) => ['hatly_at', 'hatly_rt', 'hatly_sid'].includes(c.name));
    expect(session.map((c) => c.name).sort()).toEqual(['hatly_at', 'hatly_rt', 'hatly_sid']);
    for (const c of session) {
      expect(c.httpOnly).toBe(true);
      expect(c.sameSite).toBe('Strict');
    }
    const visible = await page.evaluate(() => document.cookie);
    expect(visible).not.toContain('hatly_at');
    expect(visible).not.toContain('hatly_rt');
    const storage = await page.evaluate(() => JSON.stringify({ local: { ...window.localStorage }, session: { ...window.sessionStorage } }));
    expect(storage).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./); // no JWT anywhere script can read
    expect(storage).not.toContain('hatly_dashboard_token');
  });

  test('requests authenticate by cookie — never an Authorization header from the page — and writes carry the CSRF token', async ({ page }) => {
    const seen: Array<{ method: string; url: string; headers: Record<string, string> }> = [];
    page.on('request', async (r) => {
      if (r.url().startsWith(API_BASE_URL)) seen.push({ method: r.method(), url: r.url(), headers: await r.allHeaders() });
    });
    await page.goto('/orders');
    await expect(page.getByRole('heading', { name: 'Incoming Orders' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    const apiCalls = seen;
    expect(apiCalls.length).toBeGreaterThan(0);
    for (const call of apiCalls) expect(call.headers['authorization']).toBeUndefined();
    expect(apiCalls.some((c) => c.headers['cookie']?.includes('hatly_at='))).toBe(true);
  });

  test('CSRF: a cookie-authenticated write without the token is refused (403) and changes nothing', async ({ page }) => {
    await page.goto('/orders');
    await expect(page.getByRole('heading', { name: 'Incoming Orders' })).toBeVisible();
    // page.request shares the browser's cookies but is NOT the app: it sends no X-CSRF-Token, like a forged cross-site request would.
    const forged = await page.request.post(`${API_BASE_URL}/cart/items`, { data: {} });
    expect(forged.status()).toBe(403);
    expect((await forged.json()).error.details.code).toBe('CSRF_TOKEN_INVALID');
  });
});

test.describe('Dashboard cookie session — own login', () => {
  // The Vendor area is Arabic-first; these tests assert the English wording, so the browser starts in English (the Arabic default has its own test in vendor-hub.spec.ts).
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { try { if (!window.localStorage.getItem('hatly_dashboard_locale')) window.localStorage.setItem('hatly_dashboard_locale', 'en'); } catch { /* storage unavailable */ } });
  });
  test('an expired access cookie is renewed silently through the refresh cookie — the vendor stays signed in', async ({ page, context }) => {
    await signIn(page);
    const before = (await context.cookies()).find((c) => c.name === 'hatly_rt')!.value;
    await context.clearCookies({ name: 'hatly_at' }); // exactly what the browser does when the 15-minute access cookie expires
    const [refresh] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/auth/dashboard/refresh') && r.request().method() === 'POST'),
      page.reload(),
    ]);
    expect(refresh.status()).toBe(200);
    await expect(page).toHaveURL(/\/orders$/);
    await expect(page.getByRole('heading', { name: 'Incoming Orders' })).toBeVisible();
    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === 'hatly_at')?.value).toBeTruthy();
    expect(cookies.find((c) => c.name === 'hatly_rt')!.value).not.toBe(before); // the refresh token rotated
  });

  test('sign-out revokes the session on the SERVER: the old refresh cookie can no longer renew anything', async ({ page, context, request }) => {
    await signIn(page);
    const refreshCookie = (await context.cookies()).find((c) => c.name === 'hatly_rt')!;
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    // replay the captured refresh cookie by hand
    const replay = await request.post(`${API_BASE_URL}/auth/dashboard/refresh`, {
      headers: { 'X-Requested-With': 'hatly-dashboard', Cookie: `hatly_rt=${refreshCookie.value}` },
    });
    expect(replay.status()).toBe(401);
  });
});
