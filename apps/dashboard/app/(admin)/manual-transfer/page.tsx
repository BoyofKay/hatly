'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  ManualTransferPayment,
  TransferByOrder,
  approvePayment,
  findTransferByOrderNumber,
  listUnderReviewPayments,
  recordManualTransferRefund,
  rejectPayment,
} from '../../../lib/api/admin-manual-transfer';
import { apiErrorMessage } from '../../../lib/api/errors';
import { parseEgpToMinor } from '../../../lib/money';
import { useLang } from '../../../lib/ui/lang';
import { ago } from '../../../lib/ui/time';
import { methodWords } from '../../../components/orders/PaymentPill';
import { RefundsToSend } from '../../../components/operations/RefundsToSend';
import { Button, Card, ConfirmDialog, EmptyState, ErrorState, KpiCard, LabeledInput, PageHeader, Skeleton, StatusPill, useToast } from '../../../components/ui';

/**
 * Manual Transfer verification — consumes the existing `admin/manual-transfer-payments` exactly. The system never reads the customer's screenshot: the
 * admin decides by judgment, matching the frozen business rule. Approve / reject are backend-authoritative (the payment state machine, not this page,
 * prevents a double decision) and each is confirmed in a dialog first. Below the queue: record a refund for an already-approved payment, then the
 * refunds still to be sent.
 */
export default function ManualTransferPage() {
  const { t, money, dateTime, locale } = useLang();
  const toast = useToast();
  const [payments, setPayments] = useState<ManualTransferPayment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<{ kind: 'approve' | 'reject'; payment: ManualTransferPayment } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [refundOrder, setRefundOrder] = useState('');
  const [found, setFound] = useState<TransferByOrder | null>(null);
  const [finding, setFinding] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundError, setRefundError] = useState<string | null>(null);
  const [confirmRefund, setConfirmRefund] = useState(false);
  const [isRefunding, setIsRefunding] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      setPayments(await listUnderReviewPayments());
    } catch (err: any) {
      setError(apiErrorMessage(err, t('Failed to load pending transfers.', 'تعذّر تحميل التحويلات المعلّقة.')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function decide(reason: string) {
    if (!action || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      if (action.kind === 'approve') await approvePayment(action.payment.id);
      else await rejectPayment(action.payment.id, reason || undefined);
      toast.push('success', action.kind === 'approve' ? t('Transfer approved as paid.', 'تمت الموافقة على التحويل كمدفوع.') : t('Transfer rejected.', 'تم رفض التحويل.'));
      setAction(null);
      await refresh();
    } catch (err: any) {
      // Includes "already PAID/REJECTED by another admin" — the backend's own terminal-state guard, surfaced plainly.
      setActionError(apiErrorMessage(err, action.kind === 'approve' ? t('Failed to approve.', 'تعذّرت الموافقة.') : t('Failed to reject.', 'تعذّر الرفض.')));
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const refundMinor = (() => { const r = parseEgpToMinor(refundAmount); return r.ok ? r.minor : null; })();

  async function findOrder() {
    setRefundError(null);
    setFound(null);
    if (!refundOrder.trim()) return setRefundError(t('Enter the order number, for example HT-100234.', 'أدخل رقم الطلب، مثل HT-100234.'));
    setFinding(true);
    try {
      const r = await findTransferByOrderNumber(refundOrder);
      setFound(r);
      if (r.status !== 'PAID') setRefundError(t('This transfer is not approved as paid, so it cannot be refunded.', 'هذا التحويل غير معتمد كمدفوع، لذا لا يمكن استرداده.'));
      else if (r.amountMinor != null) setRefundAmount(((r.amountMinor - r.refundedMinor) / 100).toFixed(2));
    } catch (err: any) {
      setRefundError(apiErrorMessage(err, t('No Manual Transfer payment was found for this order number.', 'لم يُعثر على دفعة تحويل يدوي لهذا الرقم.')));
    } finally {
      setFinding(false);
    }
  }

  function askRefund(e: React.FormEvent) {
    e.preventDefault();
    setRefundError(null);
    if (!found) return setRefundError(t('Find the order first.', 'ابحث عن الطلب أولًا.'));
    if (found.status !== 'PAID') return setRefundError(t('This transfer is not approved as paid, so it cannot be refunded.', 'هذا التحويل غير معتمد كمدفوع، لذا لا يمكن استرداده.'));
    if (refundMinor === null) return setRefundError(t('Enter the amount in EGP, for example 100 or 100.50.', 'أدخل المبلغ بالجنيه، مثل 100 أو 100.50.'));
    setConfirmRefund(true);
  }

  async function recordRefund() {
    if (refundMinor === null || isRefunding) return;
    setIsRefunding(true);
    try {
      if (!found) return;
      await recordManualTransferRefund(found.paymentId, refundMinor, refundReason || undefined);
      toast.push('success', t('Refund recorded. Send the money, then mark it as sent in "Refunds to send".', 'تم تسجيل الاسترداد. أرسل المبلغ ثم سجّل الإرسال في "مستردات للإرسال".'));
      setConfirmRefund(false);
      setRefundOrder(''); setFound(null); setRefundAmount(''); setRefundReason('');
    } catch (err: any) {
      setConfirmRefund(false);
      setRefundError(apiErrorMessage(err, t('Failed to record refund.', 'تعذّر تسجيل الاسترداد.')));
    } finally {
      setIsRefunding(false);
    }
  }

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={t('Manual Transfer Verification', 'التحقق من التحويلات اليدوية')}
        subtitle={t('Customers who paid by transfer claim they sent the money. Approve once Hatly has really received it; the order is released on approval.', 'عملاء دفعوا بالتحويل ويقولون إنهم أرسلوا المبلغ. وافق بعد التأكد من وصول المبلغ فعلًا؛ يُفرج عن الطلب عند الموافقة.')}
        actions={<Button onClick={refresh} loading={loading}>{t('Refresh', 'تحديث')}</Button>}
      />

      {payments && payments.length > 0 && <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4"><KpiCard label={t('Awaiting review', 'بانتظار المراجعة')} value={payments.length} tone="bad" /></div>}

      {error && !payments ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : !payments ? (
        <div className="space-y-3" aria-busy="true">{[0, 1].map((i) => <Skeleton key={i} className="h-32" />)}</div>
      ) : payments.length === 0 ? (
        <Card><EmptyState title={t('No transfers awaiting review.', 'لا توجد تحويلات بانتظار المراجعة.')} hint={t('Claims from customers appear here.', 'تظهر هنا مطالبات العملاء.')} /></Card>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {payments.map((p) => (
            <li key={p.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm" data-testid={`transfer-${p.orderNumber ?? p.orderId}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-2xl font-semibold tabular-nums text-gray-900">{p.amountMinor != null ? money(p.amountMinor) : t('Amount not yet available', 'المبلغ غير متاح بعد')}</p>
                  {p.claimedAt && <p className="mt-0.5 text-xs text-gray-500">{t('Customer says sent', 'يقول العميل إنه أرسل')} {ago(p.claimedAt, locale)} · {dateTime(p.claimedAt)}</p>}
                </div>
                <StatusPill status={p.status} label={p.status === 'UNDER_REVIEW' ? t('Under review', 'قيد المراجعة') : undefined} />
              </div>
              <dl className="mt-3 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-gray-500">{t('Order', 'الطلب')}</dt>
                <dd><Link href={`/order-management?order=${p.orderId}`} className="font-mono text-xs font-semibold text-hatly-orangeDark hover:underline" dir="ltr">{p.orderNumber ?? `#${p.orderId.slice(0, 8)}`}</Link></dd>
                {p.customerName !== undefined && <><dt className="text-gray-500">{t('Customer', 'العميل')}</dt><dd className="min-w-0 truncate"><bdi>{p.customerName ?? '—'}</bdi>{p.customerPhone && <> · <a href={`tel:${p.customerPhone}`} dir="ltr" className="text-hatly-orangeDark hover:underline">{p.customerPhone}</a></>}</dd></>}
                <dt className="text-gray-500">{t('Method', 'الطريقة')}</dt>
                <dd>{methodWords(p.method, t)}</dd>
                {p.orderTotalMinor != null && <><dt className="text-gray-500">{t('Order total', 'إجمالي الطلب')}</dt><dd className="tabular-nums">{money(p.orderTotalMinor)}</dd></>}
              </dl>
              <p className="mt-2 text-xs text-gray-500">{t('InstaPay/Wallet choice is not recorded — check the customer’s WhatsApp message for which one they used.', 'لا يُسجَّل اختيار إنستاباي أو المحفظة — راجع رسالة العميل على واتساب.')}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="primary" className="min-h-[44px] flex-1 sm:flex-none" onClick={() => { setActionError(null); setAction({ kind: 'approve', payment: p }); }}>{t('Approve', 'موافقة')}</Button>
                <Button className="min-h-[44px] flex-1 sm:flex-none" onClick={() => { setActionError(null); setAction({ kind: 'reject', payment: p }); }}>{t('Reject', 'رفض')}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* A refund applies to an already-PAID transfer, which has left the review list: the admin finds it by the order number they read (HT-…). */}
      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card title={t('Record a Manual Transfer Refund', 'تسجيل استرداد لتحويل يدوي')}>
          <p className="mb-3 text-xs text-gray-500">{t('For an already-approved (paid) transfer that needs money sent back to the customer outside the system.', 'لتحويل تمت الموافقة عليه (مدفوع) ويحتاج إعادة المبلغ للعميل خارج النظام.')}</p>
          <form onSubmit={askRefund} className="space-y-3">
            <div className="flex items-end gap-2">
              <div className="flex-1"><LabeledInput label={t('Order number', 'رقم الطلب')} dir="ltr" placeholder="HT-100234" value={refundOrder} onChange={(e) => { setRefundOrder(e.target.value); setFound(null); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void findOrder(); } }} /></div>
              <Button type="button" onClick={() => void findOrder()} loading={finding} className="min-h-[42px]" data-testid="refund-find">{t('Find', 'بحث')}</Button>
            </div>
            {found && (
              <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700" data-testid="refund-found">
                <bdi>{found.orderNumber}</bdi>{found.customerName && <> · <bdi>{found.customerName}</bdi></>} · {t('paid', 'مدفوع')} {found.amountMinor != null ? money(found.amountMinor) : '—'}
                {found.refundedMinor > 0 && <> · {t('already refunded', 'تم استرداد')} {money(found.refundedMinor)}</>}
              </p>
            )}
            <LabeledInput label={t('Amount (EGP)', 'المبلغ (ج.م)')} inputMode="decimal" dir="ltr" placeholder="Amount (EGP)" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} hint={refundMinor !== null ? `= ${money(refundMinor)}` : t('Up to two decimals.', 'حتى خانتين عشريتين.')} />
            <LabeledInput label={t('Reason (optional)', 'السبب (اختياري)')} placeholder="Reason (optional)" value={refundReason} onChange={(e) => setRefundReason(e.target.value)} />
            {refundError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{refundError}</p>}
            <Button type="submit" variant="primary" loading={isRefunding} disabled={!found || found.status !== 'PAID'} className="min-h-[44px] w-full sm:w-auto">{isRefunding ? t('Recording...', 'جارٍ التسجيل...') : t('Record Refund', 'تسجيل الاسترداد')}</Button>
          </form>
        </Card>
        <div><RefundsToSend /></div>
      </div>

      <ConfirmDialog
        open={!!action}
        title={action?.kind === 'approve' ? t('Approve this transfer as paid?', 'الموافقة على التحويل كمدفوع؟') : t('Reject this transfer claim?', 'رفض مطالبة التحويل؟')}
        message={action?.kind === 'approve' ? t(`Confirm Hatly received ${action.payment.amountMinor != null ? money(action.payment.amountMinor) : 'the money'}${action.payment.customerName ? ` from ${action.payment.customerName}` : ''} for ${action.payment.orderNumber ?? 'this order'}. The order is released to the store. This cannot be undone.`, `تأكيد أن هاتلي استلمت ${action.payment.amountMinor != null ? money(action.payment.amountMinor) : 'المبلغ'}${action.payment.customerName ? ` من ${action.payment.customerName}` : ''} للطلب ${action.payment.orderNumber ?? ''}. يُرسل الطلب إلى المتجر. لا يمكن التراجع.`) : t('The claim will be rejected. This cannot be undone.', 'ستُرفض المطالبة ولا يمكن التراجع عن ذلك.')}
        confirmLabel={action?.kind === 'approve' ? t('Approve', 'موافقة') : t('Reject', 'رفض')}
        danger={action?.kind === 'reject'}
        reasonLabel={action?.kind === 'reject' ? t('Rejection reason (optional)', 'سبب الرفض (اختياري)') : undefined}
        busy={busy}
        error={actionError}
        onConfirm={(reason) => void decide(reason)}
        onClose={() => setAction(null)}
      />
      <ConfirmDialog open={confirmRefund} title={t('Record this refund?', 'تسجيل هذا الاسترداد؟')} message={t(`Record a refund of ${money(refundMinor)} for ${found?.orderNumber ?? 'this order'}. This cannot be undone.`, `تسجيل استرداد بقيمة ${money(refundMinor)} للطلب ${found?.orderNumber ?? ''}. لا يمكن التراجع.`)} confirmLabel={t('Record Refund', 'تسجيل الاسترداد')} busy={isRefunding} onConfirm={() => void recordRefund()} onClose={() => setConfirmRefund(false)} />
    </div>
  );
}
