import * as webpush from 'web-push';
import { isAllowedPushEndpoint, VapidWebPushSender } from './web-push-sender';
import { alertMessage, opsAlertHref } from './admin-push.service';
import { OpsAlertsService } from '../ops-alerts.service';
import { AdminControlTowerService } from '../../delivery/admin-control-tower.service';
import { collectEnvIssues } from '../../../config/env.validation';

jest.mock('web-push', () => {
  const actual = jest.requireActual('web-push');
  return { ...actual, sendNotification: jest.fn() };
});

describe('Admin Web Push sender', () => {
  const keys = webpush.generateVAPIDKeys();
  const saved = { ...process.env };
  const configure = (over: Record<string, string> = {}) => {
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY = keys.publicKey;
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY = keys.privateKey;
    process.env.WEB_PUSH_SUBJECT = 'mailto:ops@example.com';
    Object.assign(process.env, over);
    return new VapidWebPushSender();
  };
  const target = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: 'p', auth: 'a' };
  afterEach(() => {
    process.env = { ...saved };
    (webpush.sendNotification as jest.Mock).mockReset();
  });

  it('is not configured unless all three settings are present and valid; it never sends then', async () => {
    delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
    delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
    delete process.env.WEB_PUSH_SUBJECT;
    const none = new VapidWebPushSender();
    expect(none.isConfigured()).toBe(false);
    expect(none.publicKey()).toBeNull();
    await expect(none.send(target, '{}', { ttlSeconds: 60, urgency: 'high' })).rejects.toThrow('WEB_PUSH_NOT_CONFIGURED');
    expect(configure({ WEB_PUSH_VAPID_PRIVATE_KEY: 'not-a-key' }).isConfigured()).toBe(false);
    expect(configure({ WEB_PUSH_SUBJECT: 'ops@example.com' }).isConfigured()).toBe(false);
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it('sends with VAPID, TTL, urgency and topic; maps every HTTP answer to its status and rethrows only when no answer came', async () => {
    const sender = configure();
    expect(sender.isConfigured()).toBe(true);
    expect(sender.publicKey()).toBe(keys.publicKey);
    (webpush.sendNotification as jest.Mock).mockResolvedValueOnce({ statusCode: 201 });
    expect(await sender.send(target, '{"a":1}', { ttlSeconds: 3600, urgency: 'high', topic: 'abc' })).toEqual({ statusCode: 201 });
    const [sub, payload, opts] = (webpush.sendNotification as jest.Mock).mock.calls[0];
    expect(sub).toEqual({ endpoint: target.endpoint, keys: { p256dh: 'p', auth: 'a' } });
    expect(payload).toBe('{"a":1}');
    expect(opts).toMatchObject({ TTL: 3600, urgency: 'high', topic: 'abc', contentEncoding: 'aes128gcm', vapidDetails: { subject: 'mailto:ops@example.com', publicKey: keys.publicKey } });

    (webpush.sendNotification as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }));
    expect(await sender.send(target, '{}', { ttlSeconds: 60, urgency: 'normal' })).toEqual({ statusCode: 410 });
    (webpush.sendNotification as jest.Mock).mockRejectedValueOnce(new Error('ETIMEDOUT'));
    await expect(sender.send(target, '{}', { ttlSeconds: 60, urgency: 'normal' })).rejects.toThrow('ETIMEDOUT');
  });

  it('never posts to a host that is not a known browser push service', async () => {
    const sender = configure();
    expect(await sender.send({ ...target, endpoint: 'https://internal.example/x' }, '{}', { ttlSeconds: 60, urgency: 'high' })).toEqual({ statusCode: 400 });
    expect(webpush.sendNotification).not.toHaveBeenCalled();
    for (const ok of ['https://fcm.googleapis.com/fcm/send/x', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://wns2-par02p.notify.windows.com/w/?token=x', 'https://web.push.apple.com/abc']) {
      expect(isAllowedPushEndpoint(ok)).toBe(true);
    }
    for (const bad of ['http://fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'https://fcm.googleapis.com.evil.io/x', 'https://127.0.0.1/x', 'https://notify.windows.com.evil/x', 'javascript:alert(1)', 'not a url']) {
      expect(isAllowedPushEndpoint(bad)).toBe(false);
    }
  });
});

describe('Admin alert messages and links', () => {
  const alert = { id: '11111111-1111-4111-8111-111111111111', category: 'NEW_ORDER', priority: 'CRITICAL' as const, order_id: '22222222-2222-4222-8222-222222222222', order_number: 'HT-100036' };

  it('names the order number in English and Arabic, opens the exact order, and repeats are marked', () => {
    const first = alertMessage(alert, 0);
    expect(first).toMatchObject({ url: `/order-management?order=${alert.order_id}`, tag: `ops-${alert.id}`, priority: 'CRITICAL', renotify: false, alertId: alert.id });
    expect(first.title).toContain('HT-100036');
    expect(first.title).toContain('طلب جديد');
    expect(alertMessage(alert, 2)).toMatchObject({ renotify: true });
    expect(alertMessage(alert, 2).title.startsWith('⚠')).toBe(true);
  });

  it('every category leads to the order; a failed delivery without an order to the failed-delivery queue', () => {
    for (const c of ['NEW_ORDER', 'ACCEPTANCE_OVERDUE', 'PREPARATION_LATE', 'DRIVER_ACK_OVERDUE', 'NO_DRIVER', 'DRIVER_NOT_RESPONDING', 'ASSIGNMENT_ERROR', 'FAILED_DELIVERY']) {
      expect(opsAlertHref({ category: c, order_id: alert.order_id })).toBe(`/order-management?order=${alert.order_id}`);
    }
    expect(opsAlertHref({ category: 'FAILED_DELIVERY', order_id: null })).toBe('/failed-deliveries');
  });

  it('uses the same store-acceptance threshold as the Control Tower (no new business threshold)', () => {
    expect(OpsAlertsService.PENDING_ACCEPTANCE_ALERT_MINUTES).toBe(AdminControlTowerService.PENDING_ACCEPTANCE_ALERT_MINUTES);
  });
});

describe('Web Push environment checks', () => {
  const issuesFor = (extra: Record<string, string>) => collectEnvIssues({ NODE_ENV: 'production', ...extra } as any);
  it('missing is a warning (in-app alarm only); half-set or a bad subject is an error', () => {
    expect(issuesFor({}).warnings.some((w) => w.includes('Admin Web Push is not configured'))).toBe(true);
    expect(issuesFor({ WEB_PUSH_VAPID_PUBLIC_KEY: 'x' }).errors.some((e) => e.includes('must be set together'))).toBe(true);
    expect(issuesFor({ WEB_PUSH_VAPID_PUBLIC_KEY: 'x', WEB_PUSH_VAPID_PRIVATE_KEY: 'y', WEB_PUSH_SUBJECT: 'ops' }).errors.some((e) => e.includes('WEB_PUSH_SUBJECT'))).toBe(true);
    expect(issuesFor({ WEB_PUSH_VAPID_PUBLIC_KEY: 'x', WEB_PUSH_VAPID_PRIVATE_KEY: 'y', WEB_PUSH_SUBJECT: 'mailto:ops@hatly.dev' }).errors.some((e) => e.includes('WEB_PUSH'))).toBe(false);
  });
});
