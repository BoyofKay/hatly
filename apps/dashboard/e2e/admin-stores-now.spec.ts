import { test, expect } from '@playwright/test';
import { SUPER_ADMIN_STORAGE_STATE } from './env';
import { adminApi, cancelTestOrder, orderDetail, pinAutomaticDispatch, placeNewOrder } from './control-tower-fixtures';

/**
 * Stage 4 of the Admin simplification (2026-11-14): "Stores now" (stores with an order part to act on, late first, who to call, the store's
 * next step on each order) and ready-made reject reasons (the existing required reason, filled by one tap — on the board row, on "Stores now"
 * and in the order drawer). Every action is the real on-behalf segment transition; the outcome is read back from the backend.
 */
const OUT_OF_STOCK = 'بعض المنتجات غير متوفرة حاليًا';
const storeOf = async (orderId: string) =>
  ((await adminApi().get('/admin/operations/stores-now')).data.data.stores as any[]).find((s) => s.parts.some((p: any) => p.orderId === orderId));

test.describe('Stores now and ready-made reject reasons', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });
  test.setTimeout(90_000);

  test('a new order shows under its store with a call button; "Accept & start preparing" then "Ready" from the store card', async ({ page }) => {
    const restore = await pinAutomaticDispatch(false); // the order stays with the store side for the whole test and its clean-up
    const order = await placeNewOrder();
    try {
      const store = await storeOf(order.orderId);
      expect(store).toBeTruthy();
      await page.goto('/stores-now');
      await page.getByTestId('sn-search').fill(order.orderNumber);
      const card = page.getByTestId(`sn-store-${store.branchId}`);
      await expect(card).toBeVisible({ timeout: 20_000 });
      await expect(card.getByTestId('sn-counts')).toContainText('not accepted');
      if (store.contacts.length) await expect(card.getByTestId('sn-call').first()).toHaveAttribute('href', `tel:${store.contacts[0].phone}`);
      const part = card.getByTestId(`sn-part-${order.segmentId}`);
      await part.getByTestId('sn-accept-prepare').click();
      await expect(page.getByRole('status').filter({ hasText: `${order.orderNumber}: accepted and preparing` })).toBeVisible();
      await expect.poll(async () => (await orderDetail(order.orderId)).segments.find((s: any) => s.id === order.segmentId)?.status, { timeout: 10_000 }).toBe('PREPARING');
      await page.getByTestId('sn-filter-all').click();
      await expect(part).toHaveAttribute('data-status', 'PREPARING', { timeout: 15_000 });
      await part.getByTestId('sn-ready').click();
      await expect.poll(async () => (await orderDetail(order.orderId)).status, { timeout: 10_000 }).toBe('READY_FOR_PICKUP');
      await expect(part).toHaveAttribute('data-status', 'READY_FOR_PICKUP', { timeout: 15_000 }); // still listed: ready, waiting for the driver
    } finally {
      await cancelTestOrder(order);
      await restore();
    }
  });

  test('reject from "Stores now" with a ready-made reason: one tap fills the reason, the confirm is the second tap; the customer-facing reason is stored as shown', async ({ page }) => {
    const order = await placeNewOrder();
    try {
      await page.goto('/stores-now');
      await page.getByTestId('sn-search').fill(order.orderNumber);
      const part = page.getByTestId(`sn-part-${order.segmentId}`);
      await part.getByTestId('part-reject').click();
      const form = part.getByTestId('part-reject-form');
      await expect(form.getByTestId('part-reject-confirm')).toBeDisabled(); // no reason yet
      await form.getByTestId('part-reject-preset-OUT_OF_STOCK').click();
      await expect(form.getByTestId('part-reject-reason')).toHaveValue(OUT_OF_STOCK);
      await form.getByTestId('part-reject-confirm').click();
      await expect(page.getByRole('status').filter({ hasText: `${order.orderNumber}: rejected` })).toBeVisible();
      const detail = await orderDetail(order.orderId);
      expect(detail.segments.find((s: any) => s.id === order.segmentId)).toMatchObject({ status: 'CANCELLED', rejectionReason: OUT_OF_STOCK });
    } finally {
      await cancelTestOrder(order);
    }
  });

  test('reject from the board row with "Other": the typed reason is sent; "Keep the order" closes the form without any change', async ({ page }) => {
    const order = await placeNewOrder();
    try {
      await page.goto('/operations');
      await page.getByTestId('board-filter-all').click();
      await page.getByTestId('board-search').fill(order.orderNumber);
      const row = page.getByTestId(`board-row-${order.orderNumber}`);
      await expect(row).toBeVisible({ timeout: 20_000 });
      await row.getByTestId('part-reject').click();
      await row.getByTestId('part-reject-cancel').click();
      await expect(row.getByTestId('part-reject-form')).toHaveCount(0);
      expect((await orderDetail(order.orderId)).status).toBe('PENDING');

      await row.getByTestId('part-reject').click();
      await row.getByTestId('part-reject-preset-STORE_CLOSED').click();
      await row.getByTestId('part-reject-preset-OTHER').click();
      await expect(row.getByTestId('part-reject-reason')).toHaveValue('');
      await row.getByTestId('part-reject-reason').fill('Playwright: the store phoned to cancel');
      await row.getByTestId('part-reject-confirm').click();
      await expect.poll(async () => (await orderDetail(order.orderId)).segments.find((s: any) => s.id === order.segmentId)?.rejectionReason, { timeout: 10_000 })
        .toBe('Playwright: the store phoned to cancel');
    } finally {
      await cancelTestOrder(order);
    }
  });
});
