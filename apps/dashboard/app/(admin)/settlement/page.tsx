'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge, Button, Card, ConfirmDialog, DataTable, ErrorState, LabeledInput, PageHeader, Tabs, cairoDate } from '../../../components/ui';
import { send, useApi } from '../../../lib/ui/api';
import { apiErrorCode, apiErrorMessage } from '../../../lib/api/errors';
import { useLang } from '../../../lib/ui/lang';
import { usePermissions } from '../../../lib/ui/permissions';
import { CourierBreakdown, CourierNet, UnresolvedList, useCourierLineColumns } from '../../../components/settlement/CourierMoney';

/**
 * Closing — courier shift closing (R29: at the office, by Operations, from the previous closing until now) and store period closing
 * (R32/R33/R35). Flow: pick → PREVIEW (writes nothing) → review every order / part, the money parts and what is held back → confirm →
 * a unique reference and a link to the saved statement. Every figure is the backend's; this page computes nothing. The confirm sends the
 * preview's token, so if anything changed meanwhile (another operator closed it, a new delivery) the close is refused and re-previewed.
 */
export default function ClosingPage() {
  const { t } = useLang();
  const { can } = usePermissions();
  const canCourier = can('CLOSE_DRIVER_SETTLEMENTS');
  const canVendor = can('CLOSE_VENDOR_SETTLEMENTS');
  // permissions arrive after the first render: the default tab follows them until the user picks one
  const [picked, setTab] = useState<'courier' | 'vendor' | null>(null);
  const tab = picked ?? (canCourier ? 'courier' : 'vendor');
  const tabs = [
    ...(canCourier ? [{ id: 'courier', label: t('Courier financial closing', 'التقفيل المالي للمندوب') }] : []),
    ...(canVendor ? [{ id: 'vendor', label: t('Store period closing', 'تقفيل فترة المتجر') }] : []),
  ];
  return (
    <div className="max-w-6xl">
      <PageHeader
        title={t('Closing', 'التقفيل')}
        subtitle={t('Preview first, then confirm. A closing settles each order once and gets its own reference; payments are recorded on the saved statement.', 'عاين أولًا ثم أكّد. التقفيل يسوّي كل طلب مرة واحدة ويأخذ رقمًا مرجعيًا؛ وتُسجَّل المدفوعات على الكشف المحفوظ.')}
        actions={<Link href="/settlement-statements" className="text-sm font-medium text-hatly-orangeDark hover:underline">{t('Statements by period →', 'الكشوف حسب الفترة ←')}</Link>}
      />
      {tabs.length > 1 && <Tabs tabs={tabs} value={tab} onChange={(x) => setTab(x as 'courier' | 'vendor')} />}
      {tab === 'courier' ? <CourierClosing /> : <VendorClosing />}
    </div>
  );
}

function PartyPicker<T extends { id: string }>({ rows, loading, label, render, value, onPick, testId }: { rows: T[] | undefined; loading: boolean; label: (r: T) => string; render: (r: T) => React.ReactNode; value: string; onPick: (id: string) => void; testId: string }) {
  const { t } = useLang();
  const [q, setQ] = useState('');
  const list = (rows ?? []).filter((r) => !q.trim() || label(r).toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="space-y-2" data-testid={testId}>
      <LabeledInput label={t('Search', 'بحث')} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Name or phone', 'الاسم أو الهاتف')} />
      <ul className="max-h-72 divide-y divide-gray-100 overflow-auto rounded-lg border border-gray-200">
        {loading && <li className="px-3 py-2 text-sm text-gray-500">{t('Loading…', 'جارٍ التحميل…')}</li>}
        {!loading && list.length === 0 && <li className="px-3 py-2 text-sm text-gray-500">{t('Nothing found', 'لا نتائج')}</li>}
        {list.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => onPick(r.id)} className={`w-full px-3 py-2 text-start text-sm hover:bg-orange-50 ${value === r.id ? 'bg-orange-50 font-semibold' : ''}`} data-testid={`${testId}-${r.id}`}>
              {render(r)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CourierClosing() {
  const { t, money, dateTime } = useLang();
  const { can } = usePermissions();
  const couriers = useApi<any[]>('/admin/settlement/couriers/open');
  const [driverId, setDriverId] = useState('');
  const preview = useApi<any>(driverId ? `/admin/settlement/drivers/${driverId}/close-preview` : null);
  const [ack, setAck] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState<any>(null);
  const columns = useCourierLineColumns();
  const p = preview.data;
  const held = (p?.unresolved ?? []).filter((u: any) => u.reason !== 'IN_PROGRESS');
  const needsAck = (p?.unresolved?.length ?? 0) > 0;

  const close = async () => {
    setBusy(true); setError(null);
    try {
      const res = await send<any>('post', `/admin/settlement/drivers/${driverId}/close`, { previewToken: p.previewToken });
      setClosed(res); setConfirm(false); couriers.reload();
    } catch (e) {
      const code = apiErrorCode(e);
      setError(code === 'PREVIEW_CHANGED' || code === 'ALREADY_SETTLED'
        ? t('The orders changed since this preview (another closing or a new delivery). The preview was refreshed — review it and confirm again.', 'تغيّرت الطلبات منذ هذه المعاينة (تقفيل آخر أو تسليم جديد). حُدّثت المعاينة — راجعها وأكّد مرة أخرى.')
        : apiErrorMessage(e, t('The closing could not be saved.', 'تعذّر حفظ التقفيل.')));
      setConfirm(false); preview.reload();
    } finally { setBusy(false); }
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_1fr]">
      <Card title={t('Courier', 'المندوب')}>
        {couriers.error ? <ErrorState message={couriers.error} onRetry={couriers.reload} /> : (
          <PartyPicker rows={couriers.data} loading={couriers.loading} value={driverId} testId="courier-picker"
            label={(c: any) => `${c.name} ${c.phone ?? ''}`}
            onPick={(id) => { setDriverId(id); setClosed(null); setAck(false); setError(null); }}
            render={(c: any) => (<span className="flex items-center justify-between gap-2"><bdi>{c.name}</bdi><span className="flex gap-1">{c.deliveredOpen > 0 && <Badge tone="orange">{t(`${c.deliveredOpen} to close`, `${c.deliveredOpen} للتقفيل`)}</Badge>}{c.inProgress > 0 && <Badge>{t(`${c.inProgress} on road`, `${c.inProgress} بالطريق`)}</Badge>}</span></span>)} />
        )}
      </Card>

      <div className="space-y-4">
        {!driverId && <p className="rounded-lg bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">{t('Choose a courier to preview their shift.', 'اختر مندوبًا لمعاينة ورديته.')}</p>}
        {closed && (
          <div role="status" className="rounded-xl border border-green-200 bg-green-50 p-4" data-testid="courier-closed">
            <p className="font-semibold text-green-900">{t('Financial closing saved', 'تم التقفيل المالي')} · <bdi className="font-mono">{closed.reference}</bdi></p>
            <p className="mt-1 text-sm text-green-900">{dateTime(closed.periodStart)} → {dateTime(closed.periodEnd)} · {t(`${closed.totals.orders} orders`, `${closed.totals.orders} طلب`)} · <CourierNet minor={closed.netPayableMinor} /></p>
            <Link href={`/settlements/driver/${closed.id}`} className="mt-2 inline-block text-sm font-medium text-hatly-orangeDark hover:underline">{t('Open the saved statement (record payments) →', 'افتح الكشف المحفوظ (تسجيل المدفوعات) ←')}</Link>
          </div>
        )}
        {driverId && preview.error && <ErrorState message={preview.error} onRetry={preview.reload} />}
        {driverId && p && !closed && (
          <>
            <Card title={t(`Preview — ${p.courier.name}`, `معاينة — ${p.courier.name}`)} testId="courier-preview">
              <p className="mb-3 text-xs text-gray-500">
                {p.previousClosing ? t(`Since the previous closing ${p.previousClosing.reference} (${dateTime(p.previousClosing.periodEnd)}) until now.`, `من التقفيل السابق ${p.previousClosing.reference} (${dateTime(p.previousClosing.periodEnd)}) حتى الآن.`) : t('First closing for this courier: every delivered order not settled before.', 'أول تقفيل لهذا المندوب: كل طلب مُسلّم لم يُسوَّ من قبل.')}
                {p.courier.commissionRateBasisPoints == null && <span className="ms-2 font-semibold text-red-700">{t('This courier has no commission rate: their orders cannot be settled.', 'لا توجد نسبة عمولة لهذا المندوب: لا يمكن تسوية طلباته.')}</span>}
              </p>
              <div className="grid gap-4 md:grid-cols-[1fr_16rem]">
                <CourierBreakdown totals={p.totals} testId="courier-preview-totals" />
                <div className="rounded-lg bg-gray-50 p-3 text-sm">
                  <p>{t('Orders to settle', 'طلبات للتسوية')}: <strong>{p.totals.orders}</strong></p>
                  <p>{t('Cash orders', 'طلبات نقدية')}: {p.totals.codOrders} · {t('Electronic', 'إلكترونية')}: {p.totals.electronicOrders}</p>
                  <p className="mt-2 text-xs text-gray-500">{t('Cash orders: the goods were collected from the customer and paid to the store, so they are not in the net; the courier keeps the delivery fee and owes Hatly its commission. Electronic orders: Hatly owes the courier the goods he paid plus the fee, less the commission.', 'الطلبات النقدية: البضاعة حُصّلت من العميل ودُفعت للمتجر فهي خارج الصافي؛ المندوب يحتفظ برسوم التوصيل ويدين لـHatly بعمولتها. الطلبات الإلكترونية: Hatly تدين للمندوب بالبضاعة التي دفعها والرسوم ناقص العمولة.')}</p>
                </div>
              </div>
            </Card>
            {Array.isArray(p.shifts) && p.shifts.length > 0 && (
              <Card title={t('Shifts this closing covers', 'الورديات التي يغطيها هذا التقفيل')} testId="courier-shifts">
                <ul className="divide-y divide-gray-100 text-sm">
                  {p.shifts.map((s: any) => (
                    <li key={s.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                      <span className="text-gray-600">{dateTime(s.reconciledFrom ?? s.startedAt)} → {dateTime(s.reconciledTo ?? s.endedAt) + (s.endedAt ? '' : ' · ' + t('open — duty continues', 'مفتوحة — تستمر الوردية'))}</span>
                      <span className="tabular-nums font-medium">{Math.floor(s.minutes / 60)}{t('h', 'س')} {s.minutes % 60}{t('m', 'د')}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {p.lines.length > 0 && p.allowance?.outstandingMinor > 0 && (
              <Card title={t('Daily allowance to return', 'العهدة اليومية المطلوب ردّها')} testId="courier-allowance">
                <p className="text-sm text-gray-700">{t(`The courier holds ${money(p.allowance.outstandingMinor)} of daily allowance; this closing marks it as returned.`, `مع المندوب ${money(p.allowance.outstandingMinor)} عهدة يومية؛ هذا التقفيل يسجّلها كمردودة.`)}</p>
                <p className="mt-1 text-sm font-semibold">{p.allowance.cashToSettleMinor < 0 ? t('Total to receive from the courier', 'الإجمالي المطلوب استلامه من المندوب') : t('Total to pay the courier', 'الإجمالي المطلوب دفعه للمندوب')}: <span className="tabular-nums">{money(Math.abs(p.allowance.cashToSettleMinor))}</span></p>
              </Card>
            )}
            {p.loans?.outstandingMinor > 0 && (
              <Card title={t('Loans the courier still owes', 'سلف مستحقة على المندوب')} testId="courier-loans">
                <p className="text-sm text-gray-700">{t(`Collect ${money(p.loans.outstandingMinor)} in loans at this settlement and record the repayment. The closing amounts above do not include loans.`, `حصّل ${money(p.loans.outstandingMinor)} من السلف في هذه التسوية وسجّل السداد. مبالغ التقفيل أعلاه لا تشمل السلف.`)}</p>
                <ul className="mt-2 divide-y divide-gray-100 text-sm">
                  {p.loans.items.map((l: any) => (
                    <li key={l.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                      <span className="text-gray-600">{new Date(l.issuedAt).toLocaleDateString()}{l.reason ? ` · ${l.reason}` : ''}</span>
                      <span className="tabular-nums font-medium">{money(l.outstandingMinor)} <span className="text-gray-400">/ {money(l.borrowedMinor)}</span></span>
                    </li>
                  ))}
                </ul>
                <Link href={`/employee-loans?person=${p.courier?.userId ?? ''}`} className="mt-2 inline-block text-sm font-medium text-hatly-orangeDark hover:underline">{t('Record a repayment →', 'تسجيل سداد ←')}</Link>
              </Card>
            )}
            <Card title={t('Orders in this closing', 'طلبات هذا التقفيل')} pad={false}>
              <DataTable rows={p.lines} rowKey={(x: any) => x.orderId} columns={columns} emptyTitle={t('No delivered orders to settle', 'لا توجد طلبات مُسلّمة للتسوية')} emptyHint=" " />
            </Card>
            {p.unresolved.length > 0 && (
              <Card title={t(`Held for the next closing (${p.unresolved.length})`, `طلبات مؤجلة للتقفيلة التالية (${p.unresolved.length})`)}>
                <UnresolvedList items={p.unresolved} />
                {can('ADJUST_DRIVER_FINANCES') && held.some((u: any) => u.reason === 'RATE_UNDEFINED') && <CommissionRepair key={driverId} driverId={driverId} orders={held.filter((u: any) => u.reason === 'RATE_UNDEFINED')} onSaved={preview.reload} />}
                {held.length > 0 && <p className="mt-2 text-xs text-gray-500">{t('They are not settled now and will appear again in the next closing once resolved. Cash exposure limits still apply to new assignments.', 'لا تُسوّى الآن وتظهر في التقفيل التالي بعد حلّها. تظل حدود النقدية سارية على الإسناد الجديد.')}</p>}
              </Card>
            )}
            {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" data-testid="courier-close-error">{error}</p>}
            <div className="flex flex-wrap items-center justify-end gap-3">
              {needsAck && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="courier-ack" />{t('I reviewed the held orders', 'راجعت الطلبات المؤجلة')}</label>}
              <Button variant="primary" className="min-h-[44px]" disabled={(p.lines.length === 0 && !p.shifts?.some((s: any) => s.endedAt != null)) || (needsAck && !ack)} onClick={() => setConfirm(true)} data-testid="courier-confirm">{t('Confirm closing', 'تأكيد التقفيل')}</Button>
            </div>
            <ConfirmDialog open={confirm} title={t('Confirm this financial closing?', 'تأكيد هذا التقفيل المالي؟')}
              message={`${t(`${p.totals.orders} orders`, `${p.totals.orders} طلب`)} · ${p.totals.netToCourierMinor >= 0 ? t('owed to the courier', 'مستحق للمندوب') : t('owed by the courier', 'مستحق على المندوب')} ${money(Math.abs(p.totals.netToCourierMinor))}. ${t('A closing cannot be edited; corrections are new entries.', 'لا يُعدَّل التقفيل؛ التصحيح يكون بقيد جديد.')}`}
              confirmLabel={t('Confirm financial closing', 'تأكيد التقفيل المالي')} busy={busy} onConfirm={() => void close()} onClose={() => setConfirm(false)} />
          </>
        )}
      </div>
    </div>
  );
}

function CommissionRepair({driverId,orders,onSaved}:{driverId:string;orders:any[];onSaved:()=>void}) {
  const { t,money }=useLang();
  const [selected,setSelected]=useState<string[]>([]);
  const [rate,setRate]=useState('');
  const [reason,setReason]=useState('');
  const [review,setReview]=useState<any>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const rateBasisPoints=Math.round(Number(rate)*100);
  const valid=selected.length>0 && rate.trim()!=='' && Number.isFinite(Number(rate)) && rateBasisPoints>=0 && rateBasisPoints<=10000;
  const body={orderNumbers:selected,rateBasisPoints};
  const request=async(apply:boolean)=>{
    setBusy(true);setError(null);
    try {
      const result=await send<any>('post',`/admin/settlement/drivers/${driverId}/commission-repair${apply?'':'-preview'}`,
        apply?{...body,previewToken:review.previewToken,reason}:body);
      if(apply){setReview(null);setSelected([]);setReason('');onSaved();}else setReview(result);
    } catch(e){setReview(null);setError(apiErrorMessage(e,t('Correction could not be saved.','تعذّر حفظ التصحيح.')));}
    finally{setBusy(false);}
  };
  return <div className="mt-4 space-y-3 rounded-lg border border-gray-200 p-3">
    <p className="font-semibold">{t('Repair missing commission (audited)','تصحيح العمولة المفقودة (مدقق)')}</p>
    <p className="text-xs text-gray-500">{t('Select exact delivered orders. This appends only missing commission entries; it does not close orders, change future rates or record payment.','اختر الطلبات المسلّمة المحددة. يضيف التصحيح القيود المفقودة فقط دون تقفيل أو تغيير النسب المستقبلية أو تسجيل دفعة.')}</p>
    {orders.map(o=><label key={o.orderNumber} className="flex gap-2 text-sm"><input type="checkbox" disabled={busy} checked={selected.includes(o.orderNumber)} onChange={e=>{setSelected(v=>e.target.checked?[...v,o.orderNumber]:v.filter(n=>n!==o.orderNumber));setReview(null);}}/>{o.orderNumber}</label>)}
    <LabeledInput label={t('Explicit commission %','نسبة العمولة المحددة %')} type="number" min="0" max="100" step="0.01" value={rate} onChange={e=>{setRate(e.target.value);setReview(null);}}/>
    <Button disabled={!valid||busy} onClick={()=>void request(false)}>{t('Preview correction','معاينة التصحيح')}</Button>
    {review&&<div className="space-y-2">
      {review.rows.map((r:any)=><p key={r.orderId} className="text-sm">{r.orderNumber} · {t('Driver fee','أجر المندوب')} {money(r.driverCompensationMinor)} · {t('Commission','العمولة')} {money(r.commissionMinor)} · {t('Hatly premium','عائد هاتلي')} {money(r.hatlyServiceRevenueMinor)}</p>)}
      <LabeledInput label={t('Audit reason / evidence reference','سبب التصحيح / مرجع الإثبات')} value={reason} onChange={e=>setReason(e.target.value)}/>
      <Button variant="primary" disabled={busy||reason.trim().length<10} onClick={()=>void request(true)}>{t('Confirm append-only correction','تأكيد التصحيح بقيد جديد')}</Button>
    </div>}
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
  </div>;
}

function VendorClosing() {
  const { t, money, dateTime } = useLang();
  const branches = useApi<any[]>('/admin/settlement/vendor-branches/open');
  const [branchId, setBranchId] = useState('');
  const [end, setEnd] = useState('');
  const preview = useApi<any>(branchId ? `/admin/settlement/vendor-branches/${branchId}/close-preview` : null, { periodEnd: end || undefined });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState<any>(null);
  const p = preview.data;
  const columns = useMemo(() => [
    { key: 'o', header: t('Order', 'الطلب'), cell: (x: any) => <Link className="text-hatly-orangeDark hover:underline" href={`/order-search/${x.orderId}`}><bdi>{x.orderNumber}</bdi></Link> },
    { key: 'at', header: t('Handed over', 'التسليم من المتجر'), cell: (x: any) => dateTime(x.handedOverAt) },
    { key: 'f', header: t('Type', 'النوع'), cell: (x: any) => (x.fulfillmentType === 'PICKUP' ? t('Pickup', 'استلام') : t('Delivery', 'توصيل')) },
    { key: 's', header: t('Sales', 'المبيعات'), align: 'end' as const, cell: (x: any) => money(x.segmentSubtotalMinor) },
    { key: 'c', header: t('Commission owed by the store', 'عمولة مستحقة على المتجر'), align: 'end' as const, cell: (x: any) => (x.rateUndefined ? <Badge tone="red">{t('Rate not set', 'نسبة غير محددة')}</Badge> : money(x.commissionMinor)) },
  ], [t, money, dateTime]);

  const close = async () => {
    setBusy(true); setError(null);
    try {
      const res = await send<any>('post', `/admin/settlement/vendor-branches/${branchId}/close`, { previewToken: p.previewToken, ...(end ? { periodEnd: end } : {}) });
      setClosed(res); setConfirm(false); branches.reload();
    } catch (e) {
      const code = apiErrorCode(e);
      setError(code === 'PREVIEW_CHANGED' || code === 'ALREADY_SETTLED'
        ? t('The store parts changed since this preview. The preview was refreshed — review it and confirm again.', 'تغيّرت أجزاء المتجر منذ هذه المعاينة. حُدّثت المعاينة — راجعها وأكّد مرة أخرى.')
        : apiErrorMessage(e, t('The closing could not be saved.', 'تعذّر حفظ التقفيل.')));
      setConfirm(false); preview.reload();
    } finally { setBusy(false); }
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_1fr]">
      <Card title={t('Store branch', 'فرع المتجر')}>
        {branches.error ? <ErrorState message={branches.error} onRetry={branches.reload} /> : (
          <PartyPicker rows={branches.data} loading={branches.loading} value={branchId} testId="branch-picker"
            label={(b: any) => `${b.vendorName} ${b.vendorNameAr ?? ''} ${b.branchName}`}
            onPick={(id) => { setBranchId(id); setClosed(null); setError(null); }}
            render={(b: any) => (<span className="flex items-center justify-between gap-2"><bdi>{b.vendorName} — {b.branchName}</bdi>{b.partsOpen > 0 && <Badge tone="orange">{t(`${b.partsOpen} to close`, `${b.partsOpen} للتقفيل`)}</Badge>}</span>)} />
        )}
      </Card>
      <div className="space-y-4">
        {!branchId && <p className="rounded-lg bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">{t('Choose a store branch to preview its period.', 'اختر فرع متجر لمعاينة فترته.')}</p>}
        {closed && (
          <div role="status" className="rounded-xl border border-green-200 bg-green-50 p-4" data-testid="vendor-closed">
            <p className="font-semibold text-green-900">{t('Period closed', 'تم تقفيل الفترة')} · <bdi className="font-mono">{closed.reference}</bdi></p>
            <p className="mt-1 text-sm text-green-900">{dateTime(closed.periodStart)} → {dateTime(closed.periodEnd)} · {t('Commission owed by the store', 'عمولة مستحقة على المتجر')} {money(closed.totalCommissionOwedMinor)}</p>
            <Link href={`/settlements/vendor/${closed.id}`} className="mt-2 inline-block text-sm font-medium text-hatly-orangeDark hover:underline">{t('Open the saved statement (record collection) →', 'افتح الكشف المحفوظ (تسجيل التحصيل) ←')}</Link>
          </div>
        )}
        {branchId && !closed && (
          <Card>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-56"><LabeledInput type="date" label={t('Period ends (end of day, Cairo) — optional', 'نهاية الفترة (آخر اليوم بتوقيت القاهرة) — اختياري')} value={end} max={cairoDate(0)} onChange={(e) => setEnd(e.target.value)} data-testid="vendor-period-end" /></div>
              <p className="text-xs text-gray-500">{t('Empty = up to now. Parts handed over after the end stay for the next period.', 'فارغ = حتى الآن. الأجزاء المسلّمة بعد النهاية تبقى للفترة التالية.')}</p>
            </div>
          </Card>
        )}
        {branchId && preview.error && <ErrorState message={preview.error} onRetry={preview.reload} />}
        {branchId && p && !closed && (
          <>
            <Card title={t(`Preview — ${p.branch.vendorName} — ${p.branch.branchName}`, `معاينة — ${p.branch.vendorNameAr ?? p.branch.vendorName} — ${p.branch.branchName}`)} testId="vendor-preview">
              <p className="mb-3 text-xs text-gray-500">{p.previousClosing ? `${t('From', 'من')} ${p.previousClosing.reference} (${dateTime(p.previousClosing.periodEnd)})` : t('First closing for this branch', 'أول تقفيل لهذا الفرع')} → {dateTime(p.periodEnd)}</p>
              <dl className="grid gap-3 sm:grid-cols-4 text-sm">
                <div className="rounded-lg bg-gray-50 p-3"><dt className="text-xs text-gray-500">{t('Orders', 'الطلبات')}</dt><dd className="text-lg font-semibold">{p.totals.orders}</dd></div>
                <div className="rounded-lg bg-gray-50 p-3"><dt className="text-xs text-gray-500">{t('Gross sales', 'إجمالي المبيعات')}</dt><dd className="text-lg font-semibold tabular-nums">{money(p.totals.grossSalesMinor)}</dd></div>
                <div className="rounded-lg bg-red-50 p-3"><dt className="text-xs text-red-800">{t('Owed by the store (Hatly commission)', 'مستحق على المتجر (عمولة Hatly)')}</dt><dd className="text-lg font-semibold tabular-nums text-red-800" data-testid="vendor-preview-commission">{money(p.totals.commissionOwedByVendorMinor)}</dd></div>
                <div className="rounded-lg bg-gray-50 p-3"><dt className="text-xs text-gray-500">{t('Owed to the store (collected by Hatly)', 'مستحق للمتجر (حصّلته Hatly)')}</dt><dd className="text-lg font-semibold tabular-nums">{money(p.totals.collectedByHatlyForVendorMinor)}</dd></div>
              </dl>
              <p className="mt-2 text-xs text-gray-500">{t('The courier pays the store for the goods at pickup (R25/R26), so Hatly holds no store money; commission is collected separately and never netted (R32). Refunds do not reverse commission (R34).', 'المندوب يدفع للمتجر ثمن البضاعة عند الاستلام (R25/R26) فلا تحتفظ Hatly بأموال للمتجر؛ والعمولة تُحصَّل منفصلة دون مقاصة (R32). الاسترداد لا يعكس العمولة (R34).')}</p>
              {p.totals.rateUndefinedParts > 0 && <p role="alert" className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t(`${p.totals.rateUndefinedParts} part(s) had no commission rate (R43): included in sales, no commission assumed.`, `${p.totals.rateUndefinedParts} جزء بلا نسبة عمولة (R43): ضمن المبيعات دون افتراض عمولة.`)}</p>}
            </Card>
            <Card title={t('Store parts in this closing', 'أجزاء المتجر في هذا التقفيل')} pad={false}>
              <DataTable rows={p.lines} rowKey={(x: any) => x.segmentId} columns={columns} emptyTitle={t('Nothing handed over in this period', 'لا شيء سُلّم في هذه الفترة')} emptyHint=" " />
            </Card>
            {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <div className="flex justify-end">
              <Button variant="primary" className="min-h-[44px]" disabled={p.lines.length === 0} onClick={() => setConfirm(true)} data-testid="vendor-confirm">{t('Confirm closing', 'تأكيد التقفيل')}</Button>
            </div>
            <ConfirmDialog open={confirm} title={t('Confirm this store period closing?', 'تأكيد تقفيل فترة المتجر؟')}
              message={`${t(`${p.totals.parts} part(s)`, `${p.totals.parts} جزء`)} · ${t('commission owed by the store', 'عمولة مستحقة على المتجر')} ${money(p.totals.commissionOwedByVendorMinor)}. ${t('A closing cannot be edited.', 'لا يُعدَّل التقفيل.')}`}
              confirmLabel={t('Close the period', 'تقفيل الفترة')} busy={busy} onConfirm={() => void close()} onClose={() => setConfirm(false)} />
          </>
        )}
      </div>
    </div>
  );
}
