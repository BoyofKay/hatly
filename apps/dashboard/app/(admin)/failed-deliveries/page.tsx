'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FailedDeliveryQueueItem, listFailedDeliveryQueue } from '../../../lib/api/admin-failed-deliveries';
import { apiErrorMessage } from '../../../lib/api/errors';
import { PAYMENT_METHOD, PAYMENT_STATUS, label } from '../../../lib/admin/labels';
import { useLang } from '../../../lib/ui/lang';
import { Button, Card, Column, DataTable, inputCls, KpiCard, PageHeader, StatusPill } from '../../../components/ui';

/**
 * Failed Deliveries — the queue of delivery attempts that failed and still need a decision. Consumes `GET admin/orders/failed-deliveries`; a case leaves
 * this list the moment a resolution exists, whatever the outcome (the backend's own definition of "unresolved", never duplicated here). The oldest
 * case is listed first so nothing waits unseen; opening a case shows the resolution form.
 */
export default function FailedDeliveriesPage() {
  const { t, money, dateTime } = useLang();
  const router = useRouter();
  const [items, setItems] = useState<FailedDeliveryQueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const refresh = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      setItems(await listFailedDeliveryQueue());
    } catch (err: any) {
      setError(apiErrorMessage(err, t('Failed to load failed deliveries.', 'تعذّر تحميل التوصيلات الفاشلة.')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (items ?? [])
      .filter((i) => !q || [i.orderNumber, i.customerName, i.driverName, i.failureReason].some((v) => (v ?? '').toLowerCase().includes(q)))
      .sort((a, b) => (a.failedAt ?? '').localeCompare(b.failedAt ?? ''));
  }, [items, search]);

  const columns: Column<FailedDeliveryQueueItem>[] = [
    { key: 'order', header: t('Order', 'الطلب'), cell: (i) => <Link href={`/order-search/${i.orderId}`} className="font-mono text-xs font-semibold text-gray-900 hover:underline" dir="ltr">{i.orderNumber}</Link> },
    { key: 'failedAt', header: t('Failed at', 'وقت الفشل'), cell: (i) => <span className="whitespace-nowrap text-gray-600">{dateTime(i.failedAt)}</span> },
    { key: 'reason', header: t('Reason', 'السبب'), cell: (i) => i.failureReason ?? '—' },
    { key: 'customer', header: t('Customer', 'العميل'), cell: (i) => i.customerName ?? i.customerId.slice(0, 8) },
    { key: 'driver', header: t('Driver', 'السائق'), cell: (i) => i.driverName ?? (i.driverId ? i.driverId.slice(0, 8) : '—') },
    { key: 'total', header: t('Total', 'الإجمالي'), align: 'end', cell: (i) => (i.totalMinor != null ? money(i.totalMinor) : '—') },
    {
      key: 'payment', header: t('Payment', 'الدفع'),
      cell: (i) => (
        <span className="inline-flex flex-wrap items-center justify-end gap-1 md:justify-start">
          <span className="text-gray-700">{label(PAYMENT_METHOD, i.paymentMethod, t)}</span>
          {i.paymentStatus && <StatusPill status={i.paymentStatus} label={label(PAYMENT_STATUS, i.paymentStatus, t)} />}
        </span>
      ),
    },
    { key: 'open', header: '', align: 'end', cell: (i) => <Link href={`/failed-deliveries/${i.orderId}`} className="inline-flex min-h-[36px] items-center font-medium text-hatly-orangeDark hover:underline">{t('Resolve', 'معالجة')}</Link> },
  ];

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={t('Failed Deliveries', 'التوصيلات الفاشلة')}
        subtitle={t('Delivery attempts that failed and still need a decision: refund, redeliver or close.', 'محاولات توصيل فشلت وما زالت تحتاج قرارًا: استرداد أو إعادة توصيل أو إغلاق.')}
        actions={<Button onClick={refresh} loading={loading}>{t('Refresh', 'تحديث')}</Button>}
      />
      {items && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard label={t('Waiting for a decision', 'بانتظار قرار')} value={items.length} tone={items.length > 0 ? 'bad' : 'good'} hint={items.length === 0 ? t('All clear', 'لا شيء معلّق') : undefined} />
        </div>
      )}
      <div className="mb-3">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Search order, customer, driver or reason', 'ابحث برقم الطلب أو العميل أو السائق أو السبب')} aria-label={t('Search failed deliveries', 'البحث في التوصيلات الفاشلة')} className={`${inputCls} min-h-[44px] sm:min-h-0 sm:max-w-md`} />
      </div>
      <Card pad={false}>
        <DataTable
          columns={columns}
          rows={items ? rows : undefined}
          rowKey={(i) => i.orderId}
          loading={loading}
          error={error}
          onRetry={refresh}
          emptyTitle={items && items.length > 0 ? t('No failed delivery matches this search.', 'لا توجد توصيلات فاشلة مطابقة للبحث.') : t('No unresolved failed deliveries.', 'لا توجد توصيلات فاشلة غير معالجة.')}
          emptyHint={items && items.length > 0 ? undefined : t('When a delivery fails it appears here until someone decides what happens next.', 'عند فشل توصيل يظهر هنا حتى يقرر أحدهم الخطوة التالية.')}
          onRowClick={(i) => router.push(`/failed-deliveries/${i.orderId}`)}
        />
      </Card>
    </div>
  );
}
