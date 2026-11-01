'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card, CursorMore, DataTable, DateRange, FilterBar, LabeledSelect, PageHeader, StatusPill } from '../../../components/ui';
import { getEnvelope, useApi } from '../../../lib/ui/api';
import { useLang } from '../../../lib/ui/lang';

export default function RefundsPage() {
  const { t, money, dateTime } = useLang();
  const [state, setState] = useState('ALL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [extra, setExtra] = useState<any[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const first = useApi<any>('/admin/refunds', { state, from: from || undefined, to: to || undefined, limit: 50 });
  const rows = [...(first.data?.items ?? []), ...extra];
  const next = cursor === undefined ? first.data?.nextCursor : cursor;
  const reset = () => { setExtra([]); setCursor(undefined); };
  const more = async () => { setBusy(true); try { const r = (await getEnvelope('/admin/refunds', { state, from: from || undefined, to: to || undefined, limit: 50, cursor: next })).data; setExtra([...extra, ...r.items]); setCursor(r.nextCursor); } finally { setBusy(false); } };
  const sum = first.data?.summary;
  return (
    <div>
      <PageHeader title={t('Refunds', 'المستردات')} subtitle={t('Recorded is an obligation; Sent means someone transferred the money and marked it. The two are never the same. Mark a refund as sent on the Manual Transfer page.', 'المسجل التزام؛ والمرسل يعني أن أحدهم حوّل المال وسجّل ذلك. هما ليسا الشيء نفسه. سجّل الإرسال في صفحة التحويل اليدوي.')} actions={<Link href="/manual-transfer" className="text-sm font-medium text-hatly-orangeDark hover:underline">{t('Refunds to send →', 'مستردات للإرسال ←')}</Link>} />
      {sum && <div className="mb-4 grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-gray-200 bg-white p-4"><p className="text-xs text-gray-500">{t('Recorded, not yet sent', 'مسجل ولم يُرسل')}</p><p className="mt-1 text-xl font-semibold tabular-nums">{money(sum.toSendMinor)}</p></div><div className="rounded-xl border border-gray-200 bg-white p-4"><p className="text-xs text-gray-500">{t('Sent', 'المُرسَل')}</p><p className="mt-1 text-xl font-semibold tabular-nums">{money(sum.sentMinor)}</p></div></div>}
      <FilterBar>
        <div className="w-48"><LabeledSelect label={t('State', 'الحالة')} value={state} onChange={(e) => { setState(e.target.value); reset(); }}><option value="ALL">{t('All', 'الكل')}</option><option value="TO_SEND">{t('To send', 'للإرسال')}</option><option value="SENT">{t('Sent', 'مرسلة')}</option></LabeledSelect></div>
        <DateRange from={from} to={to} onChange={(f, tt) => { setFrom(f); setTo(tt); reset(); }} />
      </FilterBar>
      <Card pad={false}>
        <DataTable rows={first.data ? rows : undefined} rowKey={(r) => r.eventId} loading={first.loading} error={first.error} status={first.status} onRetry={first.reload} emptyTitle={t('No refunds', 'لا توجد مستردات')} columns={[
          { key: 'at', header: t('Recorded (Cairo)', 'تاريخ التسجيل (القاهرة)'), cell: (r) => dateTime(r.recordedAt) },
          { key: 'o', header: t('Order', 'الطلب'), cell: (r) => <Link className="text-hatly-orangeDark hover:underline" href={`/order-search/${r.orderId}`}><bdi>{r.orderNumber}</bdi></Link> },
          { key: 's', header: t('State', 'الحالة'), cell: (r) => <StatusPill status={r.state === 'SENT' ? 'SENT' : 'PENDING'} label={r.state === 'SENT' ? t('Sent', 'مرسل') : t('To send', 'للإرسال')} /> },
          { key: 'sent', header: t('Sent at', 'أُرسل في'), cell: (r) => (r.sentAt ? dateTime(r.sentAt) : '—') },
          { key: 'a', header: t('Amount', 'المبلغ'), align: 'end', cell: (r) => money(r.amountMinor) },
        ]} />
        <CursorMore hasMore={Boolean(next)} loading={busy} onMore={more} />
      </Card>
    </div>
  );
}
