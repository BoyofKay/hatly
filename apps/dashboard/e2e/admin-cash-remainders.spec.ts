import { test, expect } from '@playwright/test';
import { SUPER_ADMIN_STORAGE_STATE } from './env';

/**
 * M3a (Launch-Readiness Gap Audit, G-09) — Driver Cash Remainder review.
 * A fresh dev database has none (submitting one requires a real
 * driver + delivery + cash-paid order reaching ON_THE_WAY/DELIVERED —
 * out of proportion to provision just for this page's own coverage), so
 * this covers what a real run of this brand-new page actually shows:
 * the loading -> empty transition, never stuck loading forever. The
 * approve/reject confirmation-guard logic itself (identical shape to
 * the Driver Verification and Manual Transfer Refund guards, both
 * covered above with real requests) is exercised there instead of
 * being duplicated with fabricated remainder data here.
 */
test.describe('Admin Cash Remainders', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  test('loads and shows the empty state (no remainders pending) rather than staying stuck on Loading', async ({ page }) => {
    await page.goto('/cash-remainders');
    await expect(page.getByRole('heading', { name: 'Driver Cash Remainders' })).toBeVisible();
    await expect(page.getByText('No cash remainders awaiting review.')).toBeVisible();
  });
});
