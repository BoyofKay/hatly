/* Hatly Admin service worker — operational notifications ONLY.
 *
 * It caches nothing and intercepts no request (no `fetch` handler), so it can never serve a stale dashboard. It:
 *  - shows each Web Push message from the Hatly API as a system notification (same `tag` per alert, so a repeat replaces instead of stacking;
 *    critical alerts stay until dismissed and vibrate where the device allows),
 *  - reports "displayed" / "clicked" back to the API with the one-time token carried inside that message (no session is used or needed),
 *  - opens the exact order on click (focusing an open Hatly tab when there is one), and
 *  - tells open Hatly tabs that an alert arrived so they refresh their alert list at once.
 * The API origin comes from the registration URL (`/sw.js?api=…`); only https (or localhost for development) is accepted.
 */
'use strict';

const API = (() => {
  try {
    const raw = new URL(self.location.href).searchParams.get('api');
    if (!raw) return null;
    const u = new URL(raw);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    return u.protocol === 'https:' || local ? u.href.replace(/\/+$/, '') : null;
  } catch (e) {
    return null;
  }
})();

/** Only ever opens a page of this same origin (a message can never send the operator elsewhere). */
function safeUrl(path) {
  try {
    const u = new URL(path || '/inbox', self.location.origin);
    return u.origin === self.location.origin ? u.href : self.location.origin + '/inbox';
  } catch (e) {
    return self.location.origin + '/inbox';
  }
}

function receipt(data, event) {
  if (!API || !data || typeof data.deliveryId !== 'string' || typeof data.receiptToken !== 'string') return Promise.resolve();
  return fetch(API + '/push-receipts', {
    method: 'POST',
    credentials: 'omit',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deliveryId: data.deliveryId, token: data.receiptToken, event: event }),
    keepalive: true,
  }).then(
    () => undefined,
    () => undefined,
  );
}

async function windows() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true });
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = null;
  try {
    data = event.data ? event.data.json() : null;
  } catch (e) {
    data = null;
  }
  if (!data || data.v !== 1) {
    // Browsers require every push to show something; an unreadable one still points the operator to the inbox.
    event.waitUntil(self.registration.showNotification('Hatly Admin', { body: 'Open Hatly Admin to check your alerts.', tag: 'hatly-generic', data: { url: safeUrl('/inbox') } }));
    return;
  }
  const critical = data.priority === 'CRITICAL';
  const options = {
    body: String(data.body || ''),
    tag: String(data.tag || 'hatly-' + (data.deliveryId || 'alert')),
    renotify: Boolean(data.renotify),
    requireInteraction: critical,
    vibrate: critical ? [400, 200, 400, 200, 400] : [200],
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    dir: 'auto',
    timestamp: Date.now(),
    data: { url: safeUrl(data.url), deliveryId: data.deliveryId, receiptToken: data.receiptToken, alertId: data.alertId || null },
  };
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(String(data.title || 'Hatly Admin'), options);
      await receipt(data, 'displayed');
      for (const c of await windows()) c.postMessage({ type: 'hatly-push', alertId: data.alertId || null, priority: data.priority || null });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  const d = (event.notification && event.notification.data) || {};
  event.notification.close();
  const url = safeUrl(d.url);
  event.waitUntil(
    (async () => {
      await receipt(d, 'clicked');
      const open = (await windows()).filter((c) => {
        try {
          return new URL(c.url).origin === self.location.origin;
        } catch (e) {
          return false;
        }
      });
      if (open.length > 0) {
        const tab = open.find((c) => c.focused) || open[0];
        try {
          await tab.focus();
        } catch (e) {
          /* focus can be refused; navigation below still happens */
        }
        try {
          if (typeof tab.navigate === 'function') {
            await tab.navigate(url);
            return;
          }
        } catch (e) {
          /* an uncontrolled tab cannot be navigated by the worker: ask the page to do it */
        }
        tab.postMessage({ type: 'hatly-open', url: url });
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});

// Lets tests (and the diagnostics page) confirm which worker version is active.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'hatly-sw-version' && event.ports && event.ports[0]) event.ports[0].postMessage({ version: 1, api: Boolean(API) });
});
