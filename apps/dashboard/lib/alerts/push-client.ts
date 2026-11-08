'use client';

import { API_BASE_URL } from '../api/client';
import { lookupPushDevice, pushConfig, registerPushDevice, removePushDevice, PushDevice } from '../api/ops-alerts';

/** What this browser can do, checked — never assumed. */
export interface DeviceSupport {
  secureContext: boolean;
  serviceWorker: boolean;
  push: boolean;
  notifications: boolean;
  vibrate: boolean;
  standalone: boolean;
  ios: boolean;
}

export function deviceSupport(): DeviceSupport {
  if (typeof window === 'undefined') return { secureContext: false, serviceWorker: false, push: false, notifications: false, vibrate: false, standalone: false, ios: false };
  const ua = navigator.userAgent;
  return {
    secureContext: window.isSecureContext,
    serviceWorker: 'serviceWorker' in navigator,
    push: 'PushManager' in window,
    notifications: 'Notification' in window,
    vibrate: typeof navigator.vibrate === 'function',
    standalone: window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true,
    ios: /iPhone|iPad|iPod/.test(ua),
  };
}

export const permissionState = (): NotificationPermission | 'unsupported' => (typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported');

const SW_URL = `/sw.js?api=${encodeURIComponent(API_BASE_URL)}`;

/** Registers (or returns) the Admin service worker. Safe to call repeatedly. */
export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !window.isSecureContext) return null;
  try {
    const reg = await navigator.serviceWorker.register(SW_URL, { scope: '/' });
    await navigator.serviceWorker.ready;
    return reg;
  } catch {
    return null;
  }
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function deviceLabel(): string {
  if (typeof navigator === 'undefined') return 'Browser';
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const br = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${br} on ${os}`;
}

/** The current browser's push subscription as the server knows it (null = this device is not registered for the signed-in admin). */
export async function currentDevice(): Promise<{ subscription: PushSubscription | null; device: PushDevice | null }> {
  const reg = await ensureServiceWorker();
  const subscription = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
  const device = subscription ? await lookupPushDevice(subscription.endpoint).catch(() => null) : null;
  return { subscription, device };
}

export type EnableResult = { ok: true; device: PushDevice } | { ok: false; reason: 'unsupported' | 'insecure' | 'denied' | 'dismissed' | 'not-configured' | 'failed'; message?: string };

/** Call from a click: asks permission, subscribes this browser and registers it for the signed-in admin. */
export async function enablePush(): Promise<EnableResult> {
  const s = deviceSupport();
  if (!s.secureContext) return { ok: false, reason: 'insecure' };
  if (!s.serviceWorker || !s.push || !s.notifications) return { ok: false, reason: 'unsupported' };
  const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  if (permission === 'denied') return { ok: false, reason: 'denied' };
  if (permission !== 'granted') return { ok: false, reason: 'dismissed' };
  const cfg = await pushConfig().catch(() => null);
  if (!cfg?.configured || !cfg.publicKey) return { ok: false, reason: 'not-configured' };
  const reg = await ensureServiceWorker();
  if (!reg) return { ok: false, reason: 'failed', message: 'The service worker could not start.' };
  try {
    let sub = await reg.pushManager.getSubscription();
    const key = urlBase64ToUint8Array(cfg.publicKey);
    // A subscription made with another server key cannot receive our messages: replace it.
    const current = sub?.options?.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey as ArrayBuffer) : null;
    if (sub && current && (current.length !== key.length || current.some((b, i) => b !== key[i]))) {
      await sub.unsubscribe();
      sub = null;
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource });
    const device = await registerPushDevice(sub.toJSON(), deviceLabel());
    return { ok: true, device };
  } catch (error) {
    return { ok: false, reason: 'failed', message: (error as Error)?.message };
  }
}

/** Shows a notification from the page itself (used only when this device has no push registration, so the two never double up). */
export async function showLocalNotification(title: string, options: NotificationOptions & { data?: { url: string } }): Promise<boolean> {
  if (permissionState() !== 'granted') return false;
  const reg = await ensureServiceWorker();
  try {
    if (reg) await reg.showNotification(title, options);
    else new Notification(title, options);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sign-out: unregister this browser for the signed-in admin and drop its push subscription, so a shared device stops receiving that
 * admin's alerts. Best effort and bounded (never blocks signing out for more than ~2 s).
 */
export async function forgetThisDevice(): Promise<void> {
  const work = (async () => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration('/').catch(() => undefined);
    const sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
    if (!sub) return;
    const device = await lookupPushDevice(sub.endpoint).catch(() => null);
    if (device) await removePushDevice(device.id).catch(() => undefined);
    await sub.unsubscribe().catch(() => undefined);
  })();
  await Promise.race([work, new Promise((resolve) => setTimeout(resolve, 2000))]);
}
