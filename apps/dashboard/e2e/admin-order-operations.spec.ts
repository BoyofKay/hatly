import { test, expect } from '@playwright/test';
import { SUPER_ADMIN_STORAGE_STATE, VENDOR_A_BRANCH_ID, VENDOR_A_STORAGE_STATE } from './env';
import { adminApi, orderDetail, placeNewOrder } from './control-tower-fixtures';

/**
 * Order operations in the real browser against the real dev backend: Hatly operations acting on a vendor's behalf (accept, then reject with
 * a required reason) with the history showing the on-behalf label, the per-branch acceptance mode, the persistent operations banner with its
 * navigation counter and 20-second polling, and the vendor's new-order indicator.
 */
test.describe('Admin order operations', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  test('accept on behalf of the vendor, then reject: the reason is required, the history says "on behalf", the order re-reads from the server', async ({ page }) => {
    const { orderId, segmentId } = await placeNewOrder();
    await page.goto(`/order-search/${orderId}`);
    const part = page.getByTestId(`segment-ops-${segmentId}`);
    await expect(part).toBeVisible();
    await expect(part.getByTestId('segment-status')).toHaveText('PENDING');

    await part.getByTestId('segment-action-CONFIRMED').click();
    await expect(part.getByTestId('segment-status')).toHaveText('CONFIRMED');
    await expect(part.getByTestId('segment-history')).toContainText('on behalf of the vendor');

    await part.getByTestId('segment-action-CANCELLED').click();
    await part.getByTestId('segment-reject-confirm').click(); // no reason typed
    await expect(part.getByTestId('segment-flash')).toHaveText('Enter the reason for the rejection.');
    expect((await orderDetail(orderId)).segments[0].status).toBe('CONFIRMED'); // nothing was sent

    await part.getByTestId('segment-reject-reason').fill('Vendor phoned: closed today');
    await part.getByTestId('segment-reject-confirm').click();
    await expect(part.getByTestId('segment-status')).toHaveText('CANCELLED');
    await expect(part.getByTestId('segment-rejection-reason')).toContainText('Vendor phoned: closed today');
    await expect(part.getByTestId('segment-history')).toContainText('Vendor phoned: closed today');
    const detail = await orderDetail(orderId);
    expect(detail.status).toBe('CANCELLED'); // the only vendor part was rejected → the whole order
    expect(detail.segments[0].history.at(-1)).toMatchObject({ toStatus: 'CANCELLED', onBehalfOfVendor: true });
  });

  test('the branch page shows and switches the acceptance mode (automatic = accepted only); the state shown is the server\'s', async ({ page }) => {
    await page.goto(`/branches/${VENDOR_A_BRANCH_ID}`);
    const card = page.getByTestId('branch-acceptance-mode');
    await expect(card).toBeVisible();
    const original = (await card.getByTestId('branch-acceptance-state').innerText()).startsWith('Automatic');
    try {
      await card.getByTestId('branch-acceptance-toggle').click();
      await expect(card.getByTestId('branch-acceptance-state')).toContainText(original ? 'Manual' : 'Automatic');
      const branch = (await adminApi().get(`/admin/vendor-branches/${VENDOR_A_BRANCH_ID}`)).data.data;
      expect(branch.autoAcceptEnabled).toBe(!original);
    } finally {
      await adminApi().patch(`/admin/vendor-branches/${VENDOR_A_BRANCH_ID}/auto-accept`, { autoAcceptEnabled: original });
    }
  });

  test('the banner and the Control Tower counter appear when something needs a person, follow the facts, and poll every ~20 s', async ({ page }) => {
    await page.clock.install();
    let calls = 0;
    let facts = { pendingAcceptanceAlertMinutes: 5, pendingAcceptance: 3, pendingAcceptanceOverdue: 2, preparationOverdue: 0, partiallyRejectedActiveOrders: 0, refundsToSend: 1,
      openDispatchAlerts: { NO_ELIGIBLE_DRIVER: 0, AUTO_ASSIGN_DISABLED: 2, ASSIGNMENT_ERROR: 0, DRIVER_NOT_RESPONDING: 0 }, actionRequired: 5 };
    await page.route('**/admin/control-tower/summary', async (route) => {
      calls += 1;
      const real = await route.fetch();
      const body = await real.json();
      body.data.operations = facts;
      await route.fulfill({ response: real, json: body });
    });

    await page.goto('/order-search');
    const banner = page.getByTestId('operations-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('2 order(s) wait for a manual driver assignment');
    await expect(banner).toContainText('2 vendor part(s) not accepted for over 5 minutes');
    await expect(banner).toContainText('1 Manual Transfer refund(s) still to send');
    await expect(page.getByTestId('operations-badge')).toHaveText('5');

    const firstCalls = calls;
    facts = { ...facts, openDispatchAlerts: { ...facts.openDispatchAlerts, AUTO_ASSIGN_DISABLED: 0 }, pendingAcceptanceOverdue: 0, refundsToSend: 0, actionRequired: 0 };
    await page.clock.fastForward(21_000);
    await expect.poll(() => calls).toBeGreaterThan(firstCalls);
    await expect(banner).toBeHidden(); // nothing needs a person any more
    await expect(page.getByTestId('operations-badge')).toHaveCount(0);
  });

  test('the Control Tower shows the operations facts and every open alert by its reason', async ({ page }) => {
    await page.goto('/control-tower');
    const card = page.getByTestId('ct-operations');
    await expect(card).toBeVisible();
    await expect(card.getByTestId('ct-action-required')).toHaveText(/^\d+$/);
    for (const reason of ['NO_ELIGIBLE_DRIVER', 'AUTO_ASSIGN_DISABLED', 'ASSIGNMENT_ERROR', 'DRIVER_NOT_RESPONDING']) {
      await expect(card.getByTestId(`ct-alert-count-${reason}`)).toBeVisible();
    }
  });
});

test.describe('Vendor new-order indicator', () => {
  test.use({ storageState: VENDOR_A_STORAGE_STATE });

  test('an order placed after the page opened is marked NEW on the next refresh (20 s), counted on the nav, and can be dismissed', async ({ page }) => {
    await page.clock.install();
    await page.goto('/orders');
    await expect(page.getByTestId('vendor-last-updated')).toBeVisible();
    await expect(page.getByTestId('vendor-new-orders')).toHaveCount(0);

    const { orderId } = await placeNewOrder();
    await page.clock.fastForward(21_000);

    const row = page.getByTestId(`vendor-order-${orderId}`);
    await expect(row).toBeVisible();
    await expect(row).toContainText('NEW');
    await expect(page.getByTestId('vendor-new-orders')).toContainText('1 new order arrived');
    await expect(page.getByTestId('vendor-awaiting-badge')).toBeVisible();

    await page.getByTestId('vendor-new-orders').getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.getByTestId('vendor-new-orders')).toHaveCount(0);
    await expect(row).not.toContainText('NEW');
  });

  test('the sound option is off by default and remembered once switched on', async ({ page }) => {
    await page.goto('/orders');
    const toggle = page.getByTestId('vendor-sound-toggle');
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await page.reload();
    await expect(page.getByTestId('vendor-sound-toggle')).toBeChecked();
    await page.getByTestId('vendor-sound-toggle').uncheck();
  });
});
