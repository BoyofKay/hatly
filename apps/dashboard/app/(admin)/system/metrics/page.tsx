'use client';

import { useState } from 'react';
import { Async, Card, DataTable, KpiCard, LabeledSelect, PageHeader, Tabs } from '../../../../components/ui';
import { useApi } from '../../../../lib/ui/api';
import { useLang } from '../../../../lib/ui/lang';

export default function MetricsPage() {
  const { t, num } = useLang();
  const [tab, setTab] = useState('api');
  const [hours, setHours] = useState('24');
  const req = useApi<any>(tab === 'api' ? '/admin/system/metrics/requests' : null, { hours });
  const db = useApi<any>(tab === 'db' ? '/admin/system/metrics/database-cache' : null);
  const cl = useApi<any>(tab === 'client' ? '/admin/system/metrics/client' : null);
  const bytes = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(1)} MB`);
  return (
    <div>
      <PageHeader title={t('Metrics', 'المقاييس')} subtitle={t('Measured on this server since this version started recording. Percentiles are bucket upper bounds, not exact values. Nothing here is estimated.', 'مقاسة على هذا الخادم منذ بدء هذا الإصدار بالتسجيل. النسب المئوية هي الحدود العليا للشرائح وليست قيمًا دقيقة. لا شيء هنا مقدَّر.')} />
      <Tabs tabs={[{ id: 'api', label: t('API requests', 'طلبات الواجهة') }, { id: 'db', label: t('Database & cache', 'قاعدة البيانات والذاكرة') }, { id: 'client', label: t('Apps (client)', 'التطبيقات') }]} value={tab} onChange={setTab} />
      {tab === 'api' && (
        <>
          <div className="mb-3 w-44"><LabeledSelect label={t('Window', 'المدة')} value={hours} onChange={(e) => setHours(e.target.value)}><option value="1">1 h</option><option value="6">6 h</option><option value="24">24 h</option><option value="168">7 d</option></LabeledSelect></div>
          <Async state={req} rows={3}>
            {req.data && (
              <>
                <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-3"><KpiCard label={t('Requests', 'الطلبات')} value={num(req.data.totalRequests)} /><KpiCard label={t('Server errors (5xx)', 'أخطاء الخادم (5xx)')} value={num(req.data.serverErrors)} tone={req.data.serverErrors ? 'bad' : 'neutral'} /><KpiCard label={t('Error rate', 'نسبة الأخطاء')} value={req.data.errorRatePct === null ? t('No data', 'لا بيانات') : `${req.data.errorRatePct}%`} /></div>
                <Card pad={false}>
                  <DataTable rows={req.data.items} rowKey={(r: any) => r.route} emptyTitle={t('No requests recorded in this window', 'لا طلبات مسجلة في هذه المدة')} columns={[
                    { key: 'r', header: t('Route', 'المسار'), cell: (r: any) => <code className="text-xs" dir="ltr">{r.route}</code> },
                    { key: 'c', header: t('Count', 'العدد'), align: 'end', cell: (r: any) => num(r.count) },
                    { key: 'a', header: t('Avg ms', 'المتوسط'), align: 'end', cell: (r: any) => r.avgMs ?? '—' },
                    { key: 'p5', header: 'P50 ≤', align: 'end', cell: (r: any) => r.p50Ms ?? '—' },
                    { key: 'p9', header: 'P95 ≤', align: 'end', cell: (r: any) => r.p95Ms ?? '>3200' },
                    { key: 'm', header: t('Max ms', 'الأقصى'), align: 'end', cell: (r: any) => r.maxMs },
                    { key: 'e', header: '5xx', align: 'end', cell: (r: any) => (r.serverErrors ? <span className="text-red-700">{r.serverErrors}</span> : '0') },
                  ]} />
                </Card>
                <p className="mt-2 text-xs text-gray-500">{req.data.note}</p>
              </>
            )}
          </Async>
        </>
      )}
      {tab === 'db' && (
        <Async state={db} rows={3}>
          {db.data && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card title={t('Database', 'قاعدة البيانات')}>
                <dl className="grid grid-cols-2 gap-1 text-sm"><dt className="text-gray-500">{t('Size', 'الحجم')}</dt><dd className="text-end tabular-nums">{bytes(db.data.database.sizeBytes)}</dd><dt className="text-gray-500">{t('Connections', 'الاتصالات')}</dt><dd className="text-end tabular-nums">{db.data.database.connections}</dd>{db.data.database.pool && <><dt className="text-gray-500">{t('Pool (total / idle / waiting)', 'المجمّع (الكل / الخامل / المنتظر)')}</dt><dd className="text-end tabular-nums">{db.data.database.pool.total} / {db.data.database.pool.idle} / {db.data.database.pool.waiting}</dd></>}</dl>
                <h4 className="mb-1 mt-3 text-xs font-semibold uppercase text-gray-500">{t('Largest tables (approx. rows)', 'أكبر الجداول (صفوف تقريبية)')}</h4>
                <ul className="text-sm">{db.data.database.largestTables.map((x: any) => <li key={x.name} className="flex justify-between border-t border-gray-100 py-1"><code className="text-xs">{x.name}</code><span className="tabular-nums">{num(x.rows)}</span></li>)}</ul>
              </Card>
              <Card title="Redis">{db.data.redis ? <p className="text-sm">{t('Connection status', 'حالة الاتصال')}: <strong>{db.data.redis.status}</strong></p> : <p className="text-sm text-gray-500">{t('Not configured — caches and rate limits use the server process.', 'غير مُعدّ — تستخدم الذاكرة المؤقتة وحدود المعدل عملية الخادم.')}</p>}</Card>
            </div>
          )}
        </Async>
      )}
      {tab === 'client' && (
        <Async state={cl} empty={cl.data && cl.data.items.length === 0} emptyTitle={t('No app measurements yet', 'لا قياسات من التطبيقات بعد')} rows={3}>
          {cl.data && (
            <>
              <Card pad={false}>
                <DataTable rows={cl.data.items} rowKey={(r: any) => `${r.metric}|${r.app}|${r.platform}|${r.deviceClass}|${r.network}|${r.appVersion}`} emptyTitle="" columns={[
                  { key: 'm', header: t('Metric', 'المقياس'), cell: (r: any) => r.metric },
                  { key: 'a', header: t('App', 'التطبيق'), cell: (r: any) => `${r.app} ${r.appVersion}` },
                  { key: 'p', header: t('Platform / device', 'المنصة / الجهاز'), cell: (r: any) => `${r.platform} · ${r.deviceClass} · ${r.network}` },
                  { key: 's', header: t('Samples', 'العينات'), align: 'end', cell: (r: any) => num(r.samples) },
                  { key: 'av', header: t('Avg ms', 'المتوسط'), align: 'end', cell: (r: any) => (r.avgMs === null ? <span className="text-gray-400">{t('< 20 samples', 'أقل من 20 عينة')}</span> : r.avgMs) },
                  { key: 'mx', header: t('Max ms', 'الأقصى'), align: 'end', cell: (r: any) => r.maxMs },
                ]} />
              </Card>
              <p className="mt-2 text-xs text-gray-500">{cl.data.note}</p>
            </>
          )}
        </Async>
      )}
    </div>
  );
}
