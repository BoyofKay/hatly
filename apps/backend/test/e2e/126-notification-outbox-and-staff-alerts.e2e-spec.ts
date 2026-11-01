/**
 * Slice 2 — transactional notification outbox, case-level customer notifications, staff alerts, and the Operations queue's view of
 * financially isolated cases. Real HTTP, real PostgreSQL, the real worker driven explicitly (the background timer is off in E2E).
 *
 * Providers: FCM is the only external channel; its double (support/world.ts) can succeed, fail, throw or reject every token. WhatsApp, SMS and
 * e-mail are not configured anywhere and are never used. In-app delivery is the inbox row and never depends on the provider.
 */
import { randomUUID } from 'crypto';
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData } from './support/actors';
import { boundary } from './support/external-boundary';
import { Permission } from '../../src/modules/permissions/permission.enum';
import { NotificationOutboxService } from '../../src/modules/notifications/outbox/notification-outbox.service';
import { PUSH_NOTIFICATION_PROVIDER } from '../../src/modules/notifications/push-provider.interface';
import { CustomerNotificationType, recordOrderNotification } from '../../src/modules/notifications/customer-notification-events';

const HOUR = 3600_000;

describe('E2E — notification outbox, staff alerts and the exception queue (Slice 2)', () => {
  let world: World;
  let s: Scenario;
  let outbox: NotificationOutboxService;
  let area: { id: string };
  let superAdmin: Actor;
  let ops: Actor;
  let supervisor: Actor;
  let viewer: Actor;
  let reviewer: Actor;
  let v1: VendorFixture;
  let v2: VendorFixture;
  let pA: { id: string };
  let pB: { id: string };
  let pD: { id: string };
  let pC: { id: string };
  const home = { lat: 30.425, lng: 31.565 };
  let seed = 0;

  const itemIdOf = async (orderId: string, productId: string): Promise<string> =>
    (await world.ds.query('SELECT i.id FROM order_items i JOIN order_vendor_segments g ON g.id = i.order_vendor_segment_id WHERE g.order_id = $1 AND i.product_id = $2', [orderId, productId]))[0].id;
  const segmentOf = async (orderId: string, v: VendorFixture): Promise<string> =>
    (await world.ds.query('SELECT id FROM order_vendor_segments WHERE order_id = $1 AND vendor_branch_id = $2', [orderId, v.branchId]))[0].id;
  const credit = (c: Actor, amountMinor: number) =>
    world.ds.query("INSERT INTO wallet_transactions (customer_id, amount_delta_minor, type, idempotency_key, reason) VALUES ($1, $2, 'ADMIN_CREDIT', $3, 'e2e seed')", [c.id, amountMinor, `s2-seed-${c.id}-${seed++}`]);
  const place = async (lines: Array<[{ id: string }, number]>, paymentMethod = 'COD', walletCredit = 0) => {
    const c = await s.customer();
    if (walletCredit) await credit(c, walletCredit);
    for (const [p, q] of lines) await s.addToCart(c, p.id, q, {});
    return { c, order: await s.checkout(c, home, paymentMethod) };
  };
  const mark = (v: VendorFixture, segmentId: string, itemIds: string[]) => world.api('post', `/vendor/orders/segments/${segmentId}/unavailable-items`, { token: v.manager.accessToken, body: { itemIds } });
  const respond = (c: Actor, orderId: string, exceptionId: string, decision: string) => world.api('post', `/orders/${orderId}/item-unavailability/${exceptionId}/respond`, { token: c.accessToken, body: { decision } });
  const decide = (a: Actor, exceptionId: string, body: Record<string, unknown>) => world.api('post', `/admin/order-exceptions/${exceptionId}/record-decision`, { token: a.accessToken, body });
  const device = (userId: string, token = `tok-${randomUUID()}`) => world.ds.query("INSERT INTO device_tokens (user_id, token, platform, is_active) VALUES ($1, $2, 'android', true)", [userId, token]).then(() => token);
  const inbox = (orderId: string) => world.ds.query("SELECT event_key, is_read FROM customer_notifications WHERE order_id = $1 AND type = 'ORDER_ITEM_UNAVAILABLE' ORDER BY created_at, event_key", [orderId]);
  const staffRows = (exceptionId: string, category?: string) =>
    world.ds.query(`SELECT user_id, category, severity, required_action, vendor_branch_id, note FROM staff_notifications WHERE exception_id = $1 ${category ? 'AND category = $2' : ''} ORDER BY created_at`, category ? [exceptionId, category] : [exceptionId]);
  const recipients = async (exceptionId: string, category: string) => (await staffRows(exceptionId, category)).map((r: any) => r.user_id).sort();
  const outboxFor = (userId: string) => world.ds.query('SELECT * FROM notification_outbox WHERE recipient_user_id = $1 ORDER BY created_at, event_key', [userId]);
  const drain = async () => {
    const total = { claimed: 0, sent: 0, skipped: 0, retried: 0, dead: 0, lostLease: 0 };
    for (let i = 0; i < 10; i++) {
      const r = await outbox.processBatch(25);
      for (const k of Object.keys(total) as Array<keyof typeof total>) total[k] += r[k];
      if (r.claimed === 0) break;
    }
    return total;
  };
  const message = (userId: string, eventKey = `t:${randomUUID()}`) => ({ eventKey, recipientUserId: userId, recipientKind: 'CUSTOMER' as const, channel: 'PUSH' as const, category: 'TEST', title: 't', body: 'b', data: { type: 'TEST' } });

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    outbox = world.app.get(NotificationOutboxService);
    await s.configureDeliveryPricing();
    area = await s.serviceArea({ radiusMeters: 50000 });
    superAdmin = await s.superAdmin();
    ops = await s.admin([Permission.VIEW_ORDERS, Permission.MANAGE_ORDER_FULFILMENT], 'S2 Ops');
    supervisor = await s.admin([Permission.VIEW_ORDERS, Permission.MANAGE_ORDER_FULFILMENT, Permission.MANAGE_ORDER_ISSUES], 'S2 Supervisor');
    viewer = await s.admin([Permission.VIEW_ORDERS], 'S2 Viewer');
    reviewer = await s.admin([Permission.VERIFY_MANUAL_PAYMENTS], 'S2 Reviewer');
    v1 = await s.vendor({ name: 'S2 One', serviceAreaId: area.id, lat: 30.421, lng: 31.561, commissionBasisPoints: 1000 });
    v2 = await s.vendor({ name: 'S2 Two', serviceAreaId: area.id, lat: 30.431, lng: 31.571, commissionBasisPoints: 1000 });
    pA = await s.product(v1, { priceMinor: 10000, inventoryMode: 'OPEN' });
    pB = await s.product(v1, { priceMinor: 5000, inventoryMode: 'OPEN' });
    pD = await s.product(v1, { priceMinor: 2000, inventoryMode: 'OPEN' });
    pC = await s.product(v2, { priceMinor: 3000, inventoryMode: 'OPEN' });
    await s.setConfig('MANUAL_TRANSFER_DESTINATION', { label: 'Hatly', phoneOrAccountNumber: '01000000000' });
    await s.setConfig('CUSTOMER_SERVICE_WHATSAPP_NUMBER', '+201000000000');
  });
  beforeEach(async () => {
    boundary.reset();
    await world.ds.query('DELETE FROM notification_outbox');
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  // ================================================================================================================ customer notifications

  describe('repeated unavailable-item cases on one order', () => {
    it('a second CASE notifies the customer again, while a replay of the same event does not', async () => {
      const { c, order } = await place([[pA, 1], [pB, 1], [pD, 1]]);
      const seg = await segmentOf(order.id, v1);
      const ex1 = expectData<any>(await mark(v1, seg, [await itemIdOf(order.id, pA.id)]), 201);
      expect((await inbox(order.id)).map((r: any) => r.event_key)).toEqual([`exception:${ex1.id}:items:1`]);
      expectData(await respond(c, order.id, ex1.id, 'CONTINUE_WITHOUT'), 201); // case 1 resolved

      const ex2 = expectData<any>(await mark(v1, seg, [await itemIdOf(order.id, pB.id)]), 201);
      expect(ex2.id).not.toBe(ex1.id);
      const rows = await inbox(order.id);
      expect(rows.map((r: any) => r.event_key).sort()).toEqual([`exception:${ex1.id}:items:1`, `exception:${ex2.id}:items:1`].sort());

      // The customer sees both in the app's inbox, and one push per case is queued.
      const list = expectData<any[]>(await world.api('get', '/customer/notifications', { token: c.accessToken }));
      expect(list.filter((n) => n.type === 'ORDER_ITEM_UNAVAILABLE')).toHaveLength(2);
      expect((await outboxFor(c.id)).map((r: any) => r.event_key).sort()).toEqual([`customer:exception:${ex1.id}:items:1`, `customer:exception:${ex2.id}:items:1`].sort());

      // Replaying either event (a retry, a duplicate message) writes nothing.
      const o = { id: order.id, customerId: c.id, orderNumber: order.orderNumber };
      expect(await recordOrderNotification(world.ds.manager, o, CustomerNotificationType.ORDER_ITEM_UNAVAILABLE, `exception:${ex2.id}:items:1`)).toBe(false);
      expect(await recordOrderNotification(world.ds.manager, o, CustomerNotificationType.ORDER_ITEM_UNAVAILABLE, `exception:${ex1.id}:items:1`)).toBe(false);
      expect((await inbox(order.id)).length).toBe(2);
      // Lifecycle notifications keep their once-per-order guarantee.
      expect((await world.ds.query("SELECT count(*)::int AS n FROM customer_notifications WHERE order_id = $1 AND type = 'ORDER_PLACED'", [order.id]))[0].n).toBe(1);
    });

    it('items added to a case the customer has not answered are folded into the notification already sent — until it is old or read, then they notify again', async () => {
      const { c, order } = await place([[pA, 1], [pB, 1], [pD, 1]]);
      const seg = await segmentOf(order.id, v1);
      const ex = expectData<any>(await mark(v1, seg, [await itemIdOf(order.id, pA.id)]), 201);
      expectData(await mark(v1, seg, [await itemIdOf(order.id, pB.id)]), 201); // same case, a minute later: no buzz
      expect((await inbox(order.id)).map((r: any) => r.event_key)).toEqual([`exception:${ex.id}:items:1`]);

      await world.ds.query("UPDATE customer_notifications SET created_at = now() - interval '30 minutes' WHERE order_id = $1", [order.id]);
      expectData(await mark(v1, seg, [await itemIdOf(order.id, pD.id)]), 201); // a separate, later addition is never swallowed
      expect((await inbox(order.id)).map((r: any) => r.event_key).sort()).toEqual([`exception:${ex.id}:items:1`, `exception:${ex.id}:items:3`].sort());
      expect((await world.ds.query('SELECT count(*)::int AS n FROM order_exceptions WHERE order_id = $1', [order.id]))[0].n).toBe(1);
      void c;
    });
  });

  // =============================================================================================================================== outbox

  describe('the transactional outbox', () => {
    it('is written with the business transaction (a rollback leaves nothing) and is idempotent per event, recipient and channel', async () => {
      const c = await s.customer();
      const m = message(c.id);
      await expect(
        world.ds.transaction(async (tx) => {
          expect(await outbox.enqueue(tx, m)).toBe(true);
          throw new Error('business change failed');
        }),
      ).rejects.toThrow('business change failed');
      expect(await outboxFor(c.id)).toHaveLength(0);

      await world.ds.transaction(async (tx) => {
        expect(await outbox.enqueue(tx, m)).toBe(true);
        expect(await outbox.enqueue(tx, m)).toBe(false); // duplicate event
      });
      expect(await outbox.enqueue(world.ds.manager, m)).toBe(false); // duplicate from another transaction
      expect(await outboxFor(c.id)).toHaveLength(1);
      expect(await outbox.enqueue(world.ds.manager, { ...m, eventKey: `${m.eventKey}:other` })).toBe(true); // a different event is a different row
    });

    it('SENT only means "the provider accepted it": the table has no delivered/opened state to claim, and an unregistered device is SKIPPED, not sent', async () => {
      const c = await s.customer();
      const withDevice = await s.customer();
      const token = await device(withDevice.id);
      await outbox.enqueue(world.ds.manager, message(c.id));
      await outbox.enqueue(world.ds.manager, message(withDevice.id));
      const run = await drain();
      expect(run).toMatchObject({ claimed: 2, sent: 1, skipped: 1, retried: 0, dead: 0 });
      expect((await outboxFor(withDevice.id))[0]).toMatchObject({ status: 'SENT', attempts: 1 });
      expect((await outboxFor(withDevice.id))[0].sent_at).not.toBeNull();
      expect((await outboxFor(c.id))[0]).toMatchObject({ status: 'SKIPPED', skip_reason: 'NO_DEVICE', sent_at: null });
      expect(boundary.push).toHaveLength(1);
      expect(boundary.push[0].tokens).toEqual([token]);
      expect(boundary.push[0].data).toMatchObject({ type: 'TEST', eventKey: expect.stringMatching(/^t:/) });

      const columns = (await world.ds.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'notification_outbox'")).map((r: any) => r.column_name);
      expect(columns.filter((n: string) => /deliver|open|read/i.test(n))).toEqual([]);
      expect((await world.ds.query("SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'CHK_notification_outbox_status'"))[0].d).not.toMatch(/DELIVERED|OPENED/);
    });

    it('a provider failure is retried with back-off and then marked DEAD; the attempts are counted and nothing is sent twice after success', async () => {
      const c = await s.customer();
      await device(c.id);
      await outbox.enqueue(world.ds.manager, message(c.id));
      boundary.pushMode = 'fail';
      expect(await drain()).toMatchObject({ claimed: 1, retried: 1, sent: 0 });
      let row = (await outboxFor(c.id))[0];
      expect(row).toMatchObject({ status: 'FAILED', attempts: 1, last_error: 'PROVIDER_REJECTED' });
      expect(new Date(row.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 20_000); // back-off: not retried immediately
      expect((await outbox.processBatch()).claimed).toBe(0);

      boundary.pushMode = 'throw';
      await world.ds.query('UPDATE notification_outbox SET next_attempt_at = now() WHERE id = $1', [row.id]);
      await drain();
      row = (await outboxFor(c.id))[0];
      expect(row).toMatchObject({ status: 'FAILED', attempts: 2 });
      expect(row.last_error).toMatch(/^PROVIDER_ERROR: FCM exploded/);

      boundary.pushMode = 'ok';
      await world.ds.query('UPDATE notification_outbox SET next_attempt_at = now() WHERE id = $1', [row.id]);
      expect(await drain()).toMatchObject({ sent: 1 });
      expect((await outboxFor(c.id))[0]).toMatchObject({ status: 'SENT', attempts: 3 });
      expect(await drain()).toMatchObject({ claimed: 0 }); // a SENT row is never picked up again

      // Exhausted attempts end in DEAD (kept for Operations to see), not in an endless retry.
      const d = await s.customer();
      await device(d.id);
      await outbox.enqueue(world.ds.manager, message(d.id));
      await world.ds.query('UPDATE notification_outbox SET max_attempts = 2 WHERE recipient_user_id = $1', [d.id]);
      boundary.pushMode = 'fail';
      await drain();
      await world.ds.query('UPDATE notification_outbox SET next_attempt_at = now() WHERE recipient_user_id = $1', [d.id]);
      expect(await drain()).toMatchObject({ dead: 1 });
      expect((await outboxFor(d.id))[0]).toMatchObject({ status: 'DEAD', attempts: 2 });
    });

    it('tokens the provider rejects are deactivated and the delivery is SKIPPED (NO_VALID_DEVICE), not retried forever', async () => {
      const c = await s.customer();
      const token = await device(c.id);
      await outbox.enqueue(world.ds.manager, message(c.id));
      boundary.pushMode = 'invalid';
      expect(await drain()).toMatchObject({ skipped: 1 });
      expect((await outboxFor(c.id))[0]).toMatchObject({ status: 'SKIPPED', skip_reason: 'NO_VALID_DEVICE' });
      expect((await world.ds.query('SELECT is_active FROM device_tokens WHERE token = $1', [token]))[0].is_active).toBe(false);
    });

    it('an unconfigured provider is reported honestly (SKIPPED / PROVIDER_NOT_CONFIGURED), and the in-app notification is untouched', async () => {
      const provider = world.app.get(PUSH_NOTIFICATION_PROVIDER) as { isConfigured?: () => boolean };
      const { c, order } = await place([[pA, 1], [pB, 1]]);
      await device(c.id);
      provider.isConfigured = () => false;
      try {
        const ex = expectData<any>(await mark(v1, await segmentOf(order.id, v1), [await itemIdOf(order.id, pA.id)]), 201);
        expect(await drain()).toMatchObject({ skipped: 1, sent: 0 });
        expect((await outboxFor(c.id))[0]).toMatchObject({ status: 'SKIPPED', skip_reason: 'PROVIDER_NOT_CONFIGURED' });
        expect(boundary.push).toHaveLength(0);
        // The customer still has the notification in the app, and can answer.
        const list = expectData<any[]>(await world.api('get', '/customer/notifications', { token: c.accessToken }));
        expect(list.some((n) => n.type === 'ORDER_ITEM_UNAVAILABLE' && n.orderId === order.id)).toBe(true);
        expectData(await respond(c, order.id, ex.id, 'CONTINUE_WITHOUT'), 201);
      } finally {
        delete provider.isConfigured;
      }
      const summary = expectData<any>(await world.api('get', '/admin/notification-outbox/summary', { token: superAdmin.accessToken }));
      expect(summary.providers).toEqual({ push: { configured: true }, whatsapp: { configured: false }, sms: { configured: false }, email: { configured: false } });
      expect(summary.counts.SKIPPED).toBeGreaterThanOrEqual(1);
    });

    it('a provider outage never loses the in-app notification or blocks the business action', async () => {
      const { c, order } = await place([[pA, 1], [pB, 1]]);
      await device(c.id);
      boundary.pushMode = 'throw';
      const ex = expectData<any>(await mark(v1, await segmentOf(order.id, v1), [await itemIdOf(order.id, pA.id)]), 201);
      await drain();
      expect((await outboxFor(c.id))[0].status).toBe('FAILED');
      const list = expectData<any[]>(await world.api('get', '/customer/notifications', { token: c.accessToken }));
      expect(list.some((n) => n.type === 'ORDER_ITEM_UNAVAILABLE')).toBe(true);
      expectData(await respond(c, order.id, ex.id, 'CONTINUE_WITHOUT'), 201);
    });

    it('concurrent workers never send the same notification twice', async () => {
      const c = await s.customer();
      await device(c.id);
      await world.ds.transaction(async (tx) => {
        for (let i = 0; i < 60; i++) await outbox.enqueue(tx, message(c.id, `bulk:${i}`));
      });
      const totals = { sent: 0, lostLease: 0 };
      for (let round = 0; round < 3; round++) {
        const runs = await Promise.all([outbox.processBatch(10), outbox.processBatch(10), outbox.processBatch(10), outbox.processBatch(10), outbox.processBatch(10)]);
        for (const r of runs) {
          totals.sent += r.sent;
          totals.lostLease += r.lostLease;
        }
      }
      expect(totals).toEqual({ sent: 60, lostLease: 0 });
      expect(boundary.push).toHaveLength(60);
      expect(new Set(boundary.push.map((p) => p.data.eventKey)).size).toBe(60);
      expect((await outboxFor(c.id)).every((r: any) => r.status === 'SENT' && r.attempts === 1)).toBe(true);
    });

    it('a worker that crashed mid-send leaves a lease that expires: the row is picked up again (at-least-once), not stuck forever', async () => {
      const c = await s.customer();
      await device(c.id);
      await outbox.enqueue(world.ds.manager, message(c.id));
      await world.ds.query("UPDATE notification_outbox SET status = 'SENDING', attempts = 1, lock_token = gen_random_uuid(), locked_until = now() + interval '5 minutes' WHERE recipient_user_id = $1", [c.id]);
      expect((await outbox.processBatch()).claimed).toBe(0); // the lease is still held by a live worker
      await world.ds.query("UPDATE notification_outbox SET locked_until = now() - interval '1 second' WHERE recipient_user_id = $1", [c.id]);
      expect(await drain()).toMatchObject({ claimed: 1, sent: 1 });
      expect((await outboxFor(c.id))[0]).toMatchObject({ status: 'SENT', attempts: 2 });
    });

    it('the Operations view of the outbox needs the system-health permission and exposes states only', async () => {
      expect((await world.api('get', '/admin/notification-outbox/summary', { token: ops.accessToken })).status).toBe(403);
      expect((await world.api('get', '/admin/notification-outbox', { token: ops.accessToken })).status).toBe(403);
      const c = await s.customer();
      await outbox.enqueue(world.ds.manager, message(c.id));
      const res = await world.api('get', '/admin/notification-outbox', { token: superAdmin.accessToken, query: { status: 'QUEUED' } });
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(Object.keys(res.body.data[0])).not.toEqual(expect.arrayContaining(['title', 'body', 'data', 'recipientUserId']));
    });
  });

  // ========================================================================================================================= staff alerts

  describe('staff alerts', () => {
    it('a new case alerts the Operations employees who work the queue — not viewers, not unrelated admins, not vendors, not the actor', async () => {
      const { order } = await place([[pA, 1], [pB, 1]]);
      const ex = expectData<any>(await mark(v1, await segmentOf(order.id, v1), [await itemIdOf(order.id, pA.id)]), 201);
      expect(await recipients(ex.id, 'EXCEPTION_NEW')).toEqual([ops.id, supervisor.id].sort());
      const row = (await staffRows(ex.id, 'EXCEPTION_NEW'))[0];
      expect(row).toMatchObject({ severity: 'INFO', required_action: 'REVIEW_NEW_CASE', vendor_branch_id: v1.branchId });

      // Operations marking on behalf of the vendor does not alert the person who did it.
      const second = await place([[pA, 1], [pB, 1]]);
      const onBehalf = expectData<any>(await world.api('post', `/admin/orders/segments/${await segmentOf(second.order.id, v1)}/unavailable-items`, { token: ops.accessToken, body: { itemIds: [await itemIdOf(second.order.id, pA.id)] } }), 201);
      expect(await recipients(onBehalf.id, 'EXCEPTION_NEW')).toEqual([supervisor.id]);
      // A second marking joining the same case is not a new case: no second alert.
      expectData(await mark(v1, await segmentOf(order.id, v1), [await itemIdOf(order.id, pB.id)]), 201);
      expect((await staffRows(ex.id, 'EXCEPTION_NEW')).length).toBe(2);
    });

    it('a customer asking to cancel, an isolated case and an escalation are CRITICAL: they reach supervisors and SUPER_ADMINs too, and cannot be muted in the inbox', async () => {
      const a = await place([[pA, 1], [pB, 1]]);
      const exA = expectData<any>(await mark(v1, await segmentOf(a.order.id, v1), [await itemIdOf(a.order.id, pA.id)]), 201);
      expectData(await respond(a.c, a.order.id, exA.id, 'CANCEL_ORDER'), 201);
      expect(await recipients(exA.id, 'EXCEPTION_ACTION_REQUIRED')).toEqual([ops.id, superAdmin.id, supervisor.id].sort());
      expect((await staffRows(exA.id, 'EXCEPTION_ACTION_REQUIRED'))[0]).toMatchObject({ severity: 'CRITICAL', required_action: 'EXECUTE_CANCELLATION' });

      const b = await place([[pA, 1]]); // a single item: continuing would empty the order → isolated
      const exB = expectData<any>(await mark(v1, await segmentOf(b.order.id, v1), [await itemIdOf(b.order.id, pA.id)]), 201);
      expectData(await respond(b.c, b.order.id, exB.id, 'CONTINUE_WITHOUT'), 201);
      expect(await recipients(exB.id, 'EXCEPTION_ISOLATED')).toEqual([ops.id, superAdmin.id, supervisor.id].sort());

      const esc = await world.api('post', `/admin/order-exceptions/${exA.id}/escalate`, { token: ops.accessToken, body: { note: 'customer unreachable' } });
      expect(esc.status).toBe(201);
      expect(await recipients(exA.id, 'EXCEPTION_ESCALATED')).toEqual([superAdmin.id, supervisor.id].sort()); // the actor is not alerted about their own action
      expect((await world.api('post', `/admin/order-exceptions/${exA.id}/escalate`, { token: ops.accessToken, body: {} })).status).toBe(201);
      expect((await staffRows(exA.id, 'EXCEPTION_ESCALATED')).length).toBe(2); // repeated escalation of an escalated case is a no-op

      const mute = await world.api('put', '/staff/notifications/preferences', { token: ops.accessToken, body: { category: 'EXCEPTION_ISOLATED', channel: 'IN_APP', enabled: false } });
      expect(mute.status).toBe(409);
      expect(mute.body.error.details.code).toBe('CRITICAL_ALERT_CANNOT_BE_MUTED');
    });

    it('preferences: a non-critical category can be muted in the inbox, push can be switched off per category, and unknown input is refused', async () => {
      const mutedOps = await s.admin([Permission.VIEW_ORDERS, Permission.MANAGE_ORDER_FULFILMENT], 'S2 Muted');
      const set = (body: Record<string, unknown>, who: Actor = mutedOps) => world.api('put', '/staff/notifications/preferences', { token: who.accessToken, body });
      expect((await set({ category: 'EXCEPTION_NEW', channel: 'IN_APP', enabled: false })).status).toBe(200);
      expect((await set({ category: 'NOPE', channel: 'IN_APP', enabled: false })).status).toBe(400);
      expect((await set({ category: 'EXCEPTION_NEW', channel: 'SMS', enabled: false })).status).toBe(400);
      expect((await set({ category: 'EXCEPTION_NEW', channel: 'IN_APP', enabled: 'no' })).status).toBe(400);
      expect((await set({ category: 'VENDOR_ACTION_REQUESTED', channel: 'IN_APP', enabled: false })).status).toBe(400); // a vendor category is not an Operations one
      const prefs = expectData<any[]>(await world.api('get', '/staff/notifications/preferences', { token: mutedOps.accessToken }));
      expect(prefs.find((p) => p.category === 'EXCEPTION_NEW').inApp).toEqual({ enabled: false, locked: false });
      expect(prefs.find((p) => p.category === 'EXCEPTION_ISOLATED').inApp).toEqual({ enabled: true, locked: true });
      // Operations categories only (the exception workflow and, since 2026-11-01, the operational OPS_* events) — never a vendor category.
      expect(prefs.every((p) => p.category.startsWith('EXCEPTION_') || p.category.startsWith('OPS_'))).toBe(true);
      expect(prefs.some((p) => p.category.startsWith('VENDOR_'))).toBe(false);

      const { order } = await place([[pA, 1], [pB, 1]]);
      const ex = expectData<any>(await mark(v1, await segmentOf(order.id, v1), [await itemIdOf(order.id, pA.id)]), 201);
      expect(await recipients(ex.id, 'EXCEPTION_NEW')).toEqual([ops.id, supervisor.id].sort()); // mutedOps chose not to be told
    });

    it('critical alerts are pushed only to staff with a registered device, and respect the push preference', async () => {
      const sup2 = await s.admin([Permission.VIEW_ORDERS, Permission.MANAGE_ORDER_FULFILMENT, Permission.MANAGE_ORDER_ISSUES], 'S2 Supervisor Two');
      await device(supervisor.id);
      await device(sup2.id);
      expect((await world.api('put', '/staff/notifications/preferences', { token: sup2.accessToken, body: { category: 'EXCEPTION_ACTION_REQUIRED', channel: 'PUSH', enabled: false } })).status).toBe(200);

      const { c, order } = await place([[pA, 1], [pB, 1]]);
      const ex = expectData<any>(await mark(v1, await segmentOf(order.id, v1), [await itemIdOf(order.id, pA.id)]), 201);
      expect(await outboxFor(supervisor.id)).toHaveLength(0); // a plain new case (INFO) is inbox-only
      expectData(await respond(c, order.id, ex.id, 'CANCEL_ORDER'), 201);

      expect(await outboxFor(ops.id)).toHaveLength(0); // no device → no outbox noise; the inbox row is the notification
      expect((await outboxFor(supervisor.id))[0]).toMatchObject({ recipient_kind: 'STAFF', channel: 'PUSH', severity: 'CRITICAL', category: 'EXCEPTION_ACTION_REQUIRED', status: 'QUEUED' });
      expect((await outboxFor(sup2.id))[0]).toMatchObject({ status: 'SKIPPED', skip_reason: 'PREFERENCE_DISABLED' });
      await drain();
      expect(boundary.push).toHaveLength(1);
      expect(boundary.push[0].data).toMatchObject({ type: 'EXCEPTION_ACTION_REQUIRED', orderId: order.id, exceptionId: ex.id });
      expect(JSON.stringify(boundary.push[0])).not.toMatch(/phone|address|\+20/); // no personal data in a push
      expect((await staffRows(ex.id, 'EXCEPTION_ACTION_REQUIRED')).map((r: any) => r.user_id)).toContain(sup2.id); // push off, inbox still there
    });

    it('vendor staff are alerted only when action is required, only the staff of that branch, and only through their own inbox', async () => {
      const { c, order } = await place([[pA, 1], [pB, 1], [pC, 1]]); // two vendors
      const seg1 = await segmentOf(order.id, v1);
      const ex = expectData<any>(await mark(v1, seg1, [await itemIdOf(order.id, pA.id)]), 201);
      expect(await staffRows(ex.id, 'VENDOR_ITEMS_REMOVED')).toHaveLength(0); // nothing to do yet

      const ask = await world.api('post', `/admin/order-exceptions/${ex.id}/request-vendor-action`, { token: ops.accessToken, body: { note: 'please call the customer back about the item' } });
      expect(ask.status).toBe(201);
      expect((await world.api('post', `/admin/order-exceptions/${ex.id}/request-vendor-action`, { token: ops.accessToken, body: { note: 'x' } })).status).toBe(400);
      expect((await world.api('post', `/admin/order-exceptions/${ex.id}/request-vendor-action`, { token: viewer.accessToken, body: { note: 'please call the customer back' } })).status).toBe(403);
      const alerts = await staffRows(ex.id, 'VENDOR_ACTION_REQUESTED');
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({ user_id: v1.manager.id, severity: 'CRITICAL', required_action: 'VENDOR_ACTION', vendor_branch_id: v1.branchId, note: 'please call the customer back about the item' });

      // v1's manager reads it; v2's manager cannot see or touch it.
      const mine = expectData<any[]>(await world.api('get', '/staff/notifications', { token: v1.manager.accessToken }));
      const item = mine.find((n) => n.category === 'VENDOR_ACTION_REQUESTED');
      expect(item).toMatchObject({ orderNumber: order.orderNumber, requiredAction: 'VENDOR_ACTION', isRead: false, segmentId: seg1, exceptionId: ex.id });
      expect(mine.every((n) => n.category.startsWith('VENDOR_'))).toBe(true);
      // v2 is also in this order, so it has its own "new order" row (2026-11-01) — but nothing of v1's branch and nothing of this exception.
      const theirs = expectData<any[]>(await world.api('get', '/staff/notifications', { token: v2.manager.accessToken }));
      expect(theirs.every((n) => n.vendorBranchId === v2.branchId)).toBe(true);
      expect(theirs.some((n) => n.exceptionId === ex.id || n.id === item.id)).toBe(false);
      expect((await world.api('post', `/staff/notifications/${item.id}/read`, { token: v2.manager.accessToken })).status).toBe(404);
      expect((await world.api('post', `/staff/notifications/${item.id}/read`, { token: ops.accessToken })).status).toBe(404);
      const unreadBefore = expectData<any>(await world.api('get', '/staff/notifications/unread-count', { token: v1.manager.accessToken })).unreadCount;
      expect(expectData<any>(await world.api('post', `/staff/notifications/${item.id}/read`, { token: v1.manager.accessToken }), 201).isRead).toBe(true);
      expect(expectData<any>(await world.api('post', `/staff/notifications/${item.id}/read`, { token: v1.manager.accessToken }), 201).isRead).toBe(true); // idempotent
      expect(expectData<any>(await world.api('get', '/staff/notifications/unread-count', { token: v1.manager.accessToken })).unreadCount).toBe(unreadBefore - 1);

      // The customer continues: the vendor is told to prepare the rest.
      expectData(await respond(c, order.id, ex.id, 'CONTINUE_WITHOUT'), 201);
      expect(await recipients(ex.id, 'VENDOR_ITEMS_REMOVED')).toEqual([v1.manager.id]);
      expect(await staffRows(ex.id, 'VENDOR_ORDER_CANCELLED')).toHaveLength(0);
    });

    it('a cancellation after an unavailable item tells every vendor of the order to stop preparing', async () => {
      const { c, order } = await place([[pA, 1], [pC, 1]]);
      const ex = expectData<any>(await mark(v1, await segmentOf(order.id, v1), [await itemIdOf(order.id, pA.id)]), 201);
      expectData(await respond(c, order.id, ex.id, 'CANCEL_ORDER'), 201);
      const done = await decide(supervisor, ex.id, { decision: 'CANCEL_ORDER' });
      expect(done.status).toBe(201);
      expect((await recipients(ex.id, 'VENDOR_ORDER_CANCELLED')).sort()).toEqual([v1.manager.id, v2.manager.id].sort());
      expect((await staffRows(ex.id, 'VENDOR_ORDER_CANCELLED'))[0]).toMatchObject({ severity: 'CRITICAL', required_action: 'STOP_PREPARING' });
    });

    it('the inbox endpoints refuse customers, drivers, admins without the order permission, and anonymous callers', async () => {
      const c = await s.customer();
      const driver = await s.driver({ lat: 30.42, lng: 31.56 });
      for (const [token, status] of [[c.accessToken, 403], [driver.accessToken, 403], [reviewer.accessToken, 403], [undefined, 401]] as const) {
        expect((await world.api('get', '/staff/notifications', { token })).status).toBe(status);
        expect((await world.api('get', '/staff/notifications/unread-count', { token })).status).toBe(status);
        expect((await world.api('put', '/staff/notifications/preferences', { token, body: { category: 'EXCEPTION_NEW', channel: 'IN_APP', enabled: false } })).status).toBe(status);
      }
      expect((await world.api('get', '/staff/notifications/preferences', { token: viewer.accessToken })).status).toBe(200);
    });
  });

  // ================================================================================================================ the Operations queue

  describe('financially isolated cases in the Operations queue', () => {
    it('an isolated case shows why nothing changed, its priority, who is responsible and what to do — and nothing is ever adjusted by guessing', async () => {
      const { c, order } = await place([[pA, 1]], 'WALLET', 50000); // a single item: continuing would empty the order
      const before = (await world.ds.query('SELECT total_minor, subtotal_minor, wallet_amount_minor FROM orders WHERE id = $1', [order.id]))[0];
      const ex = expectData<any>(await mark(v1, await segmentOf(order.id, v1), [await itemIdOf(order.id, pA.id)]), 201);
      expectData(await respond(c, order.id, ex.id, 'CONTINUE_WITHOUT'), 201);

      let list = (await world.api('get', '/admin/order-exceptions', { token: ops.accessToken, query: { isolated: 'true' } })).body.data as any[];
      let row = list.find((r) => r.id === ex.id);
      expect(row).toMatchObject({ priority: 'HIGH', status: 'AWAITING_OPERATIONS', responsible: null, requiredAction: 'REVIEW_ISOLATED_CASE', isolation: { code: 'ORDER_WOULD_BE_EMPTY' } });
      expect(row.isolation.message).toEqual(expect.any(String));
      expect(row.requiredActionText).toMatch(/Nothing was changed/);
      expect(expectData<any>(await world.api('get', '/admin/order-exceptions/summary', { token: ops.accessToken })).isolated).toBeGreaterThanOrEqual(1);

      expectData(await world.api('post', `/admin/order-exceptions/${ex.id}/assign`, { token: ops.accessToken, body: { assigneeUserId: supervisor.id } }), 201);
      row = ((await world.api('get', '/admin/order-exceptions', { token: ops.accessToken, query: { isolated: 'true' } })).body.data as any[]).find((r) => r.id === ex.id);
      expect(row.responsible).toEqual({ userId: supervisor.id, name: 'S2 Supervisor' });
      expect(await recipients(ex.id, 'EXCEPTION_ASSIGNED')).toEqual([supervisor.id]);

      // Trying to "continue" again re-isolates: no item is removed, no money moves, no financial event is written.
      const financialBefore = (await world.ds.query('SELECT count(*)::int AS n FROM financial_events WHERE order_id = $1', [order.id]))[0].n;
      const walletBefore = (await world.ds.query('SELECT count(*)::int AS n FROM wallet_transactions WHERE customer_id = $1', [c.id]))[0].n;
      for (let i = 0; i < 2; i++) {
        const again = expectData<any>(await decide(ops, ex.id, { decision: 'CONTINUE_WITHOUT', channel: 'PHONE', note: 'customer said continue by phone' }), 201);
        expect(again).toMatchObject({ executed: false, isolated: 'ORDER_WOULD_BE_EMPTY' });
      }
      expect((await world.ds.query('SELECT total_minor, subtotal_minor, wallet_amount_minor FROM orders WHERE id = $1', [order.id]))[0]).toEqual(before);
      expect((await world.ds.query('SELECT removed_at, removed_amount_minor FROM order_items WHERE order_vendor_segment_id = $1', [await segmentOf(order.id, v1)])).every((r: any) => r.removed_at === null && r.removed_amount_minor === null)).toBe(true);
      expect((await world.ds.query('SELECT count(*)::int AS n FROM financial_events WHERE order_id = $1', [order.id]))[0].n).toBe(financialBefore);
      expect((await world.ds.query('SELECT count(*)::int AS n FROM wallet_transactions WHERE customer_id = $1', [c.id]))[0].n).toBe(walletBefore);
    });

    it('a critical case stays in the queue even after its order is over, until a person closes it; a routine one is hidden by default but never lost', async () => {
      const iso = await place([[pA, 1]]);
      const exIso = expectData<any>(await mark(v1, await segmentOf(iso.order.id, v1), [await itemIdOf(iso.order.id, pA.id)]), 201);
      expectData(await respond(iso.c, iso.order.id, exIso.id, 'CONTINUE_WITHOUT'), 201);
      const routine = await place([[pA, 1], [pB, 1]]);
      const exRoutine = expectData<any>(await mark(v1, await segmentOf(routine.order.id, v1), [await itemIdOf(routine.order.id, pA.id)]), 201);

      for (const o of [iso.order, routine.order]) {
        expect((await world.api('post', `/admin/orders/${o.id}/cancel`, { token: supervisor.accessToken, body: { reasonCode: 'OUT_OF_STOCK', reasonText: 'cancelled outside the case' } })).status).toBe(201);
      }
      const ids = async (query: Record<string, string> = {}) => ((await world.api('get', '/admin/order-exceptions', { token: ops.accessToken, query })).body.data as any[]).map((r) => r.id);
      expect(await ids()).toContain(exIso.id); // critical: never hidden by the order's state
      expect(await ids()).not.toContain(exRoutine.id);
      expect(await ids({ includeClosedOrders: 'true' })).toContain(exRoutine.id);

      // An active order's case cannot be "closed by Operations" — a decision is the way.
      const active = await place([[pA, 1], [pB, 1]]);
      const exActive = expectData<any>(await mark(v1, await segmentOf(active.order.id, v1), [await itemIdOf(active.order.id, pA.id)]), 201);
      const refused = await world.api('post', `/admin/order-exceptions/${exActive.id}/resolve`, { token: ops.accessToken, body: { note: 'trying to close an active case' } });
      expect(refused.status).toBe(409);
      expect(refused.body.error.details.code).toBe('ORDER_STILL_ACTIVE');

      expect((await world.api('post', `/admin/order-exceptions/${exIso.id}/resolve`, { token: ops.accessToken, body: { note: 'x' } })).status).toBe(400);
      const closed = expectData<any>(await world.api('post', `/admin/order-exceptions/${exIso.id}/resolve`, { token: ops.accessToken, body: { note: 'order was cancelled by the supervisor' } }), 201);
      expect(closed).toMatchObject({ status: 'RESOLVED', resolution: 'CLOSED_BY_OPERATIONS', isolation: null, requiredAction: null });
      expect(await ids()).not.toContain(exIso.id);
      expect((await world.ds.query("SELECT count(*)::int AS n FROM order_exception_events WHERE exception_id = $1 AND action = 'EXECUTION_ISOLATED'", [exIso.id]))[0].n).toBe(1); // history keeps the isolation
    });
  });

  // ======================================================================================================================== history

  describe('removed items keep their history', () => {
    it('the item row, its snapshots, the case, the audit trail and the money records all remain; only the active item collections change', async () => {
      const { c, order } = await place([[pA, 1], [pB, 1], [pD, 1]], 'WALLET', 100000);
      const itemA = await itemIdOf(order.id, pA.id);
      const before = (await world.ds.query('SELECT * FROM order_items WHERE id = $1', [itemA]))[0];
      const ex = expectData<any>(await mark(v1, await segmentOf(order.id, v1), [itemA]), 201);
      expectData(await respond(c, order.id, ex.id, 'CONTINUE_WITHOUT'), 201);

      const after = (await world.ds.query('SELECT * FROM order_items WHERE id = $1', [itemA]))[0];
      const { removed_at, removed_amount_minor, removal_exception_id, updated_at, ...afterRest } = after;
      const { removed_at: _a, removed_amount_minor: _b, removal_exception_id: _c, updated_at: _d, ...beforeRest } = before;
      expect(afterRest).toEqual(beforeRest); // name, price, quantity, snapshots: untouched
      expect(removed_at).not.toBeNull();
      expect(Number(removed_amount_minor)).toBe(10000);
      expect(removal_exception_id).toBe(ex.id);

      // Active collections no longer list it; the removed collection and the case still do.
      const customerSide = expectData<any>(await world.api('get', `/orders/${order.id}`, { token: c.accessToken }));
      expect(customerSide.segments.flatMap((g: any) => g.items).some((i: any) => i.id === itemA)).toBe(false);
      expect(customerSide.segments.flatMap((g: any) => g.removedItems).some((i: any) => i.id === itemA)).toBe(true);
      const adminSide = expectData<any>(await world.api('get', `/admin/orders/${order.id}`, { token: ops.accessToken }));
      expect(adminSide.segments.flatMap((g: any) => g.items).some((i: any) => i.id === itemA)).toBe(false);
      expect(adminSide.segments.flatMap((g: any) => g.removedItems).some((i: any) => i.id === itemA)).toBe(true);

      // Traceability: the link item → case → events → audit → refund all exist and agree.
      expect(Number((await world.ds.query('SELECT removed_amount_minor FROM order_exception_items WHERE exception_id = $1 AND order_item_id = $2', [ex.id, itemA]))[0].removed_amount_minor)).toBe(10000);
      expect((await world.ds.query('SELECT action FROM order_exception_events WHERE exception_id = $1 ORDER BY created_at', [ex.id])).map((r: any) => r.action)).toEqual(['ITEMS_MARKED_UNAVAILABLE', 'CUSTOMER_DECISION_RECORDED', 'ITEMS_REMOVED_ORDER_CONTINUES']);
      expect((await world.ds.query("SELECT count(*)::int AS n FROM admin_audit_logs WHERE target_id = $1 AND action LIKE 'order_exception.%'", [order.id]))[0].n).toBeGreaterThanOrEqual(2);
      expect((await world.ds.query("SELECT amount_delta_minor FROM wallet_transactions WHERE customer_id = $1 AND type = 'ORDER_REFUND'", [c.id])).map((r: any) => Number(r.amount_delta_minor))).toEqual([10000]);
      expect(Number((await world.ds.query('SELECT count(*)::int AS n FROM order_items WHERE order_vendor_segment_id = $1', [await segmentOf(order.id, v1)]))[0].n)).toBe(3); // no row was deleted
    });
  });
});
