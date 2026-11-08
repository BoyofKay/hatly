import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/** Runs public/sw.js in a fake ServiceWorkerGlobalScope and drives its events. */
const SOURCE = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');

function load(opts: { api?: string; clients?: any[] } = {}) {
  const handlers: Record<string, (e: any) => void> = {};
  const shown: Array<{ title: string; options: any }> = [];
  const fetches: Array<{ url: string; body: any; credentials: string }> = [];
  const opened: string[] = [];
  const clientList = opts.clients ?? [];
  const self: any = {
    location: { href: `https://admin.hatly.dev/sw.js${opts.api === undefined ? '?api=https%3A%2F%2Fapi.hatly.dev%2Fapi%2Fv1' : opts.api}`, origin: 'https://admin.hatly.dev' },
    addEventListener: (type: string, fn: (e: any) => void) => (handlers[type] = fn),
    skipWaiting: () => undefined,
    registration: { showNotification: async (title: string, options: any) => void shown.push({ title, options }) },
    clients: { matchAll: async () => clientList, openWindow: async (url: string) => void opened.push(url), claim: async () => undefined },
  };
  const fetch = async (url: string, init: any) => {
    fetches.push({ url, body: JSON.parse(init.body), credentials: init.credentials });
    return { ok: true };
  };
  vm.runInNewContext(SOURCE, { self, fetch, URL, JSON, Date, String, Boolean, Promise, console });
  const fire = async (type: string, event: any) => {
    let pending: Promise<unknown> = Promise.resolve();
    handlers[type]({ ...event, waitUntil: (p: Promise<unknown>) => (pending = p) });
    await pending;
  };
  return { handlers, shown, fetches, opened, fire };
}

/** Objects made inside the sandbox have that realm's prototypes; compare their plain shape. */
const plain = (x: unknown) => JSON.parse(JSON.stringify(x));
const pushEvent = (data: unknown) => ({ data: { json: () => data } });
const message = { v: 1, deliveryId: 'd-1', receiptToken: 'tok-123', title: 'New order HT-100036 · طلب جديد', body: 'Open Hatly Admin', url: '/order-management?order=o-1', tag: 'ops-a-1', priority: 'CRITICAL', alertId: 'a-1', renotify: true };

test('a push shows a sticky, vibrating notification with the alert tag, reports "displayed" with its token (no cookies) and tells open tabs', async () => {
  const tab = { url: 'https://admin.hatly.dev/home', messages: [] as any[], postMessage(m: any) { this.messages.push(m); } };
  const sw = load({ clients: [tab] });
  await sw.fire('push', pushEvent(message));
  assert.equal(sw.shown.length, 1);
  assert.equal(sw.shown[0].title, message.title);
  assert.equal(sw.shown[0].options.tag, 'ops-a-1');
  assert.equal(sw.shown[0].options.requireInteraction, true);
  assert.equal(sw.shown[0].options.renotify, true);
  assert.deepEqual(plain(sw.shown[0].options.vibrate), [400, 200, 400, 200, 400]);
  assert.equal(sw.shown[0].options.data.url, 'https://admin.hatly.dev/order-management?order=o-1');
  assert.deepEqual(plain(sw.fetches), [{ url: 'https://api.hatly.dev/api/v1/push-receipts', body: { deliveryId: 'd-1', token: 'tok-123', event: 'displayed' }, credentials: 'omit' }]);
  assert.deepEqual(plain(tab.messages), [{ type: 'hatly-push', alertId: 'a-1', priority: 'CRITICAL' }]);
});

test('a non-critical push is not sticky; an unreadable push still shows a generic notice and sends no receipt', async () => {
  const sw = load();
  await sw.fire('push', pushEvent({ ...message, priority: 'HIGH', renotify: false }));
  assert.equal(sw.shown[0].options.requireInteraction, false);
  await sw.fire('push', { data: { json: () => { throw new Error('bad'); } } });
  assert.equal(sw.shown[1].options.tag, 'hatly-generic');
  assert.equal(sw.fetches.length, 1);
});

test('clicking focuses an open Hatly tab and navigates it to the exact order, reporting "clicked"', async () => {
  const calls: string[] = [];
  const tab = { url: 'https://admin.hatly.dev/home', focused: false, focus: async () => void calls.push('focus'), navigate: async (u: string) => void calls.push(`navigate ${u}`), postMessage: () => calls.push('post') };
  const sw = load({ clients: [tab] });
  let closed = false;
  await sw.fire('notificationclick', { notification: { data: { url: 'https://admin.hatly.dev/order-management?order=o-1', deliveryId: 'd-1', receiptToken: 'tok-123' }, close: () => (closed = true) } });
  assert.equal(closed, true);
  assert.deepEqual(calls, ['focus', 'navigate https://admin.hatly.dev/order-management?order=o-1']);
  assert.equal(sw.fetches[0].body.event, 'clicked');
  assert.deepEqual(sw.opened, []);
});

test('with no Hatly tab open, a click opens a new window on the order; a tab that cannot be navigated is asked to navigate itself', async () => {
  const sw = load({ clients: [{ url: 'https://other.example/x', focus: async () => undefined }] });
  await sw.fire('notificationclick', { notification: { data: { url: 'https://admin.hatly.dev/order-management?order=o-2' }, close: () => undefined } });
  assert.deepEqual(sw.opened, ['https://admin.hatly.dev/order-management?order=o-2']);

  const posted: any[] = [];
  const stuck = { url: 'https://admin.hatly.dev/home', focus: async () => undefined, navigate: async () => { throw new Error('not controlled'); }, postMessage: (m: any) => posted.push(m) };
  const sw2 = load({ clients: [stuck] });
  await sw2.fire('notificationclick', { notification: { data: { url: '/order-management?order=o-3' }, close: () => undefined } });
  assert.deepEqual(plain(posted), [{ type: 'hatly-open', url: 'https://admin.hatly.dev/order-management?order=o-3' }]);
});

test('a message can never send the operator to another site, and a non-https API is never called', async () => {
  const sw = load({ api: '?api=http%3A%2F%2Fevil.example%2Fapi' });
  await sw.fire('push', pushEvent({ ...message, url: 'https://evil.example/phish' }));
  assert.equal(sw.shown[0].options.data.url, 'https://admin.hatly.dev/inbox');
  assert.equal(sw.fetches.length, 0);
  await sw.fire('notificationclick', { notification: { data: { url: 'javascript:alert(1)' }, close: () => undefined } });
  assert.deepEqual(sw.opened, ['https://admin.hatly.dev/inbox']);
});
