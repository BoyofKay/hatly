'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  AdminOrderDetail,
  CreateFailedDeliveryResolutionInput,
  FailedDeliveryResolutionRecord,
  createFailedDeliveryResolution,
  executeFailedDeliveryRefund,
  getAdminOrderDetail,
} from '../../../../lib/api/admin-failed-deliveries';
import { apiErrorMessage } from '../../../../lib/api/errors';
import { parseEgpToMinor } from '../../../../lib/money';
import { FINANCIAL_DIRECTION, FINANCIAL_EVENT_TYPE, ORDER_STATUS, PAYMENT_METHOD, PAYMENT_STATUS, label } from '../../../../lib/admin/labels';
import { useLang } from '../../../../lib/ui/lang';
import { Badge, Button, Card, ConfirmDialog, ErrorState, LabeledInput, LabeledTextarea, Skeleton, StatusPill } from '../../../../components/ui';

/**
 * Failed Delivery case: what happened, what the order contained and cost, then the decision. Reuses `GET admin/orders/:id`, the terminal
 * `POST …/failed-delivery-resolution` (no edit/delete once recorded) and, as a separate deliberate step, `POST …/failed-delivery-refund`
 * (never combined with recording the resolution). Both are confirmed in a dialog first.
 *
 * KNOWN LIMITATION (backend boundary, unchanged): the order detail does not include the resolution record itself, so for an already-resolved order
 * opened by direct URL the page cannot know a resolution exists. It relies on the queue only listing unresolved cases, on the financial-event list
 * to show an executed refund, and on the backend's own 409 if a second resolution is attempted.
 */

const egpToMinor = (input: string): number | null => { const r = parseEgpToMinor(input); return r.ok ? r.minor : null; };

export default function FailedDeliveryDetailPage() {
  const { t, money, dateTime } = useLang();
  const params = useParams();
  const orderId = params.id as string;

  const [detail, setDetail] = useState<AdminOrderDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [resolution, setResolution] = useState<FailedDeliveryResolutionRecord | null>(null);

  const [outcome, setOutcome] = useState<'RESOLVED_NO_REFUND' | 'REFUND_CUSTOMER'>('RESOLVED_NO_REFUND');
  const [refundAmount, setRefundAmount] = useState('');
  const [driverReviewNeeded, setDriverReviewNeeded] = useState(false);
  const [driverReviewNotes, setDriverReviewNotes] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmResolution, setConfirmResolution] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [refundResult, setRefundResult] = useState<'REFUNDED' | 'ALREADY_REFUNDED' | null>(null);
  const [refundError, setRefundError] = useState<string | null>(null);
  const [confirmRefund, setConfirmRefund] = useState(false);
  const [executingRefund, setExecutingRefund] = useState(false);

  const refresh = useCallback(async () => {
    setDetailError(null);
    try {
      setDetail(await getAdminOrderDetail(orderId));
    } catch (err: any) {
      setDetailError(apiErrorMessage(err, t('Failed to load order.', 'تعذّر تحميل الطلب.')));
    }
  }, [orderId, t]);

  useEffect(() => {
    if (orderId) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  const back = <Link href="/failed-deliveries" className="mb-3 inline-flex min-h-[36px] items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900"><span aria-hidden className="rtl:rotate-180">←</span> {t('Failed Deliveries', 'التوصيلات الفاشلة')}</Link>;
  if (detailError) return <div className="max-w-6xl">{back}<ErrorState message={detailError} onRetry={refresh} /></div>;
  if (!detail) return <div className="max-w-6xl space-y-4" aria-busy="true">{back}<Skeleton className="h-9 w-72" /><div className="grid grid-cols-1 gap-4 lg:grid-cols-3"><Skeleton className="h-64 lg:col-span-2" /><Skeleton className="h-64" /></div></div>;

  const existingRefundEvent = detail.financialEvents.find((e) => e.type === 'MANUAL_TRANSFER_REFUND_RECORDED');
  const alreadyRefunded = refundResult === 'ALREADY_REFUNDED' || refundResult === 'REFUNDED' || !!existingRefundEvent;
  const showRefundButton = resolution?.outcome === 'REFUND_CUSTOMER' && !alreadyRefunded;
  const refundMinor = egpToMinor(refundAmount);

  /** Validates, then asks for confirmation — the resolution is terminal. */
  function askToRecord() {
    setFormError(null);
    if (outcome === 'REFUND_CUSTOMER' && refundMinor === null) {
      setFormError(t('Enter the refund amount in EGP, for example 125 or 125.50.', 'أدخل مبلغ الاسترداد بالجنيه، مثل 125 أو 125.50.'));
      return;
    }
    setConfirmResolution(true);
  }

  async function submitResolution() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const input: CreateFailedDeliveryResolutionInput = {
        outcome,
        refundAmountMinor: outcome === 'REFUND_CUSTOMER' ? refundMinor ?? undefined : undefined,
        driverReviewNeeded,
        driverReviewNotes: driverReviewNeeded ? driverReviewNotes || undefined : undefined,
        notes: notes || undefined,
      };
      setResolution(await createFailedDeliveryResolution(orderId, input));
      setConfirmResolution(false);
      await refresh();
    } catch (err: any) {
      setConfirmResolution(false);
      setFormError(apiErrorMessage(err, t('Failed to record resolution.', 'تعذّر تسجيل القرار.')));
    } finally {
      setSubmitting(false);
    }
  }

  async function executeRefund() {
    if (executingRefund) return;
    setRefundError(null);
    setExecutingRefund(true);
    try {
      const result = await executeFailedDeliveryRefund(orderId);
      setRefundResult(result.status);
      setConfirmRefund(false);
      await refresh();
    } catch (err: any) {
      setRefundError(apiErrorMessage(err, t('Failed to execute refund.', 'تعذّر تنفيذ الاسترداد.')));
    } finally {
      setExecutingRefund(false);
    }
  }

  return (
    <div className="max-w-6xl">
      {back}
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">{t('Failed delivery', 'توصيل فاشل')} — <span dir="ltr">{detail.orderNumber ?? detail.id.slice(0, 8)}</span></h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500">
          <StatusPill status={detail.status} label={label(ORDER_STATUS, detail.status, t)} />
          <span>{t('Failed at', 'وقت الفشل')}: {dateTime(detail.failedAt)}</span>
          <Link href={`/order-search/${detail.id}`} className="font-medium text-hatly-orangeDark hover:underline">{t('Open full order', 'فتح الطلب كاملًا')}</Link>
        </p>
      </div>

      {detail.failureReason && (
        <div role="note" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"><span className="font-medium">{t('Failure reason', 'سبب الفشل')}:</span> {detail.failureReason}</div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title={t('The order', 'الطلب')}>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <Fact label={t('Customer', 'العميل')}>{detail.customer?.fullName ?? detail.customerId}{detail.customer?.phone && <span dir="ltr" className="ms-2 text-gray-500">{detail.customer.phone}</span>}</Fact>
              <Fact label={t('Driver', 'السائق')}>{detail.driver?.fullName ?? '—'}{detail.driver?.phone && <span dir="ltr" className="ms-2 text-gray-500">{detail.driver.phone}</span>}</Fact>
              <Fact label={t('Total', 'الإجمالي')}>{detail.totalMinor != null ? money(detail.totalMinor) : '—'}</Fact>
              <Fact label={t('Payment', 'الدفع')}>
                <span className="inline-flex flex-wrap items-center gap-1.5">{label(PAYMENT_METHOD, detail.paymentMethod, t)}{detail.payment && <><StatusPill status={detail.payment.status} label={label(PAYMENT_STATUS, detail.payment.status, t)} /><span className="tabular-nums text-gray-600">{money(detail.payment.amountMinor ?? 0)}</span></>}</span>
              </Fact>
            </dl>
          </Card>

          <Card title={t('Items', 'الأصناف')}>
            <div className="space-y-3 text-sm">
              {detail.segments.map((segment) => (
                <div key={segment.id} className="border-t border-gray-100 pt-3 first:border-0 first:pt-0">
                  <p className="flex flex-wrap items-center gap-2 text-xs text-gray-500"><span>{t('Part', 'جزء')} <span dir="ltr">{segment.id.slice(0, 8)}</span></span><StatusPill status={segment.status} label={label(ORDER_STATUS, segment.status, t)} /></p>
                  <ul className="mt-1 divide-y divide-gray-50">
                    {segment.items.map((item) => (
                      <li key={item.id} className="py-1.5">
                        <p>{item.productNameSnapshot ?? item.freeTextDescription ?? t('Custom item', 'صنف مخصص')} <span className="text-gray-500">&times; {item.quantity}</span> {item.productId === null && <Badge>{t('Custom request', 'طلب مخصص')}</Badge>}</p>
                        {item.productId === null && <p className="text-xs text-gray-500">{item.unitPriceMinor == null && item.actualAmountMinor == null ? t('Price pending', 'السعر معلق') : `${t('Final amount', 'المبلغ النهائي')}: ${money(item.actualAmountMinor ?? 0)}`}</p>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Card>

          {(detail.driverCashRemainders.length > 0 || detail.adHocPurchaseRecords.length > 0) && (
            <Card title={t('Cash with the driver', 'نقدية مع السائق')}>
              <ul className="space-y-1 text-sm">
                {detail.driverCashRemainders.map((r) => <li key={r.id}>{t('Driver cash remainder', 'باقي نقدية السائق')}: <span className="tabular-nums">{money(r.remainderAmountMinor)}</span> <StatusPill status={r.status} /></li>)}
                {detail.adHocPurchaseRecords.map((r) => <li key={r.id}>{t('Custom item purchase', 'شراء صنف مخصص')}: <span className="tabular-nums">{money(r.amountMinor)}</span> <span className="text-xs text-gray-500">({t('recorded by', 'سجّله')} {r.recordedByRole})</span></li>)}
              </ul>
            </Card>
          )}

          <Card title={t('Financial events', 'الأحداث المالية')}>
            {detail.financialEvents.length === 0 ? <p className="text-sm text-gray-500">{t('None.', 'لا يوجد.')}</p> : (
              <ul className="divide-y divide-gray-100 text-sm">
                {detail.financialEvents.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 py-1.5"><span>{label(FINANCIAL_EVENT_TYPE, e.type, t)} <span className="text-xs text-gray-500">({label(FINANCIAL_DIRECTION, e.direction, t)})</span></span><span className="tabular-nums">{e.amountMinor != null ? money(e.amountMinor) : '—'}</span></li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <aside className="lg:sticky lg:top-4 lg:self-start">
          {!resolution ? (
            <Card title={t('Decide what happens next', 'قرّر الخطوة التالية')}>
              <div className="space-y-3 text-sm">
                <p className="text-xs text-gray-500">{t('A resolution is final: it cannot be edited or deleted once recorded.', 'القرار نهائي: لا يمكن تعديله أو حذفه بعد تسجيله.')}</p>
                <fieldset className="space-y-2">
                  <legend className="sr-only">{t('Outcome', 'النتيجة')}</legend>
                  <label className="flex min-h-[44px] items-center gap-2 rounded-lg border border-gray-200 px-3"><input type="radio" name="outcome" checked={outcome === 'RESOLVED_NO_REFUND'} onChange={() => setOutcome('RESOLVED_NO_REFUND')} />{t('No refund', 'بدون استرداد')}</label>
                  <label className="flex min-h-[44px] items-center gap-2 rounded-lg border border-gray-200 px-3"><input type="radio" name="outcome" checked={outcome === 'REFUND_CUSTOMER'} onChange={() => setOutcome('REFUND_CUSTOMER')} />{t('Refund the customer', 'استرداد للعميل')}</label>
                </fieldset>
                {outcome === 'REFUND_CUSTOMER' && (
                  <LabeledInput label={t('Refund amount (EGP)', 'مبلغ الاسترداد (ج.م)')} inputMode="decimal" dir="ltr" placeholder="0.00" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} hint={refundMinor !== null ? `= ${money(refundMinor)}` : t('Up to two decimals.', 'حتى خانتين عشريتين.')} />
                )}
                <label className="flex min-h-[44px] items-center gap-2"><input type="checkbox" checked={driverReviewNeeded} onChange={(e) => setDriverReviewNeeded(e.target.checked)} />{t('Driver review needed', 'يحتاج مراجعة للسائق')}</label>
                {driverReviewNeeded && <LabeledTextarea label={t('Driver review notes', 'ملاحظات مراجعة السائق')} rows={2} value={driverReviewNotes} onChange={(e) => setDriverReviewNotes(e.target.value)} />}
                <LabeledTextarea label={t('Notes', 'ملاحظات')} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
                {formError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>}
                <Button variant="primary" className="min-h-[44px] w-full" onClick={askToRecord}>{t('Record resolution', 'تسجيل القرار')}</Button>
              </div>
            </Card>
          ) : (
            <Card title={t('Resolution recorded', 'تم تسجيل القرار')}>
              <dl className="space-y-2 text-sm">
                <Fact label={t('Outcome', 'النتيجة')}>{resolution.outcome === 'REFUND_CUSTOMER' ? t('Refund the customer', 'استرداد للعميل') : t('No refund', 'بدون استرداد')}</Fact>
                {resolution.refundAmountMinor != null && <Fact label={t('Refund amount', 'مبلغ الاسترداد')}>{money(resolution.refundAmountMinor)}</Fact>}
                {resolution.driverReviewNeeded && <Fact label={t('Driver review', 'مراجعة السائق')}>{resolution.driverReviewNotes || t('Needed', 'مطلوبة')}</Fact>}
                {resolution.notes && <Fact label={t('Notes', 'ملاحظات')}>{resolution.notes}</Fact>}
              </dl>
              {showRefundButton && (
                <div className="mt-4 border-t border-gray-100 pt-3">
                  <Button variant="primary" className="min-h-[44px] w-full" onClick={() => { setRefundError(null); setConfirmRefund(true); }}>{t('Execute refund', 'تنفيذ الاسترداد')}</Button>
                  {refundError && <p role="alert" className="mt-2 text-sm text-red-600">{refundError}</p>}
                </div>
              )}
              {alreadyRefunded && <p role="status" className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{refundResult === 'ALREADY_REFUNDED' ? t('Refund was already recorded.', 'تم تسجيل الاسترداد سابقًا.') : t('Refund recorded successfully.', 'تم تسجيل الاسترداد بنجاح.')}</p>}
            </Card>
          )}
        </aside>
      </div>

      <ConfirmDialog
        open={confirmResolution}
        title={t('Record this resolution?', 'تسجيل هذا القرار؟')}
        message={<>{outcome === 'REFUND_CUSTOMER' && refundMinor !== null ? t(`The customer will be marked for a refund of ${money(refundMinor)}. `, `سيُسجَّل للعميل استرداد بقيمة ${money(refundMinor)}. `) : ''}{t('It is final and cannot be edited or deleted afterward.', 'القرار نهائي ولا يمكن تعديله أو حذفه بعد ذلك.')}</>}
        confirmLabel={t('Record resolution', 'تسجيل القرار')}
        busy={submitting}
        onConfirm={() => void submitResolution()}
        onClose={() => setConfirmResolution(false)}
      />
      <ConfirmDialog
        open={confirmRefund}
        title={t('Execute this refund now?', 'تنفيذ هذا الاسترداد الآن؟')}
        message={t('This sends money back to the customer and cannot be undone.', 'سيُعاد المبلغ إلى العميل ولا يمكن التراجع عن ذلك.')}
        confirmLabel={t('Execute refund', 'تنفيذ الاسترداد')}
        danger
        busy={executingRefund}
        error={refundError}
        onConfirm={() => void executeRefund()}
        onClose={() => setConfirmRefund(false)}
      />
    </div>
  );
}

function Fact({ label: l, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{l}</dt>
      <dd className="text-gray-900">{children}</dd>
    </div>
  );
}
