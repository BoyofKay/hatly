'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, Column, DataTable, DateRange, FilterBar, KpiCard, LabeledSelect, PageHeader, cairoDate, useToast } from '../../../components/ui';
import { apiErrorMessage } from '../../../lib/api/errors';
import { useApi } from '../../../lib/ui/api';
import { useLang } from '../../../lib/ui/lang';
import { PAYMENT_METHOD, pick } from '../../../lib/vendor/labels';
import type { VendorOverview } from '../../../lib/api/vendor-business';
import { downloadFinanceCsv, type FinanceStatement } from '../../../lib/api/vendor-operations';

/**
 * The Financial Centre — what the platform has RECORDED about your branches, each concept on its own line:
 *   · your sales (goods of completed, non-cancelled orders),
 *   · the commission Hatly has recognised on them (what you owe Hatly — never an amount Hatly owes you),
 *   · how customers paid, cancelled parts (never counted as sales), closed settlement periods with their recorded payments, and a monthly history.
 * Nothing is netted into a "balance": the platform has no defined net-payable to a vendor and does not record money drivers pay vendors, and this page
 * says so instead of estimating. The settlement frequency is a term agreed with Hatly and set by Hatly; until it is, the page says "not configured".
 */
export default function VendorFinancePage() {
  const { t, money, num, date, dateTime } = useLang();
  const overview = useApi<VendorOverview>('/vendor/overview');
  const [branchId, setBranchId] = useState('');
  const [from, setFrom] = useState(cairoDate(-29));
  const [to, setTo] = useState(cairoDate(0));
  const toast = useToast();
  const [exporting, setExporting] = useState(false);
  const state = useApi<FinanceStatement>('/vendor/finance', { branchId: branchId || undefined, from, to });
  async function exportCsv() {
    setExporting(true);
    try { await downloadFinanceCsv({ branchId: branchId || undefined, from, to }); } catch (e) { toast.push('error', apiErrorMessage(e, t('The export failed.', 'تعذّر التصدير.'))); } finally { setExporting(false); }
  }
  const f = state.data;
  const branches = overview.data?.branches ?? [];
  useEffect(() => undefined, []);

  const methodCols: Column<FinanceStatement['customerPayments'][number]>[] = [
    { key: 'm', header: t('Payment method', 'طريقة الدفع'), cell: (r) => pick(PAYMENT_METHOD, r.method, t) },
    { key: 'p', header: t('Orders', 'الطلبات'), align: 'end', cell: (r) => num(r.parts) },
    { key: 'g', header: t('Goods value', 'قيمة البضاعة'), align: 'end', cell: (r) => money(r.goodsMinor) },
  ];
  const histCols: Column<FinanceStatement['history'][number]>[] = [
    { key: 'm', header: t('Month', 'الشهر'), cell: (r) => <span dir="ltr">{r.month}</span> },
    { key: 'p', header: t('Orders', 'الطلبات'), align: 'end', cell: (r) => num(r.parts) },
    { key: 'g', header: t('Sales', 'المبيعات'), align: 'end', cell: (r) => money(r.goodsMinor) },
    { key: 'c', header: t('Commission owed to Hatly', 'العمولة المستحقة لهاتلي'), align: 'end', cell: (r) => money(r.commissionMinor) },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title={t('Financial centre', 'المركز المالي')} subtitle={t('What Hatly has recorded about your sales, the commission on them, and your settlements — each shown separately.', 'ما سجّلته هاتلي عن مبيعاتك والعمولة عليها وتسوياتك — كلٌّ على حدة.')} actions={<><Button onClick={exportCsv} loading={exporting} data-testid="finance-export">{t('Download CSV', 'تنزيل CSV')}</Button><Link href="/earnings" className="text-sm font-medium text-hatly-orangeDark hover:underline">{t('Order-by-order statement', 'كشف الطلبات واحدًا واحدًا')}</Link></>} />
      <FilterBar>
        {branches.length > 1 && <div className="w-56"><LabeledSelect label={t('Branch', 'الفرع')} value={branchId} onChange={(e) => setBranchId(e.target.value)}><option value="">{t('All branches', 'كل الفروع')}</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</LabeledSelect></div>}
        <DateRange from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b); }} />
      </FilterBar>
      {state.error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{state.error}</p>}

      <Card title={t('Your terms with Hatly', 'شروطك مع هاتلي')}>
        <dl className="grid gap-4 sm:grid-cols-2" data-testid="finance-terms">
          <div>
            <dt className="text-xs text-gray-500">{t('Settlement frequency', 'دورة التسوية')}</dt>
            <dd className="mt-0.5 text-sm font-medium" data-testid="finance-frequency">
              {!f ? '—' : f.terms.settlementFrequency ? (f.terms.settlementFrequency === 'WEEKLY' ? t('Weekly', 'أسبوعيًا') : t('Monthly', 'شهريًا')) : f.terms.platformDefaultFrequency ? <span>{f.terms.platformDefaultFrequency === 'WEEKLY' ? t('Weekly', 'أسبوعيًا') : t('Monthly', 'شهريًا')} <span className="text-xs font-normal text-gray-500">{t('(Hatly’s standard — no separate agreement is recorded for you)', '(الدورة المعتمدة لدى هاتلي — لا يوجد اتفاق منفصل مسجَّل لك)')}</span></span> : <span className="text-amber-700">{t('Not configured yet — Hatly sets this with you under your agreement.', 'لم تُحدَّد بعد — تحددها هاتلي معك وفق اتفاقكما.')}</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">{t('Commission rate', 'نسبة العمولة')}</dt>
            <dd className="mt-0.5 space-y-0.5 text-sm">{f?.branches.map((b) => <p key={b.id}><bdi>{b.name}</bdi>: <b dir="ltr">{b.commissionRateBasisPoints == null ? t('not set', 'غير محددة') : `${num(b.commissionRateBasisPoints / 100)}%`}</b></p>)}</dd>
          </div>
        </dl>
      </Card>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <KpiCard label={t('Your sales', 'مبيعاتك')} value={f ? money(f.sales.goodsMinor) : '—'} hint={f ? t(`${num(f.sales.parts)} completed order(s)`, `${num(f.sales.parts)} طلب مكتمل`) : undefined} />
        <KpiCard label={t('Commission owed to Hatly', 'العمولة المستحقة لهاتلي')} value={f ? money(f.commissionReceivable.minor) : '—'} hint={t('Hatly’s receivable on those sales', 'مستحق لهاتلي على هذه المبيعات')} />
        <KpiCard label={t('Cancelled parts', 'أجزاء ملغاة')} value={f ? num(f.cancelledParts.parts) : '—'} hint={f ? t(`${money(f.cancelledParts.goodsMinor)} — never counted as sales`, `${money(f.cancelledParts.goodsMinor)} — لا تُحتسب كمبيعات`) : undefined} />
      </div>

      <Card title={t('How customers paid', 'كيف دفع العملاء')} pad={false}>
        <DataTable columns={methodCols} rows={f?.customerPayments} rowKey={(r) => r.method} loading={state.loading} emptyTitle={t('No completed orders in this period.', 'لا توجد طلبات مكتملة في هذه الفترة.')} />
      </Card>

      <Card title={t('Not recorded by the platform', 'غير مسجَّل في المنصة')}>
        <ul className="space-y-2 text-sm text-gray-700" data-testid="finance-not-recorded">
          <li><b>{t('Money drivers pay to vendors', 'المبالغ التي يدفعها السائقون للمتاجر')}</b> — {t('not recorded, so nothing is shown or estimated here.', 'غير مسجَّلة، لذا لا يُعرض ولا يُقدَّر شيء هنا.')}</li>
          <li><b>{t('Amount payable to you', 'المبلغ المستحق لك')}</b> — {t('no net-payable rule has been defined between Hatly and vendors, so no balance is shown. The commission above is what Hatly records as owed to Hatly.', 'لم تُحدَّد قاعدة لصافي المستحق بين هاتلي والمتاجر، لذا لا يُعرض رصيد. العمولة أعلاه هي ما تسجّله هاتلي كمستحق لها.')}</li>
        </ul>
      </Card>

      <Card title={t('Closed settlement periods', 'فترات التسوية المغلقة')}>
        {!f || f.settlements.length === 0 ? <p className="text-sm text-gray-500">{t('No settlement period has been closed yet.', 'لم تُغلق أي فترة تسوية بعد.')}</p> : (
          <ul className="divide-y divide-gray-100">
            {f.settlements.map((s) => (
              <li key={s.id} className="py-3 text-sm" data-testid="finance-settlement">
                <p className="flex flex-wrap items-center gap-2"><bdi className="font-medium">{s.branchName}</bdi><Badge>{s.frequency === 'WEEKLY' ? t('Weekly', 'أسبوعي') : s.frequency === 'MONTHLY' ? t('Monthly', 'شهري') : s.frequency}</Badge><span className="text-xs text-gray-500">{date(s.periodStart)} → {date(s.periodEnd)}</span></p>
                <p className="mt-1 text-xs text-gray-600">{t('Sales', 'المبيعات')}: <b>{money(s.grossSalesMinor)}</b> · {t('Commission owed to Hatly', 'العمولة المستحقة لهاتلي')}: <b>{money(s.commissionOwedMinor)}</b></p>
                {s.payments.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs text-gray-600">
                    {s.payments.map((p) => <li key={p.id}>{t('Payment recorded', 'دفعة مسجَّلة')}: {money(p.amountMinor)} · {p.method} · {date(p.paidOn)} · {p.direction} · <span className="text-gray-500">{p.status}</span></li>)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t('Monthly history (last 12 months)', 'السجل الشهري (آخر 12 شهرًا)')} pad={false}>
        <DataTable columns={histCols} rows={f?.history} rowKey={(r) => r.month} loading={state.loading} emptyTitle={t('No completed orders yet.', 'لا توجد طلبات مكتملة بعد.')} />
      </Card>
      <p className="text-xs text-gray-400">{f ? `${t('Updated', 'تم التحديث')} ${dateTime(new Date())}` : ''}</p>
    </div>
  );
}
