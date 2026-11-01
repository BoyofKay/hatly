'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button, Card, DataTable, LabeledSelect, PageHeader, StatusPill, FilterBar, useToast } from '../../../components/ui';
import { send, useApi } from '../../../lib/ui/api';
import { apiErrorMessage } from '../../../lib/api/errors';
import { useLang } from '../../../lib/ui/lang';

const REASONS: Record<string, [string, string]> = {
  PENDING_ACCEPTANCE_OVERDUE: ['A vendor part has waited too long for acceptance', 'جزء مورد ينتظر القبول لوقت طويل'],
  OUT_OF_STOCK: ['Product out of stock', 'منتج نفد من المخزون'],
  LOW_STOCK: ['Product low on stock', 'مخزون منتج منخفض'],
  REFUND_NOT_SENT_24H: ['Refund recorded more than 24 h ago, not yet sent', 'استرداد مسجل منذ أكثر من 24 ساعة ولم يُرسل'],
  EXPORT_FAILED: ['An export failed', 'فشل تصدير'],
  INTEGRATION_DOWN: ['An integration is down', 'تكامل متوقف'],
  INTEGRATION_DEGRADED: ['An integration is degraded', 'تكامل متدهور'],
};

export default function AlertsPage() {
  const { t, dateTime } = useLang();
  const toast = useToast();
  const [severity, setSeverity] = useState('');
  const [hideAcked, setHideAcked] = useState('');
  const alerts = useApi<any[]>('/admin/alerts');
  const rows = (alerts.data ?? []).filter((a) => (!severity || a.severity === severity) && (hideAcked !== 'yes' || !a.acknowledged));
  const ack = async (key: string) => {
    try {
      await send('post', '/admin/alerts/acknowledge', { key });
      toast.push('success', t('Acknowledged.', 'تم الإقرار.'));
      alerts.reload();
    } catch (e) {
      toast.push('error', apiErrorMessage(e, t('Could not acknowledge.', 'تعذّر الإقرار.')));
    }
  };
  const label = (r: string) => { const m = REASONS[r]; if (m) return t(m[0], m[1]); return r.startsWith('DISPATCH_') ? t(`Dispatch: ${r.slice(9).replace(/_/g, ' ').toLowerCase()}`, `التوزيع: ${r.slice(9).replace(/_/g, ' ').toLowerCase()}`) : r.replace(/_/g, ' '); };
  return (
    <div>
      <PageHeader title={t('Alerts', 'التنبيهات')} subtitle={t('Every alert exists only while its condition holds — dispatch, acceptance, stock, refunds, exports and integrations. Acknowledging records that someone is on it; it does not resolve the cause.', 'كل تنبيه يظهر فقط ما دام شرطه قائمًا. الإقرار يسجّل أن أحدهم يتابعه ولا يحل السبب.')} />
      <FilterBar onClear={() => { setSeverity(''); setHideAcked(''); }}>
        <div className="w-44"><LabeledSelect label={t('Severity', 'الخطورة')} value={severity} onChange={(e) => setSeverity(e.target.value)}><option value="">{t('All', 'الكل')}</option><option value="critical">{t('Critical', 'حرجة')}</option><option value="warning">{t('Warning', 'تحذير')}</option><option value="info">{t('Info', 'معلومة')}</option></LabeledSelect></div>
        <div className="w-48"><LabeledSelect label={t('Acknowledged', 'المُقَرّ بها')} value={hideAcked} onChange={(e) => setHideAcked(e.target.value)}><option value="">{t('Show all', 'إظهار الكل')}</option><option value="yes">{t('Hide acknowledged', 'إخفاء المُقَرّ بها')}</option></LabeledSelect></div>
      </FilterBar>
      <Card pad={false}>
        <DataTable
          rows={alerts.data ? rows : undefined}
          rowKey={(a) => a.key}
          loading={alerts.loading}
          error={alerts.error}
          status={alerts.status}
          onRetry={alerts.reload}
          emptyTitle={t('No alerts — everything is running normally', 'لا توجد تنبيهات — كل شيء يعمل بشكل طبيعي')}
          columns={[
            { key: 'sev', header: t('Severity', 'الخطورة'), cell: (a) => <StatusPill status={a.severity === 'critical' ? 'DOWN' : a.severity === 'warning' ? 'DEGRADED' : 'OK'} label={a.severity} /> },
            { key: 'reason', header: t('What', 'ماذا'), cell: (a) => <span>{label(a.reason)}</span> },
            { key: 'detail', header: t('Detail', 'التفاصيل'), cell: (a) => <bdi>{a.detail}</bdi> },
            { key: 'since', header: t('Since', 'منذ'), cell: (a) => dateTime(a.since) },
            { key: 'act', header: '', align: 'end', cell: (a) => (
              <span className="flex justify-end gap-2">
                {a.entityType === 'order' && a.entityId && <Link href={`/order-search/${a.entityId}`} className="text-xs font-medium text-hatly-orangeDark hover:underline">{t('Open order', 'فتح الطلب')}</Link>}
                {a.entityType === 'product' && <Link href="/inventory" className="text-xs font-medium text-hatly-orangeDark hover:underline">{t('Inventory', 'المخزون')}</Link>}
                {a.entityType === 'export' && <Link href="/exports" className="text-xs font-medium text-hatly-orangeDark hover:underline">{t('Exports', 'التصدير')}</Link>}
                {a.entityType === 'integration' && <Link href="/system" className="text-xs font-medium text-hatly-orangeDark hover:underline">{t('System', 'النظام')}</Link>}
                {a.acknowledged ? <span className="text-xs text-gray-400">{t('Acknowledged', 'تم الإقرار')}</span> : <Button size="sm" onClick={() => ack(a.key)}>{t('Acknowledge', 'إقرار')}</Button>}
              </span>
            ) },
          ]}
        />
      </Card>
    </div>
  );
}
