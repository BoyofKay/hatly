'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Card, DataTable, DateRange, FilterBar, KpiCard, LabeledSelect, PageHeader, Pagination, StatusPill, cairoDate, usePaging } from '../../../components/ui';
import { useApi } from '../../../lib/ui/api';
import { useLang } from '../../../lib/ui/lang';
import type { VendorEarnings, VendorOverview } from '../../../lib/api/vendor-business';
import { PAYMENT_METHOD, pick } from '../../../lib/vendor/labels';

/**
 * A read-only statement of what Hatly has RECORDED for your branches: completed orders with the goods value of your part and the commission Hatly
 * recognized for it, plus the settlement periods Hatly has closed. It shows no payout, balance or net amount — how and when you and Hatly settle is
 * agreed with Hatly and is not calculated on this screen.
 */
export default function VendorEarningsPage() {
  const { t, money, dateTime, date } = useLang();
  const [from, setFrom] = useState(cairoDate(-30));
  const [to, setTo] = useState(cairoDate(0));
  const [branchId, setBranchId] = useState('');
  const { page, setPage, limit } = usePaging(JSON.stringify([from, to, branchId]));
  const overview = useApi<VendorOverview>('/vendor/overview');
  const state = useApi<VendorEarnings>('/vendor/earnings', { from, to, branchId: branchId || undefined, page, limit });
  const d = state.data;
  return (
    <div>
      <PageHeader title={t('Earnings', 'المستحقات')} subtitle={t('What Hatly has recorded for your completed orders. This is a statement, not a payout.', 'ما سجّلته هاتلي لطلباتك المكتملة. هذا كشف وليس صرفًا.')} />
      <div role="note" className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        {t('Goods value is the value of your products in the order. Commission is what Hatly recorded for that order. Settlement dates and amounts are set by Hatly; if a number looks wrong, contact Hatly support with the order number.', 'قيمة البضاعة هي قيمة منتجاتك في الطلب. العمولة هي ما سجّلته هاتلي لذلك الطلب. مواعيد ومبالغ التسوية تحددها هاتلي؛ إن بدا رقم غير صحيح فتواصل مع دعم هاتلي مع رقم الطلب.')}
      </div>
      <FilterBar>
        <DateRange from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b); }} />
        {(overview.data?.branches.length ?? 0) > 1 && <div className="w-48"><LabeledSelect label={t('Branch', 'الفرع')} value={branchId} onChange={(e) => setBranchId(e.target.value)}><option value="">{t('All branches', 'كل الفروع')}</option>{overview.data!.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</LabeledSelect></div>}
      </FilterBar>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard label={t('Completed orders', 'الطلبات المكتملة')} value={d ? d.totals.orders : '—'} />
        <KpiCard label={t('Goods value', 'قيمة البضاعة')} value={d ? money(d.totals.goodsMinor) : '—'} />
        <KpiCard label={t('Commission recorded', 'العمولة المسجّلة')} value={d ? money(d.totals.commissionMinor) : '—'} hint={t('Orders with no commission record yet show a dash.', 'الطلبات التي لم تُسجَّل لها عمولة بعد تظهر بشرطة.')} />
      </div>
      <Card pad={false} title={t('Completed orders', 'الطلبات المكتملة')}>
        <DataTable rows={d?.items} rowKey={(r) => r.orderId} loading={state.loading} error={state.error} status={state.status} onRetry={state.reload} emptyTitle={t('No completed orders in this range', 'لا توجد طلبات مكتملة في هذه الفترة')} columns={[
          { key: 'o', header: t('Order', 'الطلب'), cell: (r) => <Link href={`/orders/${r.orderId}`} className="font-medium text-hatly-orangeDark hover:underline" dir="ltr">{r.orderNumber}</Link> },
          { key: 'c', header: t('Completed', 'اكتمل في'), cell: (r) => dateTime(r.completedAt) },
          { key: 'b', header: t('Branch', 'الفرع'), cell: (r) => <bdi>{r.branchName}</bdi> },
          { key: 'p', header: t('Payment', 'الدفع'), cell: (r) => pick(PAYMENT_METHOD, r.paymentMethod, t) },
          { key: 'g', header: t('Goods value', 'قيمة البضاعة'), align: 'end', cell: (r) => money(r.goodsMinor) },
          { key: 'm', header: t('Commission', 'العمولة'), align: 'end', cell: (r) => (r.commissionMinor == null ? '—' : money(r.commissionMinor)) },
        ]} />
        {state.meta && <Pagination page={page} limit={limit} total={state.meta.total} onPage={setPage} />}
      </Card>
      <div className="mt-5">
        <Card pad={false} title={t('Settlement periods closed by Hatly', 'فترات التسوية التي أغلقتها هاتلي')}>
          <DataTable rows={d?.settlements} rowKey={(s) => s.id} loading={state.loading} emptyTitle={t('Hatly has not closed a settlement period for your branches yet.', 'لم تُغلق هاتلي فترة تسوية لفروعك بعد.')} columns={[
            { key: 'b', header: t('Branch', 'الفرع'), cell: (s) => <bdi>{s.branchName}</bdi> },
            { key: 'p', header: t('Period', 'الفترة'), cell: (s) => `${date(s.periodStart)} → ${date(s.periodEnd)}` },
            { key: 's', header: t('Status', 'الحالة'), cell: (s) => <StatusPill status={s.status} /> },
            { key: 'g', header: t('Gross sales', 'إجمالي المبيعات'), align: 'end', cell: (s) => money(s.grossSalesMinor) },
            { key: 'c', header: t('Commission owed', 'العمولة المستحقة'), align: 'end', cell: (s) => money(s.commissionOwedMinor) },
          ]} />
        </Card>
      </div>
    </div>
  );
}
