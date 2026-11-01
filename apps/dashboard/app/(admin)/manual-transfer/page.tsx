'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  ManualTransferPayment,
  approvePayment,
  listUnderReviewPayments,
  recordManualTransferRefund,
  rejectPayment,
} from '../../../lib/api/admin-manual-transfer';
import { apiErrorMessage } from '../../../lib/api/errors';
import { parseEgpToMinor } from '../../../lib/money';
import { useLang } from '../../../lib/ui/lang';
import { RefundsToSend } from '../../../components/operations/RefundsToSend';
import { Button, Card, ConfirmDialog, EmptyState, ErrorState, KpiCard, LabeledInput, PageHeader, Skeleton, StatusPill, useToast } from '../../../components/ui';

/**
 * Manual Transfer verification — consumes the existing `admin/manual-transfer-payments` exactly. The system never reads the customer's screenshot: the
 * admin decides by judgment, matching the frozen business rule. Approve / reject are backend-authoritative (the payment state machine, not this page,
 * prevents a double decision) and each is confirmed in a dialog first. Below the queue: record a refund for an already-approved payment, then the
 * refunds still to be sent.
 */
export default function ManualTransferPage() {
  const { t, money, dateTime } = useLang();
  const toast = useToast();
  const [payments, setPayments] = useState<ManualTransferPayment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<{ kind: 'approve' | 'reject'; payment: ManualTransferPayment } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [refundPaymentId, setRefundPaymentId] = useState('');
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

  function askRefund(e: React.FormEvent) {
    e.preventDefault();
    setRefundError(null);
    if (!refundPaymentId.trim()) return setRefundError(t('Payment id is required.', 'معرّف الدفعة مطلوب.'));
    if (refundMinor === null) return setRefundError(t('Enter the amount in EGP, for example 100 or 100.50.', 'أدخل المبلغ بالجنيه، مثل 100 أو 100.50.'));
    setConfirmRefund(true);
  }

  async function recordRefund() {
    if (refundMinor === null || isRefunding) return;
    setIsRefunding(true);
    try {
      await recordManualTransferRefund(refundPaymentId.trim(), refundMinor, refundReason || undefined);
      toast.push('success', t('Refund recorded.', 'تم تسجيل الاسترداد.'));
      setConfirmRefund(false);
      setRefundPaymentId(''); setRefundAmount(''); setRefundReason('');
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
            <li key={p.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-2xl font-semibold tabular-nums text-gray-900">{p.amountMinor != null ? money(p.amountMinor) : t('Amount not yet available', 'المبلغ غير متاح بعد')}</p>
                  {p.claimedAt && <p className="mt-0.5 text-xs text-gray-500">{t('Customer claimed sent', 'أبلغ العميل بالإرسال')}: {dateTime(p.claimedAt)}</p>}
                </div>
                <StatusPill status={p.status} label={p.status === 'UNDER_REVIEW' ? t('Under review', 'قيد المراجعة') : undefined} />
              </div>
              <p className="mt-2 text-sm text-gray-600">{t('Order', 'الطلب')} <Link href={`/order-search/${p.orderId}`} className="font-mono text-xs font-semibold text-hatly-orangeDark hover:underline" dir="ltr">#{p.orderId.slice(0, 8)}</Link> · {t('Method', 'الطريقة')}: {p.method}</p>
              <p className="mt-1 text-xs text-gray-500">{t('InstaPay/Wallet choice is not recorded — check the customer’s WhatsApp message for which one they used.', 'لا يُسجَّل اختيار إنستاباي أو المحفظة — راجع رسالة العميل على واتساب.')}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="primary" className="min-h-[44px] flex-1 sm:flex-none" onClick={() => { setActionError(null); setAction({ kind: 'approve', payment: p }); }}>{t('Approve', 'موافقة')}</Button>
                <Button className="min-h-[44px] flex-1 sm:flex-none" onClick={() => { setActionError(null); setAction({ kind: 'reject', payment: p }); }}>{t('Reject', 'رفض')}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* A separate payment-id field, not a per-row button: a refund applies to an already-PAID payment, which has left the under-review list, and the
          backend has no search endpoint for PAID payments (building one is out of scope here). */}
      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card title={t('Record a Manual Transfer Refund', 'تسجيل استرداد لتحويل يدوي')}>
          <p className="mb-3 text-xs text-gray-500">{t('For an already-approved (paid) transfer that needs money sent back to the customer outside the system.', 'لتحويل تمت الموافقة عليه (مدفوع) ويحتاج إعادة المبلغ للعميل خارج النظام.')}</p>
          <form onSubmit={askRefund} className="space-y-3">
            <LabeledInput label={t('Payment id', 'معرّف الدفعة')} dir="ltr" placeholder="Payment id" value={refundPaymentId} onChange={(e) => setRefundPaymentId(e.target.value)} />
            <LabeledInput label={t('Amount (EGP)', 'المبلغ (ج.م)')} inputMode="decimal" dir="ltr" placeholder="Amount (EGP)" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} hint={refundMinor !== null ? `= ${money(refundMinor)}` : t('Up to two decimals.', 'حتى خانتين عشريتين.')} />
            <LabeledInput label={t('Reason (optional)', 'السبب (اختياري)')} placeholder="Reason (optional)" value={refundReason} onChange={(e) => setRefundReason(e.target.value)} />
            {refundError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{refundError}</p>}
            <Button type="submit" variant="primary" loading={isRefunding} className="min-h-[44px] w-full sm:w-auto">{isRefunding ? t('Recording...', 'جارٍ التسجيل...') : t('Record Refund', 'تسجيل الاسترداد')}</Button>
          </form>
        </Card>
        <div><RefundsToSend /></div>
      </div>

      <ConfirmDialog
        open={!!action}
        title={action?.kind === 'approve' ? t('Approve this transfer as paid?', 'الموافقة على التحويل كمدفوع؟') : t('Reject this transfer claim?', 'رفض مطالبة التحويل؟')}
        message={action?.kind === 'approve' ? t('This confirms Hatly received the money and releases the order. It cannot be undone.', 'هذا يؤكد أن هاتلي استلمت المبلغ ويُفرج عن الطلب. لا يمكن التراجع.') : t('The claim will be rejected. This cannot be undone.', 'ستُرفض المطالبة ولا يمكن التراجع عن ذلك.')}
        confirmLabel={action?.kind === 'approve' ? t('Approve', 'موافقة') : t('Reject', 'رفض')}
        danger={action?.kind === 'reject'}
        reasonLabel={action?.kind === 'reject' ? t('Rejection reason (optional)', 'سبب الرفض (اختياري)') : undefined}
        busy={busy}
        error={actionError}
        onConfirm={(reason) => void decide(reason)}
        onClose={() => setAction(null)}
      />
      <ConfirmDialog open={confirmRefund} title={t('Record this refund?', 'تسجيل هذا الاسترداد؟')} message={t(`Record a refund of ${money(refundMinor)} against this payment. This cannot be undone.`, `تسجيل استرداد بقيمة ${money(refundMinor)} على هذه الدفعة. لا يمكن التراجع.`)} confirmLabel={t('Record Refund', 'تسجيل الاسترداد')} busy={isRefunding} onConfirm={() => void recordRefund()} onClose={() => setConfirmRefund(false)} />
    </div>
  );
}
