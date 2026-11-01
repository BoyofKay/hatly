'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card, CursorMore, DataTable, DateRange, FilterBar, KpiCard, LabeledSelect, Modal, PageHeader, StatusPill, cairoDate } from '../../../../components/ui';
import { ICONS } from '../../../../components/ui/icons';
import { FINANCIAL_DIRECTION, FINANCIAL_EVENT_TYPE, label } from '../../../../lib/admin/labels';
import { getEnvelope, useApi } from '../../../../lib/ui/api';
import { useLang } from '../../../../lib/ui/lang';
import { usePermissions } from '../../../../lib/ui/permissions';
import { ExportButton } from '../../../../components/reports/ExportButton';

const TYPES = ['VENDOR_COMMISSION_RECOGNIZED', 'DRIVER_COMMISSION_RECOGNIZED', 'DRIVER_REIMBURSEMENT_OWED', 'HATLY_SERVICE_CHARGE_RECOGNIZED', 'CANCELLATION_WITH_PRIOR_EXPENSE_RECORDED', 'FAILED_DELIVERY_RECORDED', 'MANUAL_TRANSFER_REFUND_RECORDED', 'EMPLOYEE_LOAN_ISSUED', 'EMPLOYEE_LOAN_REPAYMENT_RECORDED', 'HATLY_FUNDED_OFFER_DISCOUNT_RECORDED', 'HATLY_FUNDED_OFFER_DISCOUNT_RESTORED'];

export default function LedgerPage() {
  const { t, money, num, dateTime } = useLang();
  const typeName = (code: string) => label(FINANCIAL_EVENT_TYPE, code, t);
  const { can } = usePermissions();
  const [from, setFrom] = useState(cairoDate(-29));
  const [to, setTo] = useState(cairoDate(0));
  const [type, setType] = useState('');
  const [items, setItems] = useState<any[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const params = { from, to, type: type || undefined };
  const first = useApi<any>('/admin/finance/ledger', { ...params, limit: 50 });
  const summary = useApi<any>('/admin/finance/ledger/summary', params);
  const rows: any[] | undefined = (items ?? first.data?.items) as any[] | undefined;
  const next = cursor ?? first.data?.nextCursor ?? null;
  const loadMore = async () => {
    setMoreBusy(true);
    try {
      const r = (await getEnvelope('/admin/finance/ledger', { ...params, limit: 50, cursor: next })).data;
      setItems([...(rows ?? []), ...r.items]);
      setCursor(r.nextCursor);
      setMore(Boolean(r.nextCursor));
    } finally { setMoreBusy(false); }
  };
  const reset = () => { setItems(null); setCursor(null); setMore(false); };
  const open = async (id: string) => setDetail((await getEnvelope(`/admin/finance/ledger/${id}`)).data);
  return (
    <div>
      <PageHeader title={t('Ledger', 'دفتر الأستاذ')} subtitle={t('Every financial event, append-only. Events are never edited or deleted; a correction is a new, linked event.', 'كل حدث مالي، سجل لا يُعدَّل. التصحيح يكون بحدث جديد مرتبط.')} actions={can('FINANCE_EXPORT') ? <ExportButton report="S09" params={{ from, to, type: type || undefined }} /> : undefined} />
      <FilterBar>
        <DateRange from={from} to={to} onChange={(f, tt) => { setFrom(f); setTo(tt); reset(); }} />
        <div className="w-64"><LabeledSelect label={t('Event type', 'نوع الحدث')} value={type} onChange={(e) => { setType(e.target.value); reset(); }}><option value="">{t('All', 'الكل')}</option>{TYPES.map((x) => <option key={x} value={x}>{typeName(x)}</option>)}</LabeledSelect></div>
      </FilterBar>
      {summary.data && summary.data.byType.length > 0 && (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="ledger-kpis">
          {summary.data.byType.map((s: any) => (
            <KpiCard key={`${s.type}${s.direction}`} label={typeName(s.type)} hint={s.type} value={money(s.totalMinor)}
              icon={s.direction === 'RECEIVABLE' ? ICONS.coins : s.direction === 'PAYABLE' ? ICONS.receipt : ICONS.list}
              footnote={`${num(s.events)} ${t('events', 'حدث')} · ${label(FINANCIAL_DIRECTION, s.direction, t)}`} />
          ))}
        </div>
      )}
      <Card pad={false}>
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          loading={first.loading}
          error={first.error}
          status={first.status}
          onRetry={first.reload}
          onRowClick={(r) => open(r.id)}
          emptyTitle={t('No financial events in this range', 'لا توجد أحداث مالية في هذه الفترة')}
          columns={[
            { key: 'at', header: t('Time (Cairo)', 'الوقت (القاهرة)'), cell: (r) => dateTime(r.createdAt) },
            { key: 'type', header: t('Type', 'النوع'), cell: (r) => <span className="text-xs">{typeName(r.type)}</span> },
            { key: 'dir', header: t('Direction', 'الاتجاه'), cell: (r) => <StatusPill status={r.direction === 'RECEIVABLE' ? 'ACTIVE' : r.direction === 'PAYABLE' ? 'PENDING' : 'DRAFT'} label={label(FINANCIAL_DIRECTION, r.direction, t)} /> },
            { key: 'order', header: t('Order', 'الطلب'), cell: (r) => r.orderId ? <Link className="text-hatly-orangeDark hover:underline" onClick={(e) => e.stopPropagation()} href={`/order-search/${r.orderId}`}><bdi>{r.orderNumber}</bdi></Link> : '—' },
            { key: 'branch', header: t('Branch', 'الفرع'), cell: (r) => <bdi>{r.branchName ?? '—'}</bdi> },
            { key: 'amt', header: t('Amount', 'المبلغ'), align: 'end', cell: (r) => money(r.amountMinor) },
          ]}
        />
        <CursorMore hasMore={Boolean(next)} loading={moreBusy} onMore={loadMore} />
      </Card>
      <Modal open={Boolean(detail)} title={t('Financial event', 'حدث مالي')} onClose={() => setDetail(null)}>
        {detail && (
          <dl className="grid grid-cols-3 gap-2 text-sm">
            <dt className="text-gray-500">{t('Type', 'النوع')}</dt><dd className="col-span-2">{typeName(detail.type)}</dd>
            <dt className="text-gray-500">{t('Amount', 'المبلغ')}</dt><dd className="col-span-2 tabular-nums">{money(detail.amountMinor)}</dd>
            <dt className="text-gray-500">{t('Order', 'الطلب')}</dt><dd className="col-span-2"><bdi>{detail.orderNumber ?? '—'}</bdi></dd>
            <dt className="text-gray-500">{t('Reason', 'السبب')}</dt><dd className="col-span-2">{detail.reason ?? '—'}</dd>
            {detail.refundSent && <><dt className="text-gray-500">{t('Refund sent', 'تم إرسال الاسترداد')}</dt><dd className="col-span-2">{dateTime(detail.refundSent.sentAt)}</dd></>}
            {detail.linkedEvents.length > 0 && <><dt className="text-gray-500">{t('Linked events', 'أحداث مرتبطة')}</dt><dd className="col-span-2 space-y-1">{detail.linkedEvents.map((l: any) => <div key={l.id} className="text-xs">{typeName(l.type)} · {money(l.amountMinor)} · {dateTime(l.createdAt)}</div>)}</dd></>}
          </dl>
        )}
      </Modal>
    </div>
  );
}
