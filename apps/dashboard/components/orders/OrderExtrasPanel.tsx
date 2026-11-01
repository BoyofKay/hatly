'use client';

import { useState } from 'react';
import { Async, Badge, Button, Card, ConfirmDialog, LabeledInput, LabeledSelect, LabeledTextarea, Modal, StatusPill, useToast } from '../ui';
import { send, useApi } from '../../lib/ui/api';
import { apiErrorCode, apiErrorMessage } from '../../lib/api/errors';
import { useLang } from '../../lib/ui/lang';
import { usePermissions } from '../../lib/ui/permissions';

const REASONS: Array<[string, string, string]> = [
  ['CUSTOMER_REQUEST', 'Customer request', 'طلب العميل'], ['VENDOR_UNAVAILABLE', 'Vendor unavailable', 'المورد غير متاح'], ['OUT_OF_STOCK', 'Out of stock', 'نفاد المخزون'],
  ['PAYMENT_ISSUE', 'Payment issue', 'مشكلة في الدفع'], ['FRAUD_SUSPECTED', 'Suspected fraud', 'اشتباه احتيال'], ['OPERATIONAL_ISSUE', 'Operational issue', 'مشكلة تشغيلية'], ['OTHER', 'Other', 'أخرى'],
];

/** Timeline, internal notes and administrative cancel for the order detail page. Cancel uses the ordinary cancellation on the server (refund, stock, coupon restoration); this UI computes no money. */
export function OrderExtrasPanel({ orderId, onChanged }: { orderId: string; status: string; onChanged: () => void }) {
  const { t, locale, dateTime, money } = useLang();
  const { can } = usePermissions();
  const toast = useToast();
  const timeline = useApi<any[]>(`/admin/orders/${orderId}/timeline`);
  const notes = useApi<any[]>(`/admin/orders/${orderId}/notes`);
  const caps = useApi<any>(`/admin/orders/${orderId}/capabilities`);
  const [note, setNote] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('CUSTOMER_REQUEST');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<any>(null);
  const canIssues = can('MANAGE_ORDER_ISSUES');

  const addNote = async () => {
    setNoteBusy(true);
    try { await send('post', `/admin/orders/${orderId}/notes`, { body: note }); setNote(''); notes.reload(); timeline.reload(); toast.push('success', t('Note added.', 'أُضيفت الملاحظة.')); }
    catch (e) { toast.push('error', apiErrorMessage(e, t('Could not add the note.', 'تعذّر إضافة الملاحظة.'))); } finally { setNoteBusy(false); }
  };
  const cancel = async () => {
    setBusy(true); setError(null);
    try {
      const r = await send<any>('post', `/admin/orders/${orderId}/cancel`, { reasonCode: reason, reasonText: text || undefined });
      setOutcome(r); setCancelOpen(false); onChanged(); timeline.reload(); caps.reload();
    } catch (e) {
      setError(apiErrorCode(e) === 'STATE_CONFLICT' ? t('This order can no longer be cancelled from here (a driver is assigned or it is finished). Use the failed-delivery resolution.', 'لا يمكن إلغاء هذا الطلب من هنا (تم تعيين سائق أو انتهى). استخدم حل التوصيل الفاشل.') : apiErrorMessage(e, t('Could not cancel the order.', 'تعذّر إلغاء الطلب.')));
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4" data-testid="order-extras">
      {canIssues && caps.data?.adminCanCancel && (
        <Card title={t('Cancel this order', 'إلغاء هذا الطلب')}>
          <p className="mb-3 text-xs text-gray-600">{t('Cancelling follows the standard cancellation: stock is restored, the refund is created according to how the customer paid, and Hatly-funded discounts and coupon uses are given back exactly once.', 'يتبع الإلغاء المسار المعتمد: يُستعاد المخزون، ويُنشأ الاسترداد حسب طريقة دفع العميل، وتُستعاد الخصومات الممولة من حاتلي واستخدامات القسائم مرة واحدة فقط.')}</p>
          <Button variant="danger" onClick={() => { setError(null); setCancelOpen(true); }}>{t('Cancel order…', 'إلغاء الطلب…')}</Button>
        </Card>
      )}
      {outcome && (
        <Card title={t('Cancellation result', 'نتيجة الإلغاء')}>
          <dl className="grid grid-cols-2 gap-1 text-sm">
            <dt className="text-gray-500">{t('Status', 'الحالة')}</dt><dd><StatusPill status={outcome.status} /></dd>
            <dt className="text-gray-500">{t('Refunded to wallet', 'مسترد إلى المحفظة')}</dt><dd className="tabular-nums">{money(outcome.money.walletRefundedMinor)}</dd>
            <dt className="text-gray-500">{t('Transfer refund recorded (to be sent)', 'استرداد تحويل مسجل (للإرسال)')}</dt><dd className="tabular-nums">{money(outcome.money.transferRefundRecordedMinor)}</dd>
            <dt className="text-gray-500">{t('Hatly-funded discount restored', 'خصم ممول من حاتلي مُستعاد')}</dt><dd className="tabular-nums">{money(outcome.money.hatlyFundedDiscountRestoredMinor)}</dd>
            <dt className="text-gray-500">{t('Coupon/offer uses reversed', 'استخدامات العروض المعكوسة')}</dt><dd>{outcome.money.offerConsumptionsReversed} / {outcome.money.offerConsumptions}</dd>
          </dl>
        </Card>
      )}
      <Card title={t('Timeline', 'الجدول الزمني')} pad={false}>
        <Async state={timeline} empty={timeline.data && timeline.data.length === 0} emptyTitle={t('No events', 'لا توجد أحداث')} rows={3}>
          <ol className="divide-y divide-gray-100">
            {(timeline.data ?? []).map((e, i) => (
              <li key={`${e.ref}${i}`} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2 text-sm">
                <span className="w-36 shrink-0 text-xs tabular-nums text-gray-500">{dateTime(e.at)}</span>
                <Badge tone={e.kind === 'NOTE' ? 'amber' : e.kind === 'FINANCIAL' ? 'blue' : e.kind === 'SEGMENT' ? 'orange' : 'gray'}>{e.kind}</Badge>
                <span className="min-w-0 flex-[1_1_12rem] [overflow-wrap:anywhere]"><span className="font-medium">{String(e.title).replace(/_/g, ' ')}</span>{e.detail ? <span className="text-gray-500"> · <bdi>{e.detail}</bdi></span> : null}{e.amountMinor !== null && e.amountMinor !== undefined ? <span className="text-gray-700"> · {money(e.amountMinor)}</span> : null}{e.onBehalfOfVendor ? <span className="ms-1"><Badge tone="amber">{t('on behalf of vendor', 'نيابةً عن المورد')}</Badge></span> : null}</span>
                {(e.actorName || e.actorRole) && <span className="text-xs text-gray-400"><bdi>{e.actorName ?? e.actorRole}</bdi></span>}
              </li>
            ))}
          </ol>
        </Async>
      </Card>
      <Card title={t('Internal notes (staff only, never edited)', 'ملاحظات داخلية (للموظفين فقط، لا تُعدَّل)')}>
        {canIssues && (
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end"><div className="flex-1"><LabeledTextarea label={t('Add a note', 'إضافة ملاحظة')} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} /></div><Button variant="primary" loading={noteBusy} disabled={!note.trim()} onClick={addNote}>{t('Add', 'إضافة')}</Button></div>
        )}
        <Async state={notes} empty={notes.data && notes.data.length === 0} emptyTitle={t('No notes yet', 'لا توجد ملاحظات بعد')} rows={2}>
          <ul className="space-y-2">{(notes.data ?? []).map((n) => <li key={n.id} className="rounded-lg bg-amber-50 px-3 py-2 text-sm"><p className="whitespace-pre-wrap"><bdi>{n.body}</bdi></p><p className="mt-1 text-xs text-gray-500"><bdi>{n.authorName}</bdi> · {dateTime(n.createdAt)}</p></li>)}</ul>
        </Async>
      </Card>
      <Modal open={cancelOpen} title={t('Cancel this order?', 'إلغاء هذا الطلب؟')} onClose={() => !busy && setCancelOpen(false)} footer={<><Button onClick={() => setCancelOpen(false)} disabled={busy}>{t('Keep the order', 'إبقاء الطلب')}</Button><Button variant="danger" loading={busy} onClick={cancel}>{t('Cancel order', 'إلغاء الطلب')}</Button></>}>
        <LabeledSelect label={t('Reason', 'السبب')} value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map(([k, en, ar]) => <option key={k} value={k}>{locale === 'ar' ? ar : en}</option>)}</LabeledSelect>
        <LabeledInput label={t('Details (optional)', 'تفاصيل (اختياري)')} value={text} onChange={(e) => setText(e.target.value)} maxLength={500} />
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </Modal>
    </div>
  );
}
