'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '../../lib/ui/api';
import { useLang } from '../../lib/ui/lang';
import { OpsAlert } from '../../lib/api/ops-alerts';
import { OPS_ACTION, OPS_CATEGORY, OPS_RESOLUTION, age, driverOfflineDetail } from '../../lib/alerts/words';
import { AcceptForStore, useOpsAlarm } from './OpsAlarm';

/**
 * Top of the Notification Center: every open Operations alert (urgent first), with its state — waiting, seen by whom, or (in "Recent")
 * how it ended. Acknowledging stops the alarm for everyone but leaves the alert open until the problem itself is solved.
 */
export function OpsAlertsPanel() {
  const ctx = useOpsAlarm();
  const { t, locale } = useLang();
  const [view, setView] = useState<'open' | 'recent'>('open');
  const recent = useApi<OpsAlert[]>(view === 'recent' && ctx?.enabled ? '/admin/ops-alerts' : null, { state: 'recent' });
  const [busy, setBusy] = useState<string | null>(null);
  if (!ctx?.enabled) return null;
  const rows = view === 'open' ? ctx.alerts : recent.data ?? [];
  const now = Date.now();

  return (
    <section className="mb-6 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm" data-testid="ops-alerts-panel" aria-labelledby="ops-alerts-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="ops-alerts-title" className="text-base font-semibold text-gray-900">{t('Operations alerts', 'تنبيهات العمليات')}</h2>
        <div className="flex items-center gap-3 text-xs">
          <div role="tablist" className="inline-flex rounded-lg border border-gray-200 p-0.5">
            {(['open', 'recent'] as const).map((v) => (
              <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`rounded-md px-2.5 py-1 font-medium ${view === v ? 'bg-gray-900 text-white' : 'text-gray-700'}`}>
                {v === 'open' ? t('Open', 'مفتوحة') : t('Last 7 days', 'آخر 7 أيام')}
              </button>
            ))}
          </div>
          <Link href="/notification-setup" className="font-medium text-hatly-orangeDark underline">{t('Notification setup', 'إعداد الإشعارات')}</Link>
        </div>
      </div>
      {ctx.error && view === 'open' && <p role="alert" className="mb-2 text-xs text-amber-800">{t('Could not refresh alerts. Retrying…', 'تعذّر تحديث التنبيهات. جارٍ إعادة المحاولة…')}</p>}
      {rows.length === 0 ? (
        <p className="rounded-xl bg-green-50 px-4 py-3 text-sm text-green-800" data-testid="ops-alerts-empty">✓ {view === 'open' ? t('No open alerts.', 'لا توجد تنبيهات مفتوحة.') : t('No alerts in the last 7 days.', 'لا تنبيهات في آخر 7 أيام.')}</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {rows.map((a) => {
            const state = a.resolvedAt
              ? { tone: 'bg-gray-100 text-gray-700', text: `${t('Solved', 'حُلّ')}: ${t(...(OPS_RESOLUTION[a.resolution ?? ''] ?? ['—', '—']))}` }
              : a.acknowledgedAt
                ? { tone: 'bg-blue-50 text-blue-800', text: `${t('Seen by', 'اطّلع عليه')} ${a.acknowledgedBy?.name ?? '—'} · ${t('still open', 'ما زال مفتوحًا')}` }
                : { tone: a.priority === 'CRITICAL' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800', text: t('Waiting for someone', 'بانتظار من يتابع') };
            return (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5" data-testid={`ops-alert-row-${a.id}`}>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${a.priority === 'CRITICAL' ? 'bg-red-600 text-white' : 'bg-amber-500 text-white'}`}>{a.priority === 'CRITICAL' ? t('Urgent', 'عاجل') : t('Check', 'متابعة')}</span>
                <span className="min-w-0 flex-1 text-sm">
                  <strong>{t(...OPS_CATEGORY[a.category])}</strong>
                  {a.orderNumber && <> · <bdi className="font-mono">{a.orderNumber}</bdi></>}
                  <span className="text-gray-500"> · {age(a.openedAt, now, locale)} · {t(...OPS_ACTION[a.category])}</span>
                  {(a.category === 'DRIVER_LONG_SHIFT' || a.category === 'DRIVER_CASH_EXPOSURE') && <span className="block text-xs text-red-700">{a.detail}</span>}
                  {a.category === 'DRIVER_OFFLINE' && <span className="block text-xs text-red-700" data-testid="ops-alert-driver-offline">{driverOfflineDetail(a.detail, now, locale)}</span>}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${state.tone}`} data-testid="ops-alert-state">{state.text}</span>
                <Link href={a.href} className="text-xs font-semibold text-hatly-orangeDark underline">{a.orderId ? t('Open order', 'افتح الطلب') : t('Review driver', 'راجع المندوب')}</Link>
                {!a.resolvedAt && ctx.canAck && view === 'open' && (a.pendingParts ?? []).map((part) => <AcceptForStore key={part.segmentId} alert={a} part={part} />)}
                {!a.acknowledgedAt && !a.resolvedAt && ctx.canAck && (
                  <button type="button" disabled={busy === a.id} className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-800 disabled:opacity-50"
                    onClick={async () => { setBusy(a.id); try { await ctx.acknowledge(a.id); } finally { setBusy(null); } }}>
                    {t('Seen — stop alarm', 'تم الاطلاع — أوقف التنبيه')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
