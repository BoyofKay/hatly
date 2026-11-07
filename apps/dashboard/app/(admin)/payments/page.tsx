'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card, CursorMore, DataTable, DateRange, FilterBar, LabeledSelect, PageHeader, StatusPill, cairoDate } from '../../../components/ui';
import { getEnvelope, useApi } from '../../../lib/ui/api';
import { useLang } from '../../../lib/ui/lang';
import { usePermissions } from '../../../lib/ui/permissions';
import { ExportButton } from '../../../components/reports/ExportButton';
import { methodWords, paymentState } from '../../../components/orders/PaymentPill';
import { Badge } from '../../../components/ui';
import { PAYMENT_STATUS, label } from '../../../lib/admin/labels';

export default function PaymentsPage() {
  const { t, money, dateTime } = useLang();
  const { can } = usePermissions();
  const [from, setFrom] = useState(cairoDate(-29));
  const [to, setTo] = useState(cairoDate(0));
  const [method, setMethod] = useState('');
  const [status, setStatus] = useState('');
  const [extra, setExtra] = useState<any[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const first = useApi<any>('/admin/payments', { from, to, method: method || undefined, status: status || undefined, limit: 50 });
  const rows = [...(first.data?.items ?? []), ...extra];
  const next = cursor === undefined ? first.data?.nextCursor : cursor;
  const reset = () => { setExtra([]); setCursor(undefined); };
  const more = async () => {
    setBusy(true);
    try { const r = (await getEnvelope('/admin/payments', { from, to, method: method || undefined, status: status || undefined, limit: 50, cursor: next })).data; setExtra([...extra, ...r.items]); setCursor(r.nextCursor); } finally { setBusy(false); }
  };
  return (
    <div>
      <PageHeader title={t('Payments', 'المدفوعات')} subtitle={t('Every payment of every method. Manual transfers are verified on the Manual Transfer page.', 'كل المدفوعات بكل الطرق. تُراجع التحويلات اليدوية في صفحة التحويل اليدوي.')} actions={<><Link href="/manual-transfer" className="text-sm font-medium text-hatly-orangeDark hover:underline">{t('Verify manual transfers →', 'التحقق من التحويلات اليدوية ←')}</Link>{can('FINANCE_EXPORT') && <ExportButton report="S16" params={{ from, to, method: method || undefined, status: status || undefined }} />}</>} />
      <FilterBar>
        <DateRange from={from} to={to} onChange={(f, tt) => { setFrom(f); setTo(tt); reset(); }} />
        <div className="w-44"><LabeledSelect label={t('Method', 'الطريقة')} value={method} onChange={(e) => { setMethod(e.target.value); reset(); }}><option value="">{t('All', 'الكل')}</option>{['COD', 'WALLET', 'MANUAL_TRANSFER'].map((m) => <option key={m} value={m}>{methodWords(m, t)}</option>)}</LabeledSelect></div>
        <div className="w-52"><LabeledSelect label={t('Status', 'الحالة')} value={status} onChange={(e) => { setStatus(e.target.value); reset(); }}><option value="">{t('All', 'الكل')}</option>{['PENDING', 'CUSTOMER_CLAIMED_TRANSFER', 'UNDER_REVIEW', 'PAID', 'REJECTED'].map((s) => <option key={s} value={s}>{label(PAYMENT_STATUS, s, t)}</option>)}</LabeledSelect></div>
      </FilterBar>
      <Card pad={false}>
        <DataTable rows={first.data ? rows : undefined} rowKey={(r) => r.id} loading={first.loading} error={first.error} status={first.status} onRetry={first.reload} columns={[
          { key: 'at', header: t('Time (Cairo)', 'الوقت (القاهرة)'), cell: (r) => dateTime(r.createdAt) },
          { key: 'o', header: t('Order', 'الطلب'), cell: (r) => <Link className="font-mono text-xs font-semibold text-hatly-orangeDark hover:underline" href={`/order-management?order=${r.orderId}`}><bdi>{r.orderNumber}</bdi></Link> },
          { key: 'm', header: t('Method', 'الطريقة'), cell: (r) => methodWords(r.method, t) },
          { key: 's', header: t('Status', 'الحالة'), cell: (r) => { const st = paymentState(r.method, r.status, t); return <Badge tone={st.tone}>{st.text}</Badge>; } },
          { key: 'a', header: t('Amount', 'المبلغ'), align: 'end', cell: (r) => money(r.amountMinor) },
        ]} />
        <CursorMore hasMore={Boolean(next)} loading={busy} onMore={more} />
      </Card>
    </div>
  );
}
