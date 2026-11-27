/**
 * Owner decision 2026-11-27: a Hatly / Wasaly request may be text, photos or a VOICE NOTE (up to 5 minutes) — each optional, at
 * least one required. The voice note is the customer's own upload, travels cart → order → driver / Operations, and Operations can
 * write a note for the driver.
 */
import * as http from 'http';
import sharp = require('sharp');
import { bootWorld, World } from './support/world';
import { Scenario, Actor, expectData, withQuoteToken } from './support/actors';
import { Permission } from '../../src/modules/permissions/permission.enum';

/** A tiny but real-looking M4A header (the server reads the type from the bytes, not from a name). */
const M4A = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypM4A \0\0\0\0M4A isom', 'latin1'), Buffer.alloc(64, 1)]).toString('base64');

describe('E2E — voice notes on Hatly / Wasaly requests', () => {
  let world: World;
  let s: Scenario;
  let ops: Actor;
  const address: Record<string, unknown> = { line1: 'Customer Home', latitude: 30.42, longitude: 31.56 };

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    const area = await s.serviceArea({ radiusMeters: 50000 });
    address.deliveryZoneId = (await s.deliveryZone({ serviceAreaId: area.id, feeMinor: 1500 })).id;
    await s.setConfig('HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER', 1.5);
    ops = await s.admin([Permission.MANAGE_ORDER_FULFILMENT, Permission.VIEW_ORDERS]);
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  const request = (extra: Record<string, unknown>) => ({
    adHocPlaceName: 'Corner Pharmacy',
    adHocServiceType: 'BUY_FROM_PLACE',
    pickupLatitude: 30.3,
    pickupLongitude: 31.45,
    destinationLatitude: 30.31,
    destinationLongitude: 31.46,
    quantity: 1,
    ...extra,
  });
  const uploadVoice = async (c: Actor) => expectData<any>(await world.api('post', '/uploads/audio', { token: c.accessToken, body: { base64Content: M4A } }), 201).url as string;

  it('owner 2026-11-28: the voice-note limit is set in Admin settings (30–600 s, blank = 300) and read by the app', async () => {
    const admin = await s.superAdmin();
    const c = await s.customer('Limit Reader');
    const limit = async () => expectData<any>(await world.api('get', '/hatly-service/voice-note-limit', { token: c.accessToken })).maxSeconds;
    expect(await limit()).toBe(300);
    expectData(await world.api('put', '/admin/business-config/VOICE_NOTE_MAX_SECONDS', { token: admin.accessToken, body: { value: 120 } }));
    expect(await limit()).toBe(120);
    expect((await world.api('put', '/admin/business-config/VOICE_NOTE_MAX_SECONDS', { token: admin.accessToken, body: { value: 5 } })).status).toBe(400);
    expect((await world.api('put', '/admin/business-config/VOICE_NOTE_MAX_SECONDS', { token: admin.accessToken, body: { value: 900 } })).status).toBe(400);
    expect((await world.api('delete', '/admin/business-config/VOICE_NOTE_MAX_SECONDS', { token: admin.accessToken })).status).toBeLessThan(300);
    expect(await limit()).toBe(300);
  });

  it('UAT 2026-11-28: Operations see the photos of a Hatly request', async () => {
    const c = await s.customer('Photo Request');
    const png = sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 9, g: 99, b: 199 } } }).png().toBuffer();
    const up = expectData<any>(await world.api('post', '/uploads', { token: c.accessToken, body: { base64Content: (await png).toString('base64'), filename: 'photo.png' } }), 201);
    expectData(await world.api('post', '/cart/adhoc-items', { token: c.accessToken, body: request({ freeTextDescription: 'This one', imageUrls: [up.url] }) }), 201);
    const placed = await world.api('post', '/orders', { token: c.accessToken, body: await withQuoteToken(world, c.accessToken, { deliveryAddress: address, paymentMethod: 'COD' }) });
    expect(placed.status).toBe(201);
    const admin = expectData<any>(await world.api('get', `/admin/orders/${placed.body.data.id}`, { token: ops.accessToken }));
    expect(admin.segments[0].items[0].imageUrls).toEqual([up.url]);
  });

  it('rejects a file that is not audio, and an empty request (no text, photo or voice)', async () => {
    const c = await s.customer('Voice Reject');
    const bad = await world.api('post', '/uploads/audio', { token: c.accessToken, body: { base64Content: Buffer.from('hello world, not audio').toString('base64') } });
    expect(bad.status).toBe(400);
    expect(bad.body.error?.details?.code ?? bad.body.details?.code ?? JSON.stringify(bad.body)).toContain('UNSUPPORTED_AUDIO_TYPE');
    const empty = await world.api('post', '/cart/adhoc-items', { token: c.accessToken, body: request({}) });
    expect(empty.status).toBe(400);
    expect(JSON.stringify(empty.body)).toContain('CUSTOM_ITEM_CONTENT_REQUIRED');
  });

  it("refuses another customer's voice note", async () => {
    const owner = await s.customer('Voice Owner');
    const thief = await s.customer('Voice Other');
    const url = await uploadVoice(owner);
    const res = await world.api('post', '/cart/adhoc-items', { token: thief.accessToken, body: request({ voiceNoteUrl: url }) });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('INVALID_VOICE_NOTE_REFERENCE');
  });

  it('a voice-only request reaches the order, Operations and the driver; Operations add a note for the driver', async () => {
    const c = await s.customer('Voice Only');
    const url = await uploadVoice(c);
    // UAT VN-10: stored with its audio extension and served as audio (a browser's <audio> refuses a generic binary type).
    expect(url).toMatch(/\.m4a$/);
    const served = await new Promise<{ status: number; type: string }>((resolve, reject) =>
      http.get(new URL(url, world.baseUrl), (res) => { res.resume(); resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? '') }); }).on('error', reject));
    expect(served.status).toBe(200);
    expect(served.type).toMatch(/^audio\/mp4/);
    expectData(await world.api('post', '/cart/adhoc-items', { token: c.accessToken, body: request({ voiceNoteUrl: url }) }), 201);
    const cart = expectData<any>(await world.api('get', '/cart', { token: c.accessToken }));
    expect(cart.groups[0].items[0]).toMatchObject({ voiceNoteUrl: url, freeTextDescription: null });

    await s.driver({ lat: 30.3, lng: 31.45 });
    const placed = await world.api('post', '/orders', {
      token: c.accessToken,
      body: await withQuoteToken(world, c.accessToken, { deliveryAddress: address, paymentMethod: 'COD' }),
    });
    expect(placed.status).toBe(201);
    const orderId = placed.body.data.id as string;

    const mine = expectData<any>(await world.api('get', `/orders/${orderId}`, { token: c.accessToken }));
    expect(mine.segments[0].items[0].voiceNoteUrlSnapshot).toBe(url);

    const admin = expectData<any>(await world.api('get', `/admin/orders/${orderId}`, { token: ops.accessToken }));
    const adminItem = (admin.segments?.[0]?.items ?? admin.items)[0];
    expect(adminItem.voiceNoteUrl).toBe(url);
    expect(admin.operationsNoteForDriver).toBeNull();

    const noted = expectData<any>(await world.api('patch', `/admin/orders/${orderId}/driver-note`, { token: ops.accessToken, body: { note: '  Ask for the large pack  ' } }));
    expect(noted.operationsNoteForDriver).toBe('Ask for the large pack');

    const driver = await s.driverAssignedTo(orderId);
    const delivery = expectData<any[]>(await world.api('get', '/driver/deliveries', { token: driver.accessToken })).find((d) => d.orderId === orderId);
    expect(delivery.operationsNote).toBe('Ask for the large pack');
    expect(delivery.segments[0].items[0].voiceNoteUrlSnapshot).toBe(url);

    // An empty note clears it; a customer cannot write it.
    expect(expectData<any>(await world.api('patch', `/admin/orders/${orderId}/driver-note`, { token: ops.accessToken, body: { note: '' } })).operationsNoteForDriver).toBeNull();
    expect((await world.api('patch', `/admin/orders/${orderId}/driver-note`, { token: c.accessToken, body: { note: 'x' } })).status).toBe(403);
  });
});
