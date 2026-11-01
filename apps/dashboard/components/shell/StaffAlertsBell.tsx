'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useChangeFeed } from '../../lib/changes/use-change-feed';
import type { ChangesPage } from '../../lib/changes/change-feed';
import { ACTION, CATEGORY, noteText } from '../../lib/notifications/wording';
import { AlertPreference, StaffAlert, listStaffAlerts, markAllStaffAlertsRead, markStaffAlertRead, setStaffAlertPreference, staffAlertPreferences, staffAlertUnreadCount } from '../../lib/api/staff-notifications';

type T = (en: string, ar: string) => string;

/**
 * The alerts bell of Operations and vendor staff. The number is a cheap unread count (refreshed every 30 s while the tab is visible and when
 * it comes back); the list is read when the menu opens. Critical alerts are marked and cannot be turned off in the inbox. Preferences are the
 * member of staff's own.
 */
export function StaffAlertsBell({ t, locale, hrefFor, navigate, changes, centerHref }: { t: T; locale: 'en' | 'ar'; hrefFor: (a: StaffAlert) => string | null; navigate?: (href: string) => void; changes?: (since?: string) => Promise<ChangesPage>; centerHref?: string }) {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<StaffAlert[] | null>(null);
  const [prefs, setPrefs] = useState<AlertPreference[] | null>(null);
  const [view, setView] = useState<'list' | 'settings'>('list');
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const L = (m: Record<string, [string, string]>, k: string) => (m[k] ? (locale === 'ar' ? m[k][1] : m[k][0]) : k);

  const refreshCount = useCallback(async () => {
    try {
      setUnread(await staffAlertUnreadCount());
    } catch {
      /* a failed count keeps the last number */
    }
  }, []);
  const loadList = useCallback(async () => {
    try {
      const r = await listStaffAlerts();
      setItems(r.items);
      setUnread(r.unreadCount);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void refreshCount();
    const timer = window.setInterval(() => document.visibilityState === 'visible' && void refreshCount(), 30_000);
    const onVisible = () => document.visibilityState === 'visible' && void refreshCount();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshCount]);

  // Live: the count follows the change feed the dashboards already use (every staff notification comes from an order/exception change);
  // the 30 s timer above stays as the safety net.
  useChangeFeed(changes ?? (async () => ({ items: [], cursor: null } as unknown as ChangesPage)), refreshCount, Boolean(changes));

  useEffect(() => {
    if (!open) return;
    void loadList();
    const onDown = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, loadList]);

  const toggleSettings = async () => {
    const next = view === 'list' ? 'settings' : 'list';
    setView(next);
    if (next === 'settings' && !prefs) {
      try {
        setPrefs(await staffAlertPreferences());
      } catch {
        setFailed(true);
      }
    }
  };
  const setPref = async (category: string, channel: 'IN_APP' | 'PUSH', enabled: boolean) => {
    try {
      setPrefs(await setStaffAlertPreference({ category, channel, enabled }));
    } catch {
      setFailed(true);
    }
  };
  /** Marks the alert read and returns when the server has it (or after a short wait), so a navigation that follows cannot cancel the request. */
  const read = async (a: StaffAlert) => {
    if (a.isRead) return;
    setItems((cur) => cur && cur.map((x) => (x.id === a.id ? { ...x, isRead: true } : x)));
    setUnread((n) => Math.max(0, n - 1));
    await Promise.race([markStaffAlertRead(a.id).catch(() => undefined), new Promise((resolve) => window.setTimeout(resolve, 1500))]);
  };
  const open_ = async (e: React.MouseEvent, a: StaffAlert, href: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return void read(a); // "open in a new tab" keeps this page; the request is not cancelled
    e.preventDefault();
    await read(a);
    setOpen(false);
    if (navigate) navigate(href);
    else window.location.assign(href);
  };
  const readAll = async () => {
    try {
      await markAllStaffAlertsRead();
      setItems((cur) => cur && cur.map((x) => ({ ...x, isRead: true })));
      setUnread(0);
    } catch {
      setFailed(true);
    }
  };

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        data-testid="staff-alerts-bell"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={unread > 0 ? t(`Alerts, ${unread} unread`, `التنبيهات، ${unread} غير مقروء`) : t('Alerts', 'التنبيهات')}
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-lg p-2 text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M18 8a6 6 0 10-12 0c0 7-3 8-3 8h18s-3-1-3-8M13.7 20a2 2 0 01-3.4 0" /></svg>
        {unread > 0 && (
          <span data-testid="staff-alerts-count" className="absolute -end-0.5 -top-0.5 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-4 text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label={t('Alerts', 'التنبيهات')} className="absolute end-0 z-50 mt-2 w-[min(24rem,calc(100vw-1.5rem))] rounded-xl border border-gray-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
            <strong className="text-sm">{view === 'list' ? t('Alerts', 'التنبيهات') : t('Alert settings', 'إعدادات التنبيهات')}</strong>
            <span className="flex items-center gap-3 text-xs">
              {view === 'list' && unread > 0 && <button className="text-hatly-orangeDark hover:underline" onClick={readAll}>{t('Mark all read', 'تعليم الكل كمقروء')}</button>}
              <button className="text-gray-600 hover:underline" onClick={toggleSettings}>{view === 'list' ? t('Settings', 'الإعدادات') : t('Back', 'رجوع')}</button>
            </span>
          </div>
          {failed && <p role="alert" className="px-3 py-2 text-xs text-amber-800">{t('Could not load. Your alerts are still stored; try again.', 'تعذّر التحميل. تنبيهاتك محفوظة؛ حاول مجددًا.')}</p>}
          {view === 'list' ? (
            <ul className="max-h-[26rem] divide-y divide-gray-100 overflow-y-auto">
              {items === null && !failed && <li className="px-3 py-4 text-sm text-gray-500">{t('Loading…', 'جارٍ التحميل…')}</li>}
              {items?.length === 0 && <li className="px-3 py-4 text-sm text-gray-500">{t('No alerts.', 'لا توجد تنبيهات.')}</li>}
              {items?.map((a) => {
                const href = hrefFor(a);
                const body = (
                  <>
                    <span className="flex items-center gap-2">
                      {!a.isRead && <span className="h-2 w-2 shrink-0 rounded-full bg-hatly-orange" aria-label={t('unread', 'غير مقروء')} />}
                      <span className="text-sm font-medium text-gray-900">{L(CATEGORY, a.category)}</span>
                      {a.severity === 'CRITICAL' && <span className="rounded-full bg-red-50 px-1.5 text-[10px] font-medium text-red-800 ring-1 ring-inset ring-red-200">{t('Critical', 'حرِج')}</span>}
                    </span>
                    <span className="mt-0.5 block text-xs text-gray-600">{a.orderNumber && <bdi>{a.orderNumber}</bdi>}{a.requiredAction && <> · {L(ACTION, a.requiredAction)}</>}</span>
                    {a.note && <span className="mt-0.5 block text-xs text-gray-700"><bdi>{noteText(a, locale)}</bdi></span>}
                    <span className="mt-0.5 block text-[11px] text-gray-400">{new Date(a.createdAt).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')}</span>
                  </>
                );
                return (
                  <li key={a.id} className={a.isRead ? '' : 'bg-orange-50/40'}>
                    {href ? (
                      <a href={href} onClick={(e) => void open_(e, a, href)} className="block px-3 py-2 hover:bg-gray-50">{body}</a>
                    ) : (
                      <button type="button" onClick={() => void read(a)} className="block w-full px-3 py-2 text-start hover:bg-gray-50">{body}</button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <ul className="max-h-[26rem] divide-y divide-gray-100 overflow-y-auto px-3">
              {prefs === null && !failed && <li className="py-3 text-sm text-gray-500">{t('Loading…', 'جارٍ التحميل…')}</li>}
              {prefs?.map((p) => (
                <li key={p.category} className="py-2">
                  <p className="text-sm font-medium text-gray-900">{L(CATEGORY, p.category)}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-4 text-xs text-gray-700">
                    <label className="flex items-center gap-1.5">
                      <input type="checkbox" checked={p.inApp.enabled} disabled={p.inApp.locked} onChange={(e) => setPref(p.category, 'IN_APP', e.target.checked)} />
                      {t('In the app', 'داخل التطبيق')}{p.inApp.locked && <span className="text-gray-500"> ({t('always on', 'دائمًا')})</span>}
                    </label>
                    {p.push.available && (
                      <label className="flex items-center gap-1.5">
                        <input type="checkbox" checked={p.push.enabled} onChange={(e) => setPref(p.category, 'PUSH', e.target.checked)} />
                        {t('Push to my device', 'إشعار على جهازي')}
                      </label>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {centerHref && view === 'list' && (
            <div className="border-t border-gray-100 px-3 py-2 text-center">
              <Link href={centerHref} onClick={() => setOpen(false)} className="text-xs font-medium text-hatly-orangeDark hover:underline" data-testid="staff-alerts-view-all">{t('View all notifications', 'عرض كل الإشعارات')}</Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
