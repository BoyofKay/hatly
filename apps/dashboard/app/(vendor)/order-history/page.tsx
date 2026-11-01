'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button, Card, DataTable, DateRange, FilterBar, LabeledInput, LabeledSelect, PageHeader, Pagination, cairoDate, useDebounced, usePaging, useToast } from '../../../components/ui';
import { SegmentBadge } from '../../../components/vendor/SegmentBadge';
import { useApi } from '../../../lib/ui/api';
import { useLang } from '../../../lib/ui/lang';
import { getVendorHistory, type VendorBranchSummary, type VendorHistoryRow } from '../../../lib/api/vendor-business';
import { FULFILLMENT, PAYMENT_METHOD, SEGMENT_STATUS, pick } from '../../../lib/vendor/labels';
import { apiErrorMessage } from '../../../lib/api/errors';

/** A cell a spreadsheet could execute as a formula is neutralised before it goes into a CSV. */
const csv = (v: unknown) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

/** Every order part of the vendor's own branches, searchable and paged, with a CSV export that carries no customer data. */
export default function VendorOrderHistoryPage() {
  const { t, money, dateTime } = useLang();
  const toast = useToast();
  const [from, setFrom] = useState(cairoDate(-30));
  const [to, setTo] = useState(cairoDate(0));
  const [status, setStatus] = useState('');
  const [branchId, setBranchId] = useState('');
  const [q, setQ] = useState('');
  const search = useDebounced(q);
  const { page, setPage, limit } = usePaging(JSON.stringify([from, to, status, branchId, search]));
  const branches = useApi<{ branches: VendorBranchSummary[] }>('/vendor/overview');
  const list = useApi<VendorHistoryRow[]>('/vendor/orders/history', { from, to, status: status || undefined, branchId: branchId || undefined, q: search || undefined, page, limit });
  const [exporting, setExporting] = useState(false);

  async function exportCsv() {
    setExporting(true);
    try {
      const rows: VendorHistoryRow[] = [];
      for (let p = 1; p <= 20; p++) {
        const r = await getVendorHistory({ from, to, status: status || undefined, branchId: branchId || undefined, q: search || undefined, page: p, limit: 100 });
        rows.push(...r.items);
        if (rows.length >= r.total) break;
      }
      const lines = [['order', 'created', 'branch', 'status', 'items', 'goods_value', 'payment', 'fulfilment'].map(csv).join(',')];
      for (const r of rows) lines.push([r.orderNumber, r.createdAt, r.branch.name, r.status, r.itemCount, r.subtotalMinor == null ? '' : (r.subtotalMinor / 100).toFixed(2), r.paymentMethod, r.fulfillmentType].map(csv).join(','));
      const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `orders-${from}-to-${to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.push('error', apiErrorMessage(e, t('The export failed.', 'فشل التصدير.')));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={t('Order history', 'سجل الطلبات')}
        subtitle={t('Every order part of your branches. The export contains no customer details.', 'كل أجزاء الطلبات في فروعك. ملف التصدير لا يحتوي على بيانات العملاء.')}
        actions={<Button onClick={exportCsv} loading={exporting}>{t('Export CSV', 'تصدير CSV')}</Button>}
      />
      <FilterBar onClear={() => { setQ(''); setStatus(''); setBranchId(''); setFrom(cairoDate(-30)); setTo(cairoDate(0)); }}>
        <DateRange from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b); }} />
        <div className="w-44"><LabeledSelect label={t('Status', 'الحالة')} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">{t('Any', 'الكل')}</option>{Object.keys(SEGMENT_STATUS).map((s) => <option key={s} value={s}>{pick(SEGMENT_STATUS, s, t)}</option>)}</LabeledSelect></div>
        {(branches.data?.branches.length ?? 0) > 1 && <div className="w-48"><LabeledSelect label={t('Branch', 'الفرع')} value={branchId} onChange={(e) => setBranchId(e.target.value)}><option value="">{t('All branches', 'كل الفروع')}</option>{branches.data!.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</LabeledSelect></div>}
        <div className="w-56"><LabeledInput label={t('Order number', 'رقم الطلب')} value={q} onChange={(e) => setQ(e.target.value)} placeholder="HT-…" /></div>
      </FilterBar>
      <Card pad={false}>
        <DataTable rows={list.data} rowKey={(r) => r.segmentId} loading={list.loading} error={list.error} status={list.status} onRetry={list.reload} emptyTitle={t('No orders in this range', 'لا توجد طلبات في هذه الفترة')} columns={[
          { key: 'o', header: t('Order', 'الطلب'), cell: (r) => <Link href={`/orders/${r.orderId}`} className="font-medium text-hatly-orangeDark hover:underline" dir="ltr">{r.orderNumber}</Link> },
          { key: 'd', header: t('Date', 'التاريخ'), cell: (r) => dateTime(r.createdAt) },
          { key: 'b', header: t('Branch', 'الفرع'), cell: (r) => <bdi>{r.branch.name}</bdi> },
          { key: 's', header: t('Status', 'الحالة'), cell: (r) => <SegmentBadge status={r.status} /> },
          { key: 'i', header: t('Items', 'المنتجات'), align: 'end', cell: (r) => r.itemCount },
          { key: 'g', header: t('Goods value', 'قيمة البضاعة'), align: 'end', cell: (r) => money(r.subtotalMinor) },
          { key: 'p', header: t('Payment', 'الدفع'), cell: (r) => `${pick(PAYMENT_METHOD, r.paymentMethod, t)} · ${pick(FULFILLMENT, r.fulfillmentType, t)}` },
        ]} />
        {list.meta && <Pagination page={page} limit={limit} total={list.meta.total} onPage={setPage} />}
      </Card>
    </div>
  );
}
