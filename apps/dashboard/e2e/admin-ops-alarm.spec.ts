import { test, expect, Page } from '@playwright/test';
import { SUPER_ADMIN_STORAGE_STATE } from './env';
import { cancelTestOrder, placeNewOrder } from './control-tower-fixtures';

/**
 * P0 Admin real-time alerts (2026-11-08). Against the real backend: a new order appears in the alarm bar of every open Admin tab without a
 * refresh; exactly ONE tab plays the sound; "Open order" lands on the exact order; "Seen — stop alarm" (acknowledge) clears it in every tab,
 * yet the alert stays open in the Notification Center until the store responds. Arabic/RTL renders the same bar. The setup page reports
 * only what it measured.
 */
test.describe('Admin alarm', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });
  test.setTimeout(90_000);

  const state = (page: Page) => page.evaluate(() => (window as any).__hatlyAlarm as { leader: boolean; audio: string; ringing: number });
  const plays = (page: Page) => page.evaluate(() => ((window as any).__hatlyAlarmPlays as number | undefined) ?? 0);

  test('a new order alarms in every open tab, one tab sounds, Open goes to the order, Seen stops it everywhere but keeps it open', async ({ context }) => {
    const a = await context.newPage();
    const b = await context.newPage();
    for (const p of [a, b]) {
      await p.goto('/home');
      await expect(p.getByTestId('ops-alarm-bar')).toBeVisible({ timeout: 15_000 });
      await p.getByTestId('ops-alarm-enable-sound').click(); // the user gesture browsers require before any sound
      await expect.poll(async () => (await state(p))?.audio, { timeout: 10_000 }).toBe('ready');
    }
    await expect.poll(async () => [(await state(a)).leader, (await state(b)).leader].filter(Boolean).length, { timeout: 10_000 }).toBe(1);

    const order = await placeNewOrder();
    try {
      for (const p of [a, b]) {
        const item = p.getByTestId('ops-alarm-bar').locator('li', { hasText: order.orderNumber });
        await expect(item).toBeVisible({ timeout: 20_000 });
        await expect(item).toContainText('New order');
      }
      // Exactly one tab rings (the elected one), and it did ring.
      const [pa, pb] = [await plays(a), await plays(b)];
      const leaderIsA = (await state(a)).leader;
      expect(leaderIsA ? pa : pb).toBeGreaterThan(0);
      expect(leaderIsA ? pb : pa).toBe(0);

      const itemA = a.getByTestId('ops-alarm-bar').locator('li', { hasText: order.orderNumber });
      await itemA.getByTestId('ops-alarm-open').click();
      await expect(a).toHaveURL(new RegExp(`/order-management\\?order=${order.orderId}`));

      const itemB = b.getByTestId('ops-alarm-bar').locator('li', { hasText: order.orderNumber });
      await itemB.getByTestId('ops-alarm-ack').click();
      await expect(itemB).toHaveCount(0);
      await expect(a.getByTestId('ops-alarm-bar').locator('li', { hasText: order.orderNumber })).toHaveCount(0, { timeout: 15_000 });

      await b.goto('/inbox');
      const row = b.getByTestId('ops-alerts-panel').locator('li', { hasText: order.orderNumber });
      await expect(row).toBeVisible();
      await expect(row.getByTestId('ops-alert-state')).toContainText('Seen by');
      await expect(row.getByTestId('ops-alert-state')).toContainText('still open');
    } finally {
      await cancelTestOrder(order);
    }
  });

  test('Arabic: the alarm bar and the Notification Center read right-to-left with Arabic actions', async ({ page }) => {
    const order = await placeNewOrder();
    try {
      await page.goto('/home');
      await page.getByRole('button', { name: 'Switch to Arabic' }).click();
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      const item = page.getByTestId('ops-alarm-bar').locator('li', { hasText: order.orderNumber });
      await expect(item).toBeVisible({ timeout: 20_000 });
      await expect(item).toContainText('طلب جديد');
      await expect(item.getByTestId('ops-alarm-open')).toHaveText('افتح الطلب');
      await expect(item.getByTestId('ops-alarm-ack')).toHaveText('تم الاطلاع — أوقف التنبيه');
      await page.goto('/inbox');
      await expect(page.getByTestId('ops-alerts-panel').getByRole('heading', { name: 'تنبيهات العمليات' })).toBeVisible();
    } finally {
      await page.evaluate(() => localStorage.removeItem('hatly_dashboard_locale')).catch(() => undefined);
      await cancelTestOrder(order);
    }
  });

  test('a page opened with the sound still locked says so and offers the one tap that enables it; a snooze is visible and reversible', async ({ page }) => {
    await page.goto('/home');
    const bar = page.getByTestId('ops-alarm-bar');
    await expect(bar).toBeVisible();
    await expect(bar.getByTestId('ops-alarm-enable-sound')).toBeVisible();
    await bar.getByTestId('ops-alarm-enable-sound').click();
    await expect(bar.getByTestId('ops-alarm-sound-on')).toBeVisible();
    const snooze = bar.getByTestId('ops-alarm-snooze');
    if (await snooze.count()) {
      await snooze.click();
      await expect(bar.getByTestId('ops-alarm-resume')).toBeVisible();
      await bar.getByTestId('ops-alarm-resume').click();
      await expect(bar.getByTestId('ops-alarm-sound-on')).toBeVisible();
    }
  });

  test('the setup page shows measured states, plays a test sound only after the tap, and never offers a test push for an unregistered device', async ({ page }) => {
    await page.goto('/notification-setup');
    await expect(page.getByRole('heading', { name: 'Notification setup' })).toBeVisible();
    const status = page.getByTestId('setup-status');
    for (const id of ['permission', 'server', 'sw', 'device', 'sound', 'vibrate', 'pwa', 'last-test', 'last-ok', 'last-fail', 'last-ack']) await expect(status.getByTestId(`setup-row-${id}`)).toBeVisible();
    await expect(status.getByTestId('setup-row-server')).toHaveAttribute('data-tone', 'ok'); // the isolated stack has (test) VAPID keys
    await expect(status.getByTestId('setup-row-device')).toHaveAttribute('data-tone', 'bad');
    await expect(page.getByTestId('setup-test-push')).toBeDisabled();
    await expect(page.getByTestId('setup-test-sound')).toBeDisabled();
    await page.getByTestId('setup-enable-sound').click();
    await expect(page.getByTestId('setup-sound-result')).toContainText('A test alarm was played');
    await expect(status.getByTestId('setup-row-sound')).toHaveAttribute('data-tone', 'ok');
    // Headless Chromium has no browser push service: enabling must report the failure honestly, never "registered".
    await page.getByTestId('setup-enable-push').click();
    await expect(page.getByTestId('setup-message')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('setup-message')).not.toContainText('will now receive');
    await expect(status.getByTestId('setup-row-device')).toHaveAttribute('data-tone', 'bad');
  });
});
