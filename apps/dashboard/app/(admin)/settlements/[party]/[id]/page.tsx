'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Async, Button, Card, ConfirmDialog, DataTable, LabeledInput, LabeledSelect, LabeledTextarea, Modal, PageHeader, StatusPill, cairoDate, useToast } from '../../../../../components/ui';
import { newKey, send, useApi } from '../../../../../lib/ui/api';
import { apiErrorCode, apiErrorMessage } from '../../../../../lib/api/errors';
import { parseEgpToMinor } from '../../../../../lib/money';
import { useLang } from '../../../../../lib/ui/lang';
import { usePermissions } from '../../../../../lib/ui/permissions';
import { ExportButton } from '../../../../../components/reports/ExportButton';
import { FINANCIAL_EVENT_TYPE, label } from '../../../../../lib/admin/labels';
import { CourierBreakdown, useCourierLineColumns } from '../../../../../components/settlement/CourierMoney';

/** The Cairo calendar day of an instant (report ranges are Cairo dates). */
const cairoDay = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }) : undefined);

export default function SettlementStatementPage() {
  const { t, money, date, dateTime } = useLang();
  const { can } = usePermissions();
  const toast = useToast();
  const { party, id } = useParams<{ party: string; id: string }>();
  const st = useApi<any>(`/admin/settlements/${party}-periods/${id}`);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(cairoDate(0));
  const [over, setOver] = useState(false);
  const [overReason, setOverReason] = useState('');
  const [key, setKey] = useState(newKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voidId, setVoidId] = useState<string | null>(null);
  const [voidBusy, setVoidBusy] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);
  const d = st.data;
  const p = d?.period;
  const canPay = can('MANAGE_SETTLEMENT_PAYMENTS');
  const courierColumns = useCourierLineColumns();
  const v2 = p?.methodVersion === 2;

  const record = async () => {
    const parsed = parseEgpToMinor(amount);
    if (!parsed.ok) { setError(t('Enter a valid amount (up to two decimals).', 'أدخل مبلغًا صحيحًا (حتى خانتين عشريتين).')); return; }
    setBusy(true); setError(null);
    try {
      await send('post', `/admin/settlements/${party}/periods/${id}/payments`, { amountMinor: parsed.minor, method, reference: reference || undefined, paidOn, allowOverpayment: over || undefined, overpaymentReason: over ? overReason : undefined }, { 'Idempotency-Key': key });
      toast.push('success', t('Payment recorded.', 'تم تسجيل الدفعة.'));
      setOpen(false); setAmount(''); setReference(''); setOver(false); setOverReason(''); setKey(newKey());
      st.reload();
    } catch (e) {
      const code = apiErrorCode(e);
      setError(code === 'EXCEEDS_REMAINING' ? t('The amount is more than what is still due. Tick “authorised overpayment” and give a reason if this is intended (needs the overpayment authority).', 'المبلغ أكبر من المتبقي. فعّل «زيادة مصرّح بها» واذكر السبب إن كان مقصودًا (يحتاج صلاحية التفويض).') : apiErrorMessage(e, t('The payment could not be recorded.', 'تعذّر تسجيل الدفعة.')));
    } finally { setBusy(false); }
  };
  const doVoid = async (reason: string) => {
    setVoidBusy(true); setVoidError(null);
    try { await send('post', `/admin/settlement-payments/${voidId}/void`, { reason }); toast.push('success', t('Payment voided (kept on record).', 'أُلغيت الدفعة (مع بقائها في السجل).')); setVoidId(null); st.reload(); }
    catch (e) { setVoidError(apiErrorMessage(e, t('Could not void.', 'تعذّر الإلغاء.'))); } finally { setVoidBusy(false); }
  };

  return (
    <div>
      <PageHeader
        title={t('Settlement statement', 'كشف التسوية')}
        subtitle={p ? `${p.reference ? `${p.reference} · ` : ''}${party === 'vendor' ? `${p.vendorName} — ${p.partyName}` : p.partyName} · ${dateTime(p.periodStart)} → ${dateTime(p.periodEnd)}` : undefined}
        actions={<><Link href="/settlements" className="text-sm text-gray-600 hover:underline">{t('← All periods', '← كل الفترات')}</Link>{canPay && p && p.remainingMinor > 0 && <Button variant="primary" onClick={() => setOpen(true)}>{p.direction === 'COLLECTION' ? t('Record collection', 'تسجيل تحصيل') : t('Record payout', 'تسجيل دفعة')}</Button>}</>}
      />
      <Async state={st}>
        {d && (
          <div className="space-y-4">
            <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-900">{d.accountingNote}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {[[party === 'vendor' ? 'Commission due to Hatly' : 'Net payable', party === 'vendor' ? 'العمولة المستحقة لحاتلي' : 'صافي المستحق', money(party === 'vendor' ? p.commissionMinor : p.netPayableMinor)], ['Settled', 'المسدد', money(p.settledMinor)], ['Remaining', 'المتبقي', money(p.remainingMinor)], ['Direction', 'الاتجاه', p.direction === 'COLLECTION' ? t('Collect from the party', 'تحصيل من الطرف') : t('Pay the party', 'دفع للطرف')], ['Status', 'الحالة', '']].map(([en, ar, v]) => (
                <div key={en} className="rounded-xl border border-gray-200 bg-white p-4"><p className="text-xs text-gray-500">{t(en, ar)}</p><p className="mt-1 text-lg font-semibold">{en === 'Status' ? <StatusPill status={p.paymentStatus} /> : v}</p></div>
              ))}
            </div>
            {party === 'driver' && v2 && <Card title={t('Closing breakdown', 'تفصيل التقفيل')}><CourierBreakdown totals={{ ...p, feeEntitlementMinor: p.totalEarningsMinor, commissionMinor: p.commissionMinor, netToCourierMinor: p.netPayableMinor }} testId="period-breakdown" /></Card>}
            {party === 'vendor' ? <p className="text-xs text-gray-500">{t('Gross sales for reference only', 'إجمالي المبيعات للاطلاع فقط')}: {money(p.grossSalesMinor)}</p> : v2 ? null : <p className="text-xs text-gray-500">{t('Earnings', 'الأرباح')} {money(p.totalEarningsMinor)} − {t('commission', 'العمولة')} {money(p.commissionMinor)} + {t('reimbursements', 'التعويضات')} {money(p.reimbursementsMinor)}</p>}
            {d.exceptions.length > 0 && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{t('This statement has exceptions:', 'يوجد استثناءات في هذا الكشف:')} {d.exceptions.join(' · ')}</p>}
            <Card title={t('Payments', 'المدفوعات')} pad={false}>
              <DataTable rows={d.payments} rowKey={(x: any) => x.id} emptyTitle={t('No payments recorded yet', 'لا توجد مدفوعات مسجلة بعد')} emptyHint=" " columns={[
                { key: 'on', header: t('Paid on', 'تاريخ الدفع'), cell: (x: any) => date(x.paidOn) },
                { key: 'dir', header: t('Direction', 'الاتجاه'), cell: (x: any) => x.direction },
                { key: 'm', header: t('Method / reference', 'الطريقة / المرجع'), cell: (x: any) => <bdi>{x.method}{x.reference ? ` · ${x.reference}` : ''}</bdi> },
                { key: 'by', header: t('Recorded by', 'سجّلها'), cell: (x: any) => <bdi>{x.recordedBy}</bdi> },
                { key: 'amt', header: t('Amount', 'المبلغ'), align: 'end', cell: (x: any) => <span className={x.status === 'VOIDED' ? 'line-through text-gray-400' : ''}>{money(x.amountMinor)}</span> },
                { key: 'st', header: t('Status', 'الحالة'), cell: (x: any) => <span className="flex flex-wrap items-center gap-1"><StatusPill status={x.status} />{x.overpaymentAuthorised && <StatusPill status="OVERPAID" label={t('Authorised overpayment', 'زيادة مصرّح بها')} />}</span> },
                { key: 'v', header: '', align: 'end', cell: (x: any) => x.status === 'RECORDED' && canPay ? <Button size="sm" onClick={() => setVoidId(x.id)}>{t('Void', 'إلغاء')}</Button> : x.voidReason ? <span className="text-xs text-gray-400" title={x.voidReason}><bdi>{x.voidReason}</bdi></span> : null },
              ]} />
            </Card>
            <Card title={party === 'vendor' ? t('Contributing orders', 'الطلبات المساهمة') : t('Contributing ledger lines', 'القيود المساهمة')} pad={false}>
              <DataTable rows={d.lines} rowKey={(x: any, ) => `${x.orderId}${x.eventId ?? ''}${x.at}`} emptyTitle={t('No lines', 'لا توجد بنود')} emptyHint=" " columns={party === 'vendor' ? [
                { key: 'o', header: t('Order', 'الطلب'), cell: (x: any) => <Link className="text-hatly-orangeDark hover:underline" href={`/order-search/${x.orderId}`}><bdi>{x.orderNumber}</bdi></Link> },
                { key: 'at', header: t('Time', 'الوقت'), cell: (x: any) => dateTime(x.at) },
                { key: 's', header: t('Part subtotal', 'مجموع الجزء'), align: 'end', cell: (x: any) => money(x.segmentSubtotalMinor) },
                { key: 'c', header: t('Commission', 'العمولة'), align: 'end', cell: (x: any) => (x.rateUndefined ? t('Rate not set', 'نسبة غير محددة') : money(x.commissionMinor)) },
              ] : v2 ? courierColumns : [
                { key: 'o', header: t('Order', 'الطلب'), cell: (x: any) => <bdi>{x.orderNumber ?? '—'}</bdi> },
                { key: 'at', header: t('Time', 'الوقت'), cell: (x: any) => dateTime(x.at) },
                { key: 't', header: t('Type', 'النوع'), cell: (x: any) => label(FINANCIAL_EVENT_TYPE, x.type, t) },
                { key: 'e', header: t('Earnings', 'الأرباح'), align: 'end', cell: (x: any) => (x.earningsMinor === null ? '—' : money(x.earningsMinor)) },
                { key: 'a', header: t('Amount', 'المبلغ'), align: 'end', cell: (x: any) => money(x.amountMinor) },
              ]} />
            </Card>
            {can('FINANCE_EXPORT') && <div className="flex justify-end gap-2">{v2 && p.reference && <ExportButton report={party === 'vendor' ? 'S27' : 'S26'} params={{ from: cairoDay(p.closedAt), to: cairoDay(p.closedAt), reference: p.reference }} label={t('Export this closing', 'تصدير هذا التقفيل')} />}<ExportButton report={party === 'vendor' ? 'S15' : 'S11'} params={{}} label={t('Export statements (all periods)', 'تصدير الكشوف (كل الفترات)')} /></div>}
          </div>
        )}
      </Async>
      <Modal open={open} title={t('Record a payment against this closed period', 'تسجيل دفعة على هذه الفترة المغلقة')} onClose={() => !busy && setOpen(false)} footer={<><Button onClick={() => setOpen(false)} disabled={busy}>{t('Cancel', 'إلغاء')}</Button><Button variant="primary" loading={busy} onClick={record}>{t('Record', 'تسجيل')}</Button></>}>
        {p && <p className="text-sm text-gray-600">{t('Still due', 'المتبقي')}: <strong>{money(p.remainingMinor)}</strong> ({p.direction === 'COLLECTION' ? t('collection', 'تحصيل') : t('payout', 'دفع')})</p>}
        <div className="grid grid-cols-2 gap-3">
          <LabeledInput label={t('Amount (EGP)', 'المبلغ (ج.م)')} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <LabeledInput type="date" label={t('Paid on (Cairo)', 'تاريخ الدفع (القاهرة)')} value={paidOn} max={cairoDate(0)} onChange={(e) => setPaidOn(e.target.value)} />
          <LabeledSelect label={t('Method', 'الطريقة')} value={method} onChange={(e) => setMethod(e.target.value)}><option value="BANK_TRANSFER">{t('Bank transfer', 'تحويل بنكي')}</option><option value="CASH">{t('Cash', 'نقدًا')}</option><option value="WALLET_TRANSFER">{t('Mobile wallet', 'محفظة إلكترونية')}</option><option value="NETTED">{t('Netted against another amount', 'مقاصة')}</option></LabeledSelect>
          <LabeledInput label={t('Reference', 'المرجع')} value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
        {can('APPROVE_SETTLEMENT_OVERPAYMENT') && (
          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={over} onChange={(e) => setOver(e.target.checked)} />{t('Authorised overpayment (more than is due)', 'زيادة مصرّح بها (أكثر من المستحق)')}</label>
            {over && <LabeledTextarea label={t('Reason (required)', 'السبب (مطلوب)')} value={overReason} onChange={(e) => setOverReason(e.target.value)} rows={2} />}
          </div>
        )}
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </Modal>
      <ConfirmDialog open={Boolean(voidId)} title={t('Void this payment?', 'إلغاء هذه الدفعة؟')} message={t('The payment stays on record as voided; the period status is recalculated. A void can be done once and is audited.', 'تبقى الدفعة في السجل كملغاة وتُعاد حالة الفترة. الإلغاء مرة واحدة ومُدقَّق.')} confirmLabel={t('Void payment', 'إلغاء الدفعة')} danger reasonLabel={t('Reason', 'السبب')} reasonMin={5} busy={voidBusy} error={voidError} onConfirm={doVoid} onClose={() => setVoidId(null)} />
    </div>
  );
}
