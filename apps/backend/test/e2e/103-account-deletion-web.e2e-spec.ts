/**
 * Account-deletion compliance (Google Play: deletion must be requestable WITHOUT the app). Real HTTP, real PostgreSQL, real local storage.
 *  - Public self-service (`POST /account-deletion/delete`): phone + password; one generic 401 for every non-match (no account oracle);
 *    the per-account brake; the 409 rules; success erases exactly like the in-app route, plus the wider erase below.
 *  - Wider erase (all channels): the customer's photos (upload rows AND stored files), custom-request text, item/vendor notes,
 *    cancellation reason and Hatly Service coordinates on their finished orders — amounts, place names and other people's data kept.
 *  - "I can't sign in" (`POST /account-deletion/requests`): same answer for any number, deletes nothing; a SUPER_ADMIN completes
 *    (verification method recorded, phone masked) or rejects; ADMIN / vendor / anonymous refused.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as supertest from 'supertest';
import { bootWorld, World } from './support/world';
import { Scenario, Actor, DEFAULT_PASSWORD, nextPhone, PNG_1X1_BASE64 } from './support/actors';
import { Permission } from '../../src/modules/permissions/permission.enum';

const NEVER_EXISTS = '00000000-0000-4000-8000-000000000000';
const UPLOAD_DIR = path.join(os.tmpdir(), 'hatly-e2e-uploads');

describe('E2E — account deletion without the app (web page backend)', () => {
  let world: World;
  let s: Scenario;
  let product: { id: string };
  const home = { lat: 30.425, lng: 31.565 };
  const q = (sql: string, params: unknown[] = []) => world.ds.query(sql, params);
  const webDelete = (body: Record<string, unknown>) => world.api('post', '/account-deletion/delete', { body });
  const request = (body: Record<string, unknown>) => world.api('post', '/account-deletion/requests', { body });
  const userRow = async (id: string) => (await q('SELECT full_name, phone, is_active FROM users WHERE id = $1', [id]))[0];
  const fileOf = (url: string) => path.join(UPLOAD_DIR, url.split('/').pop()!);
  let seed = 0;

  /** A customer with a FINISHED (cancelled) order carrying a custom-request photo, free text, notes and Hatly Service coordinates. */
  async function customerWithHistory(name: string) {
    const c = await s.customer(name);
    await s.address(c, home);
    await s.addToCart(c, product.id, 1);
    const order = await s.checkout(c, home, 'COD');
    expect((await world.api('post', `/orders/${order.id}/cancel`, { token: c.accessToken, body: { cancellationReason: 'changed my mind, call me on 0100' } })).status).toBe(201);
    const photo = await s.uploadFakePhoto(c.accessToken);
    expect(fs.existsSync(fileOf(photo))).toBe(true);
    expect((await supertest(world.baseUrl).get(photo)).status).toBe(200); // served before deletion
    await q(
      `UPDATE order_items SET free_text_description_snapshot = 'insulin pens for my father', image_urls_snapshot = $2::jsonb, notes = 'no onions'
       WHERE order_vendor_segment_id IN (SELECT id FROM order_vendor_segments WHERE order_id = $1)`,
      [order.id, JSON.stringify([photo])],
    );
    await q(
      `UPDATE order_vendor_segments SET vendor_note_snapshot = 'gate code 1234', ad_hoc_place_name_snapshot = 'Corner Pharmacy',
              ad_hoc_pickup_latitude_snapshot = 30.41, ad_hoc_pickup_longitude_snapshot = 31.55,
              ad_hoc_destination_latitude_snapshot = 30.43, ad_hoc_destination_longitude_snapshot = 31.57 WHERE order_id = $1`,
      [order.id],
    );
    return { c, order, photo };
  }

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    const area = await s.serviceArea({ radiusMeters: 50000 });
    const vendor = await s.vendor({ name: 'Web Deletion Vendor', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    product = await s.product(vendor, { priceMinor: 12000, inventoryMode: 'OPEN' });
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  describe('public self-service (phone + password)', () => {
    it('unknown number, wrong password and a non-customer account all get the SAME 401 body; nothing changes', async () => {
      const c = await s.customer('Web Target');
      const area = await s.serviceArea({ radiusMeters: 50000 });
      const vendor = await s.vendor({ name: 'Web Staff Vendor', serviceAreaId: area.id, lat: 30.422, lng: 31.562 });
      const answers = [
        await webDelete({ phone: nextPhone(), password: DEFAULT_PASSWORD }),
        await webDelete({ phone: c.phone, password: 'Wrong-Passw0rd!' }),
        await webDelete({ phone: vendor.manager.phone, password: DEFAULT_PASSWORD }),
      ];
      for (const a of answers) expect(a.status).toBe(401);
      const shape = answers.map((a) => ({ code: a.body.error.details?.code, message: a.body.error.message }));
      expect(new Set(shape.map((x) => JSON.stringify(x))).size).toBe(1);
      expect(shape[0]).toEqual({ code: 'INVALID_CREDENTIALS', message: 'Invalid phone number or password.' });
      expect((await userRow(c.id)).is_active).toBe(true);
      expect((await userRow(vendor.manager.id)).is_active).toBe(true);
    });

    it('guessing is braked per ACCOUNT: after 10 failures even the right password gets 429 and the account survives', async () => {
      const c = await s.customer('Braked Customer');
      for (let i = 0; i < 10; i++) expect((await webDelete({ phone: c.phone, password: `guess-${i}-xx` })).status).toBe(401);
      const locked = await webDelete({ phone: c.phone, password: DEFAULT_PASSWORD });
      expect(locked.status).toBe(429);
      expect((await userRow(c.id)).is_active).toBe(true);
      await world.redis.del(`login-fail:${c.phone}`); // leave the shared brake clean for other tests
    });

    it('the 409 rules hold (order in progress / wallet not empty) and nothing is erased', async () => {
      const busy = await s.customer('Web Busy');
      await s.address(busy, home);
      await s.addToCart(busy, product.id, 1);
      await s.checkout(busy, home, 'COD');
      const r1 = await webDelete({ phone: busy.phone, password: DEFAULT_PASSWORD });
      expect(r1.status).toBe(409);
      expect(r1.body.error.details.code).toBe('ACCOUNT_HAS_ACTIVE_ORDERS');
      const rich = await s.customer('Web Wallet');
      await q("INSERT INTO wallet_transactions (customer_id, amount_delta_minor, type, idempotency_key, reason) VALUES ($1, 700, 'ADMIN_CREDIT', $2, 'e2e')", [rich.id, `e2e-web-${seed++}`]);
      const r2 = await webDelete({ phone: rich.phone, password: DEFAULT_PASSWORD });
      expect(r2.status).toBe(409);
      expect(r2.body.error.details.code).toBe('ACCOUNT_HAS_WALLET_BALANCE');
      expect((await userRow(busy.id)).is_active).toBe(true);
      expect((await userRow(rich.id)).is_active).toBe(true);
    });

    it('success: identity erased, photos deleted from storage, own words and errand coordinates removed; amounts, place name and the bystander kept', async () => {
      const bystander = await customerWithHistory('Web Bystander');
      const { c, order, photo } = await customerWithHistory('Web Leaver');
      const before = (await q('SELECT total_minor, order_number, status FROM orders WHERE id = $1', [order.id]))[0];

      const res = await webDelete({ phone: c.phone, password: DEFAULT_PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Your account has been deleted.');

      expect(await userRow(c.id)).toEqual({ full_name: 'Deleted customer', phone: expect.stringMatching(/^deleted-[0-9a-f]{11}$/), is_active: false });
      const after = (await q('SELECT total_minor, order_number, status, cancellation_reason, order_note FROM orders WHERE id = $1', [order.id]))[0];
      expect(after).toMatchObject({ total_minor: before.total_minor, order_number: before.order_number, status: before.status, cancellation_reason: null, order_note: null });
      const items = await q('SELECT i.free_text_description_snapshot, i.image_urls_snapshot, i.notes, i.product_name_snapshot, i.unit_price_minor FROM order_items i JOIN order_vendor_segments g ON g.id = i.order_vendor_segment_id WHERE g.order_id = $1', [order.id]);
      for (const i of items) {
        expect(i).toMatchObject({ free_text_description_snapshot: null, image_urls_snapshot: null, notes: null });
        expect(i.product_name_snapshot).toBeTruthy(); // what was bought stays (accounting)
      }
      const seg = (await q('SELECT vendor_note_snapshot, ad_hoc_place_name_snapshot, ad_hoc_pickup_latitude_snapshot, ad_hoc_destination_latitude_snapshot, ad_hoc_destination_longitude_snapshot FROM order_vendor_segments WHERE order_id = $1', [order.id]))[0];
      expect(seg).toEqual({ vendor_note_snapshot: null, ad_hoc_place_name_snapshot: 'Corner Pharmacy', ad_hoc_pickup_latitude_snapshot: null, ad_hoc_destination_latitude_snapshot: null, ad_hoc_destination_longitude_snapshot: null });
      expect(Number((await q('SELECT count(*)::int AS n FROM uploads WHERE uploaded_by_user_id = $1', [c.id]))[0].n)).toBe(0);
      expect(fs.existsSync(fileOf(photo))).toBe(false); // the stored file itself is gone
      expect((await supertest(world.baseUrl).get(photo)).status).toBe(404); // and no longer served
      const audit = (await q("SELECT metadata FROM admin_audit_logs WHERE action = 'customer.account_deleted' AND target_id = $1", [c.id]))[0];
      expect(audit.metadata).toMatchObject({ channel: 'web', filesRemoved: 1, filesNotRemoved: 0 });

      // the bystander's history, photo and file are untouched
      expect(fs.existsSync(fileOf(bystander.photo))).toBe(true);
      expect(Number((await q('SELECT count(*)::int AS n FROM uploads WHERE uploaded_by_user_id = $1', [bystander.c.id]))[0].n)).toBe(1);
      const bItem = (await q('SELECT i.free_text_description_snapshot FROM order_items i JOIN order_vendor_segments g ON g.id = i.order_vendor_segment_id WHERE g.order_id = $1 LIMIT 1', [bystander.order.id]))[0];
      expect(bItem.free_text_description_snapshot).toBe('insulin pens for my father');
      expect((await q('SELECT ad_hoc_destination_latitude_snapshot FROM order_vendor_segments WHERE order_id = $1', [bystander.order.id]))[0].ad_hoc_destination_latitude_snapshot).toBe(30.43);

      // sign-in dies; a repeat is the generic 401
      expect((await world.api('post', '/auth/customer/password/login', { body: { phone: c.phone, password: DEFAULT_PASSWORD } })).status).toBe(401);
      expect((await webDelete({ phone: c.phone, password: DEFAULT_PASSWORD })).status).toBe(401);
    });

    it('the IN-APP route uses the same wider erase (photo file and custom-request text removed)', async () => {
      const { c, order, photo } = await customerWithHistory('App Leaver');
      expect((await world.api('post', '/auth/customer/delete-account', { token: c.accessToken, body: { password: DEFAULT_PASSWORD } })).status).toBe(200);
      expect(fs.existsSync(fileOf(photo))).toBe(false);
      const item = (await q('SELECT i.free_text_description_snapshot FROM order_items i JOIN order_vendor_segments g ON g.id = i.order_vendor_segment_id WHERE g.order_id = $1 LIMIT 1', [order.id]))[0];
      expect(item.free_text_description_snapshot).toBeNull();
    });

    it('only phone + password are accepted (no way to name another account); malformed input is a 400', async () => {
      const c = await s.customer('Web Validation');
      expect((await webDelete({ phone: c.phone })).status).toBe(400);
      expect((await webDelete({ phone: 'not-a-phone', password: DEFAULT_PASSWORD })).status).toBe(400);
      expect((await webDelete({ phone: c.phone, password: DEFAULT_PASSWORD, userId: NEVER_EXISTS })).status).toBe(400);
      expect((await userRow(c.id)).is_active).toBe(true);
    });
  });

  describe('"I can\'t sign in" requests, verified by a SUPER_ADMIN', () => {
    it('every number gets the same 202 answer; nothing is deleted; one pending request per number', async () => {
      const c = await s.customer('Request Target');
      const stranger = nextPhone();
      const a = await request({ phone: c.phone });
      const b = await request({ phone: stranger });
      expect(a.status).toBe(202);
      expect(b.status).toBe(202);
      expect(a.body).toEqual(b.body);
      expect(await request({ phone: c.phone })).toMatchObject({ status: 202 });
      expect(Number((await q("SELECT count(*)::int AS n FROM account_deletion_requests WHERE phone = $1 AND status = 'PENDING'", [c.phone]))[0].n)).toBe(1);
      expect((await userRow(c.id)).is_active).toBe(true);
      expect((await request({ phone: c.phone, fullName: 'x' })).status).toBe(400); // only the phone is accepted
    });

    it('a SUPER_ADMIN completes a verified request: the account is erased, the method recorded, the phone masked; replay refused', async () => {
      const { c, photo } = await customerWithHistory('Request Leaver');
      await request({ phone: c.phone });
      const superAdmin = await s.superAdmin();
      const list = (await world.api('get', '/admin/account-deletion-requests', { token: superAdmin.accessToken })).body.data as any[];
      const pending = list.find((r) => r.phone === c.phone);
      expect(pending).toMatchObject({ status: 'PENDING' });

      const done = await world.api('post', `/admin/account-deletion-requests/${pending.id}/complete`, { token: superAdmin.accessToken, body: { verificationMethod: 'CALLBACK_TO_ACCOUNT_PHONE' } });
      expect(done.status).toBe(200);
      expect(done.body.data).toMatchObject({ status: 'COMPLETED', phone: `***${c.phone.slice(-3)}`, verificationMethod: 'CALLBACK_TO_ACCOUNT_PHONE', resolvedByUserId: superAdmin.id });
      expect((await userRow(c.id)).full_name).toBe('Deleted customer');
      expect(fs.existsSync(fileOf(photo))).toBe(false);
      expect(Number((await q('SELECT count(*)::int AS n FROM account_deletion_requests WHERE phone = $1', [c.phone]))[0].n)).toBe(0); // no full number kept
      const audit = (await q("SELECT actor_user_id, metadata FROM admin_audit_logs WHERE action = 'customer.account_deleted' AND target_id = $1", [c.id]))[0];
      expect(audit).toMatchObject({ actor_user_id: superAdmin.id, metadata: { channel: 'web_request', verificationMethod: 'CALLBACK_TO_ACCOUNT_PHONE', requestId: pending.id } });
      const again = await world.api('post', `/admin/account-deletion-requests/${pending.id}/complete`, { token: superAdmin.accessToken, body: { verificationMethod: 'CALLBACK_TO_ACCOUNT_PHONE' } });
      expect(again.status).toBe(409);
      expect(again.body.error.details.code).toBe('DELETION_REQUEST_NOT_PENDING');
    });

    it('a request for a number with no account cannot be completed (409) and is rejected with a reason; the 409 rules keep a request PENDING', async () => {
      const superAdmin = await s.superAdmin();
      const ghost = nextPhone();
      await request({ phone: ghost });
      const id = (await q("SELECT id FROM account_deletion_requests WHERE phone = $1 AND status = 'PENDING'", [ghost]))[0].id;
      const r = await world.api('post', `/admin/account-deletion-requests/${id}/complete`, { token: superAdmin.accessToken, body: { verificationMethod: 'WHATSAPP_FROM_ACCOUNT_PHONE' } });
      expect(r.status).toBe(409);
      expect(r.body.error.details.code).toBe('NO_ACTIVE_CUSTOMER_ACCOUNT');
      const rejected = await world.api('post', `/admin/account-deletion-requests/${id}/reject`, { token: superAdmin.accessToken, body: { reason: 'NO_ACCOUNT_FOR_NUMBER' } });
      expect(rejected.status).toBe(200);
      expect(rejected.body.data).toMatchObject({ status: 'REJECTED', rejectionReason: 'NO_ACCOUNT_FOR_NUMBER', phone: `***${ghost.slice(-3)}` });

      const busy = await s.customer('Request Busy');
      await s.address(busy, home);
      await s.addToCart(busy, product.id, 1);
      await s.checkout(busy, home, 'COD');
      await request({ phone: busy.phone });
      const busyId = (await q("SELECT id FROM account_deletion_requests WHERE phone = $1 AND status = 'PENDING'", [busy.phone]))[0].id;
      const blocked = await world.api('post', `/admin/account-deletion-requests/${busyId}/complete`, { token: superAdmin.accessToken, body: { verificationMethod: 'CALLBACK_TO_ACCOUNT_PHONE' } });
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.details.code).toBe('ACCOUNT_HAS_ACTIVE_ORDERS');
      expect((await q('SELECT status, phone FROM account_deletion_requests WHERE id = $1', [busyId]))[0]).toEqual({ status: 'PENDING', phone: busy.phone });
      expect((await userRow(busy.id)).is_active).toBe(true);
    });

    it('only a SUPER_ADMIN may review: ADMIN (even with every customer permission), vendor, customer and anonymous are refused; bad input is 400', async () => {
      const c = await s.customer('Review Authz');
      await request({ phone: c.phone });
      const id = (await q("SELECT id FROM account_deletion_requests WHERE phone = $1 AND status = 'PENDING'", [c.phone]))[0].id;
      const admin = await s.admin([Permission.VIEW_CUSTOMERS, Permission.MANAGE_CUSTOMER_WALLET, Permission.MANAGE_ORDER_ISSUES], 'Not Super');
      const area = await s.serviceArea({ radiusMeters: 50000 });
      const vendor = await s.vendor({ name: 'Review Vendor', serviceAreaId: area.id, lat: 30.423, lng: 31.563 });
      const body = { verificationMethod: 'CALLBACK_TO_ACCOUNT_PHONE' };
      for (const token of [admin.accessToken, vendor.manager.accessToken, c.accessToken]) {
        expect((await world.api('get', '/admin/account-deletion-requests', { token })).status).toBe(403);
        expect((await world.api('post', `/admin/account-deletion-requests/${id}/complete`, { token, body })).status).toBe(403);
        expect((await world.api('post', `/admin/account-deletion-requests/${id}/reject`, { token, body: { reason: 'DUPLICATE' } })).status).toBe(403);
      }
      expect((await world.api('post', `/admin/account-deletion-requests/${id}/complete`, { body })).status).toBe(401);
      const superAdmin = await s.superAdmin();
      expect((await world.api('post', `/admin/account-deletion-requests/${id}/complete`, { token: superAdmin.accessToken, body: { verificationMethod: 'TRUST_ME' } })).status).toBe(400);
      expect((await world.api('post', `/admin/account-deletion-requests/${NEVER_EXISTS}/complete`, { token: superAdmin.accessToken, body })).status).toBe(404);
      expect((await world.api('post', `/admin/account-deletion-requests/not-a-uuid/complete`, { token: superAdmin.accessToken, body })).status).toBe(400);
      expect((await userRow(c.id)).is_active).toBe(true);
      expect((await q('SELECT status FROM account_deletion_requests WHERE id = $1', [id]))[0].status).toBe('PENDING');
    });
  });

  it('nothing in this suite stored a full phone number or a password in the audit log', async () => {
    const dump = JSON.stringify(await q("SELECT * FROM admin_audit_logs WHERE action LIKE 'customer.%'"));
    expect(dump).not.toContain(DEFAULT_PASSWORD);
    expect(dump).not.toMatch(/\+20\d{10}/);
    void PNG_1X1_BASE64;
  });
});
