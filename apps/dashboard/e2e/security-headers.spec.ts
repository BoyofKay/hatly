import { test, expect } from '@playwright/test';

/** The dashboard sends the security headers (CSP incl. frame-ancestors none, no framing, no MIME sniffing) on every page. */
test.describe('Dashboard security headers', () => {
  test('the login page carries the CSP and anti-framing headers', async ({ request }) => {
    const res = await request.get('/login');
    expect(res.status()).toBe(200);
    const h = res.headers();
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(h['permissions-policy']).toContain('camera=()');
    const csp = h['content-security-policy'];
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toMatch(/connect-src 'self' http:\/\/localhost:3000/);
  });

  test('the CSP does not break the app: a signed-in admin page still loads and renders its data', async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'e2e/.auth/super-admin.json' });
    const page = await context.newPage();
    const violations: string[] = [];
    page.on('console', (m) => {
      if (m.text().includes('Content Security Policy')) violations.push(m.text());
    });
    await page.goto('/sectors');
    await expect(page.getByTestId('sectors-table')).toBeVisible();
    expect(violations).toEqual([]);
    await context.close();
  });
});
