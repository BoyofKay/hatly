'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Card, EmptyState, KpiCard, PageHeader, Pagination, Tabs } from '../ui';
import { ICONS } from '../ui/icons';
import { useLang } from '../../lib/ui/lang';
import { ago } from '../../lib/ui/time';
import { apiErrorMessage } from '../../lib/api/errors';
import { useChangeFeed } from '../../lib/changes/use-change-feed';
import type { ChangesPage } from '../../lib/changes/change-feed';
import { AlertPreference, StaffAlert, listStaffAlertsPage, markAllStaffAlertsRead, markStaffAlertRead, setStaffAlertPreference, staffAlertPreferences } from '../../lib/api/staff-notifications';
import { ACTION, CATEGORY, noteText, words } from '../../lib/notifications/wording';

const LIMIT = 20;

/**
 * The Notification Center of Admin and Vendor staff — the full view of the same inbox the bell shows (the server scopes every row to the
 * signed-in person; a vendor only ever receives rows of their own branches). Unread count, all/unread lists with paging, read state, mark one or
 * all as read, a click opens the related record when this person may open it, per-category preferences (critical alerts cannot be muted in the
 * inbox). Live: the list refreshes when the change feed reports a change (the dashboards' existing live channel), with its own timed fallback.
 * Push reaches a device only when a push provider is configured and the person registered a device; SMS, WhatsApp and e-mail are not channels here.
 */
export function NotificationCenter({ hrefFor, changes }: { hrefFor: (a: StaffAlert) => string | null; changes: (since?: string) => Promise<ChangesPage> }) {
  const { t, locale } = useLang();
  const router = useRouter();
  const [tab, setTab] = useState<'all' | 'unread' | 'settings'>('all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: StaffAlert[]; total: number; unreadCount: number } | null>(null);
  const [prefs, setPrefs] = useState<AlertPreference[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await listStaffAlertsPage({ page, limit: LIMIT, unread: tab === 'unread' }));
      setError(null);
    } catch (e) {
      setError(apiErrorMessage(e, t('Could not load the notifications.', 'تعذّر تحميل الإشعارات.')));
    }
  }, [page, tab, t]);
  useEffect(() => { void load(); }, [load]);
  useChangeFeed(changes, load);
  useEffect(() => {
    if (tab !== 'settings' || prefs) return;
    staffAlertPreferences().then(setPrefs).catch((e) => setError(apiErrorMessage(e, t('Could not load the settings.', 'تعذّر تحميل الإعدادات.'))));
  }, [tab, prefs, t]);

  const open = async (a: StaffAlert) => {
    if (!a.isRead) {
      setData((d) => d && { ...d, unreadCount: Math.max(0, d.unreadCount - 1), items: d.items.map((x) => (x.id === a.id ? { ...x, isRead: true } : x)) });
      await markStaffAlertRead(a.id).catch(() => undefined);
    }
    const href = hrefFor(a);
    if (href) router.push(href);
  };
  const markRead = async (a: StaffAlert) => {
    setData((d) => d && { ...d, unreadCount: Math.max(0, d.unreadCount - 1), items: d.items.map((x) => (x.id === a.id ? { ...x, isRead: true } : x)) });
    try { await markStaffAlertRead(a.id); } catch (e) { setError(apiErrorMessage(e, t('Could not mark it as read.', 'تعذّر تعليمه كمقروء.'))); void load(); }
  };
  const readAll = async () => {
    setBusy(true);
    try { await markAllStaffAlertsRead(); await load(); } catch (e) { setError(apiErrorMessage(e, t('Could not mark all as read.', 'تعذّر تعليم الكل كمقروء.'))); } finally { setBusy(false); }
  };
  const setPref = async (category: string, channel: 'IN_APP' | 'PUSH', enabled: boolean) => {
    try { setPrefs(await setStaffAlertPreference({ category, channel, enabled })); } catch (e) { setError(apiErrorMessage(e, t('The setting was not saved.', 'لم يُحفظ الإعداد.'))); }
  };

  const unread = data?.unreadCount ?? 0;
  return (
    <div className="space-y-5" data-testid="notification-center">
      <PageHeader
        title={t('Notifications', 'الإشعارات')}
        subtitle={t('What needs you, newest first. Opening a notification takes you to its order or case and marks it read.', 'ما يحتاج إليك، الأحدث أولًا. فتح الإشعار ينقلك إلى طلبه أو حالته ويعلّمه كمقروء.')}
        actions={tab !== 'settings' ? <Button onClick={readAll} disabled={unread === 0} loading={busy} data-testid="notifications-read-all">{t('Mark all as read', 'تعليم الكل كمقروء')}</Button> : undefined}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label={t('Unread', 'غير مقروءة')} value={data ? String(unread) : '—'} icon={ICONS.bell} tone={unread > 0 ? 'bad' : 'neutral'} testId="notifications-unread" />
        <KpiCard label={tab === 'unread' ? t('Unread shown', 'غير المقروءة المعروضة') : t('All notifications', 'كل الإشعارات')} value={data ? String(data.total) : '—'} icon={ICONS.list} />
      </div>
      <Tabs tabs={[{ id: 'all', label: t('All', 'الكل') }, { id: 'unread', label: t(`Unread (${unread})`, `غير المقروءة (${unread})`) }, { id: 'settings', label: t('Settings', 'الإعدادات') }]} value={tab} onChange={(id) => { setTab(id as typeof tab); setPage(1); }} />
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {tab === 'settings' ? (
        <Card title={t('What reaches you', 'ما يصلك')}>
          <p className="mb-3 text-xs text-gray-500">{t('Critical alerts always stay in your inbox. Push reaches your device only when push delivery is configured and your device is registered.', 'التنبيهات الحرجة تبقى دائمًا في صندوقك. يصل الإشعار إلى جهازك فقط عند تفعيل الإشعارات الفورية وتسجيل جهازك.')}</p>
          <ul className="divide-y divide-gray-100" data-testid="notification-settings">
            {prefs === null && <li className="py-3 text-sm text-gray-500">{t('Loading…', 'جارٍ التحميل…')}</li>}
            {prefs?.map((p) => (
              <li key={p.category} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span className="flex items-center gap-2 text-sm font-medium text-gray-900">{words(CATEGORY, p.category, locale)}{p.severity === 'CRITICAL' && <Badge tone="red">{t('Critical', 'حرِج')}</Badge>}</span>
                <span className="flex flex-wrap items-center gap-4 text-sm text-gray-700">
                  <label className="flex min-h-[40px] items-center gap-2">
                    <input type="checkbox" className="h-4 w-4 accent-hatly-orange" checked={p.inApp.enabled} disabled={p.inApp.locked} onChange={(e) => setPref(p.category, 'IN_APP', e.target.checked)} data-testid={`pref-${p.category}-inapp`} />
                    {t('In the dashboard', 'في لوحة التحكم')}{p.inApp.locked && <span className="text-xs text-gray-500">({t('always on', 'دائمًا')})</span>}
                  </label>
                  {p.push.available && (
                    <label className="flex min-h-[40px] items-center gap-2">
                      <input type="checkbox" className="h-4 w-4 accent-hatly-orange" checked={p.push.enabled} onChange={(e) => setPref(p.category, 'PUSH', e.target.checked)} />
                      {t('Push to my device', 'إشعار على جهازي')}
                    </label>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Card pad={false}>
          {data && data.items.length === 0 && <EmptyState title={tab === 'unread' ? t('You are all caught up.', 'لا يوجد ما لم تقرأه.') : t('No notifications yet.', 'لا توجد إشعارات بعد.')} />}
          {!data && !error && <p className="p-5 text-sm text-gray-500">{t('Loading…', 'جارٍ التحميل…')}</p>}
          <ul className="divide-y divide-gray-100" data-testid="notification-list">
            {(data?.items ?? []).map((a) => {
              const href = hrefFor(a);
              const note = noteText(a, locale);
              return (
                <li key={a.id} data-testid={`notification-${a.id}`} data-read={a.isRead ? 'true' : 'false'} className={`flex items-start gap-3 px-5 py-4 ${a.isRead ? '' : 'bg-orange-50/50'}`}>
                  <span aria-hidden className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${a.isRead ? 'bg-transparent' : 'bg-hatly-orange'}`} />
                  <button type="button" onClick={() => void open(a)} disabled={!href && a.isRead} className="min-w-0 flex-1 text-start disabled:cursor-default">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={`text-sm ${a.isRead ? 'font-medium text-gray-700' : 'font-semibold text-gray-900'}`}>{words(CATEGORY, a.category, locale) || a.title}</span>
                      {a.severity === 'CRITICAL' && <Badge tone="red">{t('Critical', 'حرِج')}</Badge>}
                      {!a.isRead && <span className="sr-only">{t('unread', 'غير مقروء')}</span>}
                    </span>
                    <span className="mt-1 block text-xs text-gray-600">
                      {a.orderNumber && <bdi className="font-mono font-semibold text-gray-800">{a.orderNumber}</bdi>}
                      {a.requiredAction && <> · {words(ACTION, a.requiredAction, locale)}</>}
                    </span>
                    {note && <span className="mt-0.5 block text-xs text-gray-700"><bdi>{note}</bdi></span>}
                    <span className="mt-1 block text-xs text-gray-400">{ago(a.createdAt, locale)}</span>
                  </button>
                  {!a.isRead && (
                    <button type="button" onClick={() => void markRead(a)} className="shrink-0 rounded-lg px-2 py-1.5 text-xs font-medium text-hatly-orangeDark hover:bg-orange-50" data-testid={`notification-read-${a.id}`}>
                      {t('Mark read', 'تعليم كمقروء')}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {data && data.total > LIMIT && <Pagination page={page} limit={LIMIT} total={data.total} onPage={setPage} />}
        </Card>
      )}
    </div>
  );
}
