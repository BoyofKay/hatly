# P0 — Admin real-time alerts & Web Push (2026-11-08)

Scope: Admin/Operations notifications only (audit `OPERATIONS_AUDIT_2026-11-08.md` §3, §5). No change to orders, payments, COD/transfer
rules, settlements, commissions, ledger, Driver or Customer apps, or any Decision Register rule.

## 1. Root causes addressed
| Audit cause | Fix |
|---|---|
| No Operations "new order" event existed | `OPS_NEW_ORDER` + `ops_alerts` row raised **in the order's own transaction** (and, R2, when an InstaPay transfer is verified), with a scan as safety net |
| Store-not-accepting, late preparation, driver not acknowledging produced counts only | The 30 s scan raises `ACCEPTANCE_OVERDUE`, `PREPARATION_LATE`, and mirrors the existing dispatch alerts (`DRIVER_ACK_OVERDUE`, `NO_DRIVER`, `DRIVER_NOT_RESPONDING`, `ASSIGNMENT_ERROR`) and unresolved `FAILED_DELIVERY` |
| Admin dashboard had no sound / notification / service worker | Alarm bar + sound + vibration + tab title in the Admin shell; `public/sw.js`; installable manifest |
| No push path to staff browsers | Standard Web Push (VAPID, `web-push` 3.6.7, MPL-2.0, self-hosted, no paid service, no Firebase) |

Not in scope and **not fixed**: Driver/Customer FCM push (still unconfigured in production), vendor alerts.

## 2. Thresholds (none new)
- Store acceptance: `PENDING_ACCEPTANCE_ALERT_MINUTES = 5` — the Control Tower's existing value (a unit test keeps the two equal).
- Preparation: the segment's own `expected_ready_at`.
- Driver acknowledgement / needs a driver: the dispatch alerts `AutomaticDispatchService` already raises (R15/R16, configured window).
- Failed delivery: `FAILED_DELIVERY` with no resolution (Control Tower definition).
- R2 respected: an unpaid InstaPay/Vodafone Cash order is not "new" for Operations until its transfer is verified.

Notification behaviour (not business rules; env-overridable): scan every 30 s (`OPS_ALERT_SCAN_INTERVAL_MS`); unacknowledged critical push
repeated every 3 min (`OPS_ALERT_REPEAT_MINUTES`) at most 5 times (`OPS_ALERT_MAX_PUSH_ROUNDS`); in-tab alarm every 30 s, slowed to every 2 min
after 10 min; sound snooze 10 min (sound only — the bar stays).

## 3. Lifecycle
`raised` (unique `alert_key`) → `queued` per device (`admin_push_deliveries`) → `ACCEPTED` (push service took it — **not** "delivered") →
`displayed_at` / `clicked_at` (reported by the device's service worker with a one-time token from inside the encrypted message; stored hashed)
→ `acknowledged` (a person pressed "Seen — stop alarm"; stops repeats and the alarm in every tab and device; first acknowledger kept) →
`resolved` automatically when the condition is gone (store responded, order ended, dispatch alert closed, driver acknowledged, failed delivery
handled). Acknowledging never resolves. Failures: `FAILED` (retry 15 s → 10 min back-off), `EXPIRED` (404/410: device revoked, never used again),
`DEAD` (refused or attempts exhausted), `SKIPPED` (alert already acknowledged/resolved, or device removed). Nothing here changes an order,
payment or assignment.

Priorities: CRITICAL — new order awaiting the store, store overdue, driver not acknowledged, needs a driver, driver not responding,
assignment error, failed delivery (alarm repeats, sticky notification, vibration). HIGH — late preparation, new order already auto-accepted
(one chime, normal notification).

## 4. Security
- Alerts: `VIEW_ORDERS` to read; `MANAGE_ORDER_FULFILMENT` to acknowledge (Super Admin implicit); every non-admin role refused (global guard).
- Devices: owned by one admin; another admin's device id answers 404; re-registering a browser under another account moves it; sign-out
  unregisters the browser. Endpoints accepted only for known browser push services (`fcm.googleapis.com`, Mozilla, `*.notify.windows.com`,
  `*.push.apple.com`; https, no port) — the API cannot be made to call arbitrary URLs. The endpoint is never echoed back.
- Receipts (`POST /push-receipts`): public by necessity (a service worker has no session), throttled, proof = one-time 192-bit token per
  message, timing-safe comparison; wrong/unknown → 404; can only stamp that one delivery.
- Push payload: order number and category only — no customer name, phone or address.
- The VAPID private key lives only in the server env file; never logged, returned or sent to the browser.

## 5. Files
Backend: `database/migrations/1700007800000-OpsAlertsWebPush.ts` (3 new tables, additive, cascades with the order),
`modules/notifications/ops-alerts.service.ts`, `ops-alerts.controllers.ts`, `web-push/admin-push.service.ts`, `web-push/web-push-sender.ts`,
`staff-alerts.service.ts` (4 inbox categories), `notifications.module.ts`, `orders/order-creation.service.ts` and
`payments/payment-state-machine.service.ts` (one optional call each), `config/env.validation.ts` (WEB_PUSH checks), `package.json`.
Dashboard: `public/sw.js`, `public/manifest.webmanifest`, `public/icons/*`, `components/alerts/OpsAlarm.tsx`, `OpsAlertsPanel.tsx`,
`app/(admin)/notification-setup/page.tsx`, `lib/alerts/*`, `lib/api/ops-alerts.ts`, `AdminShell.tsx`, `nav.ts`, `inbox/page.tsx`,
`notifications/wording.ts`, `app/layout.tsx`, `next.config.js`. Deploy: `deploy/production/setup-web-push-keys.sh`.

## 6. Configuration required
Production has no `WEB_PUSH_*` settings. Without them the in-app alarm works but nothing reaches a background/closed dashboard, and the
setup page says "Push set up on the server: No". One-time, on the server:
```
bash /opt/hatly-prod/current/deploy/production/setup-web-push-keys.sh <mailto:you@domain | https://your-site>
deploy/production/prod.sh up -d --no-deps backend
```
The script generates the key pair locally with openssl, appends the three settings to `/opt/hatly-prod/.env.production` (mode 600, backup
first), prints only the public key, and refuses to overwrite existing keys (rotating would orphan every registered device).

## 7. Platform limitations (to be confirmed by the device checklist)
- Sound plays only in an open Hatly tab after one tap/click on it (browser autoplay rule; after every reload). Background/closed-tab alerts use
  the OS notification sound, not the Hatly alarm, and a web page cannot loop audio in the background — repeats come from the server (every 3 min).
- Android: Chrome notifications must be allowed (site + Android app settings); battery "Unrestricted" recommended — otherwise Doze can
  delay pushes while the screen is off; a force-stopped Chrome receives nothing until reopened. Installing as an app is optional.
- Desktop: pushes arrive while the browser process runs (minimised, tab closed); not when the browser is fully quit. OS Focus/Do-not-disturb
  suppresses them.
- iPhone: only as a Home-Screen web app (iOS 16.4+). Not part of the acceptance scope.
- A push service may hold a message up to 1 h for an offline device; the in-app list recovers everything on reconnect.
- Headless Chromium (CI) has no push service: browser push itself is verified only on real devices.

## 8. Real-device acceptance checklist (owner)
Record for each: device model · OS version · browser version · installed as app (y/n) · permission · battery mode · result · notes.

Preparation (each device): open https://admin.hatly.dev → Orders → **Notification setup** → **Enable notifications** (Allow) → **Enable sound**
→ **Test sound** (you hear it) → **Send test notification** (stages 1–3 turn green within seconds). Place test orders from the Customer app
(closed testing) and cancel them afterwards.

**Android Chrome**
1. Dashboard open, in front → new order: red bar with the HT number within ~10 s, alarm sound, vibration, system notification.
2. Press Home (Chrome in background) → new order: notification within ~30 s with the HT number.
3. Another app open → same as 2.
4. Screen locked → notification on the lock screen / screen wakes per OS settings.
5. Close the Hatly tab (Chrome still running) → new order: notification arrives; tapping it opens `/order-management?order=…` on that order.
6. Leave a new order unacknowledged → a repeat notification (⚠) after ~3 min, at most 5; in an open tab the alarm repeats every 30 s.
7. Press **Seen — stop alarm** on one device → the alarm stops in every tab and no more repeats arrive on any device; the alert stays in
   Notifications as "Seen by …, still open" until the store accepts.
8. Two Admin devices → each gets exactly one notification per round; the alert exists once in Notifications.
9. Airplane mode 2 min, place an order, reconnect → the bar shows it within ~10 s of reconnecting; the push arrives when the push service redelivers.
10. Block notifications for the site → Notification setup shows "Blocked" with instructions; the in-tab alarm still works.

**Desktop (Chrome/Edge on Windows or macOS)**
1. Tab in front → bar + alarm + notification.  2. Another tab/window in front → notification + alarm (the Hatly tab still plays sound).
3. Browser minimised → notification.  4. Hatly tab closed, browser open → notification; click opens the order.  5. Wi-Fi off/on → recovered, no duplicates.
6. Notifications blocked → setup page explains; Focus/Do-not-disturb → notifications suppressed by the OS (expected).

Pass = every step as described; any deviation is recorded with the device details above.
