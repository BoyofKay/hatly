'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AdminOrderDetail, getAdminOrderDetail } from '../../lib/api/admin-failed-deliveries';
import { MANAGE_HATLY_SERVICE_PRICING } from '../../lib/api/admin-hatly-service-pricing';
import { useAdminPermission } from '../../lib/auth/use-admin-permission';
import { I18nProvider, useI18n } from '../../lib/i18n/i18n';
import { formatMinor } from '../../lib/money';
import { DispatchDriver, listDispatchDrivers } from '../../lib/api/admin-control-tower';
import { DispatchAction } from '../../components/operations/DispatchAction';
import { markOrderCollected } from '../../lib/api/order-collection';
import { deliveryAddressText } from '../../lib/delivery-address';
import { Badge, Card, ErrorState, Skeleton, StatusPill } from '../../components/ui';
import { FINANCIAL_DIRECTION, FINANCIAL_EVENT_TYPE, FULFILLMENT, ORDER_STATUS, PAYMENT_METHOD, PAYMENT_STATUS, label } from '../../lib/admin/labels';
import { useLang } from '../../lib/ui/lang';
import { HatlyServiceItem, HatlyServiceRoute } from '../../components/orders/HatlyServiceItem';
import { OrderTotals } from '../../components/orders/OrderTotals';
import { apiErrorMessage } from '../../lib/api/errors';
import { SegmentOperations } from '../../components/operations/SegmentOperations';
import { OrderExtrasPanel } from '../../components/orders/OrderExtrasPanel';
import { DispatchAttemptsList, RefundSummaryCard } from '../../components/operations/OrderRefundsAndAttempts';
import { MessageKey } from '../../lib/i18n/messages';

/**
 * M3b (Launch-Readiness Gap Audit, G-04). Reuses the EXISTING
 * `getAdminOrderDetail` API client function and the EXISTING
 * `GET admin/orders/:id` backend endpoint verbatim. This is deliberately a SEPARATE
 * page from `/failed-deliveries/[id]`, not a duplicate detail
 * implementation: that page's own resolution/refund forms are not
 * gated on the order actually being a failed delivery (it can already
 * be reached for any order id by direct URL, per its own top comment),
 * so reusing it as the general "open any order from search" view would
 * invite an Admin to record a failed-delivery resolution against a
 * perfectly normal order — a real, misleading UX gap, not a stylistic
 * preference. This page has no failed-delivery controls.
 *
 * Hatly Service pricing: the one mutation on this page is confirming the price of a PENDING Hatly Service request
 * (`POST admin/orders/items/:itemId/confirm-price`, gated by MANAGE_HATLY_SERVICE_PRICING). After every confirmation the order is
 * re-read from the backend; the totals shown are the backend's, never computed here.
 */
/** The order workspace body: the SAME view is the full page (`/order-search/:id`) and the drawer opened from the Orders workspace. */
export function OrderDetailView({ orderId, embedded = false, onClose }: { orderId: string; embedded?: boolean; onClose?: () => void }) {
  return (
    <I18nProvider>
      <OrderDetailScreen orderId={orderId} embedded={embedded} onClose={onClose} />
    </I18nProvider>
  );
}

function OrderDetailScreen({ orderId, embedded, onClose }: { orderId: string; embedded: boolean; onClose?: () => void }) {
  const { t, locale } = useI18n();
  const { t: tl, money, dateTime } = useLang();
  const canConfirmPrices = useAdminPermission(MANAGE_HATLY_SERVICE_PRICING);

  const [detail, setDetail] = useState<AdminOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setDetail(await getAdminOrderDetail(orderId));
    } catch (err: any) {
      setError(apiErrorMessage(err, t('detailFailed')));
    }
  }, [orderId, t]);

  useEffect(() => {
    if (orderId) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

 const back = embedded ? null : (
    <Link href="/order-search" className="mb-3 inline-flex min-h-[36px] items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900">
      <span aria-hidden className="rtl:rotate-180">←</span> {t('listTitle')}
    </Link>
  );

  if (error) return <div className={embedded ? "" : "max-w-6xl"}>{back}<ErrorState message={error} onRetry={refresh} /></div>;
  if (!detail) {
    return (
      <div className={embedded ? "space-y-4" : "max-w-6xl space-y-4"} aria-busy="true">
        {back}
        <Skeleton className="h-9 w-64" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3"><Skeleton className="h-64 lg:col-span-2" /><Skeleton className="h-64" /></div>
      </div>
    );
  }

  const pendingHatlyCount = detail.segments
    .filter((s) => s.groupType === 'AD_HOC_SERVICE')
    .flatMap((s) => s.items)
    .filter((i) => i.priceStatus !== 'CONFIRMED').length;
  const hasHatlyService = detail.segments.some((s) => s.groupType === 'AD_HOC_SERVICE');

  return (
    <div className={embedded ? '' : 'max-w-6xl'} data-testid={embedded ? 'order-drawer-body' : undefined}>
      {back}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">
            {t('detailTitle', { number: detail.orderNumber })}{' '}
            <span className="text-sm font-normal text-gray-500" dir="ltr">({detail.id.slice(0, 8)})</span>
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500">
            <StatusPill status={detail.status} label={label(ORDER_STATUS, detail.status, tl)} />
            <Badge tone={detail.fulfillmentType === 'PICKUP' ? 'blue' : 'gray'}>{label(FULFILLMENT, detail.fulfillmentType, tl)}</Badge>
            {pendingHatlyCount > 0 && <Badge tone="amber">{t('priceBadge')}</Badge>}
            <span>{t('detailCreated')}: {dateTime(detail.createdAt)}</span>
          </p>
        </div>
        {embedded && (
          <Link href={`/order-search/${detail.id}`} className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-700 hover:bg-gray-50" data-testid="order-open-full">
            {tl('Open full page', 'فتح الصفحة الكاملة')} <span aria-hidden className="rtl:rotate-180">↗</span>
          </Link>
        )}
      </div>

      {(detail.cancellationReason || detail.failureReason) && (
        <div role="note" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {detail.cancellationReason && <p><span className="font-medium">{t('detailCancellationReason')}:</span> {detail.cancellationReason}{detail.cancelledByRole ? ` (${detail.cancelledByRole})` : ''}</p>}
          {detail.failureReason && <p><span className="font-medium">{t('detailFailureReason')}:</span> {detail.failureReason}</p>}
        </div>
      )}

      <div className={embedded ? "grid grid-cols-1 gap-4" : "grid grid-cols-1 gap-4 lg:grid-cols-3"}>
        <div className={embedded ? "space-y-4" : "space-y-4 lg:col-span-2"}>
          <OperationsPanel detail={detail} onChanged={refresh} />

          {detail.segments.some((segment) => segment.groupType !== 'AD_HOC_SERVICE') && (
            <Card title={t('opSegmentsTitle')}>
              <div data-testid="order-vendor-parts">
                <p className="text-xs text-gray-500">{t('opSegmentsHint')}</p>
                {detail.segments
                  .filter((segment) => segment.groupType !== 'AD_HOC_SERVICE')
                  .map((segment) => (
                    <SegmentOperations key={segment.id} segment={segment} onChanged={refresh} orderStatus={detail.status} />
                  ))}
              </div>
            </Card>
          )}

          <Card title={t('detailItems')}>
            {hasHatlyService && (
              <p className={`mb-2 text-xs ${pendingHatlyCount > 0 ? 'font-medium text-amber-800' : 'text-gray-500'}`} data-testid="hatly-pending-summary">
                {pendingHatlyCount > 0 ? t('hsPendingCount', { count: pendingHatlyCount }) : t('hsAllConfirmed')}
              </p>
            )}
            <div className="space-y-3 text-sm">
              {detail.segments.map((segment) => (
                <div key={segment.id} className="border-t border-gray-100 pt-3 first:border-0 first:pt-0">
                  <p className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    <span>{t('detailSegment')} <span dir="ltr">{segment.id.slice(0, 8)}</span></span>
                    <Badge>{segment.groupType === 'AD_HOC_SERVICE' ? tl('Hatly Service', 'خدمة هاتلي') : tl('Vendor order', 'طلب من متجر')}</Badge>
                    <StatusPill status={segment.status} label={label(ORDER_STATUS, segment.status, tl)} />
                  </p>
                  {segment.groupType === 'AD_HOC_SERVICE' ? (
                    <>
                      <p className="mt-1 text-sm font-medium">{t('hsHeading')}</p>
                      {segment.hatlyService && <HatlyServiceRoute service={segment.hatlyService} detail={detail} />}
                      {segment.items.map((item) => (
                        <HatlyServiceItem key={item.id} item={item} orderStatus={detail.status} canConfirm={canConfirmPrices} onChanged={refresh} />
                      ))}
                    </>
                  ) : (
                    <ul className="mt-1 divide-y divide-gray-50">
                      {segment.items.map((item) => (
                        <li key={item.id} className="flex items-baseline justify-between gap-3 py-1.5">
                          <span className="min-w-0">{item.productNameSnapshot ?? item.freeTextDescription ?? t('detailCustomItem')} <span className="text-gray-500">&times; {item.quantity}</span></span>
                          {item.unitPriceMinor != null && <span className="shrink-0 tabular-nums text-gray-600">{money(item.unitPriceMinor)}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </Card>

          <Card title={t('detailFinancialEvents')}>
            {detail.financialEvents.length === 0 ? (
              <p className="text-sm text-gray-500">{t('detailNone')}</p>
            ) : (
              <ul className="divide-y divide-gray-100 text-sm">
                {detail.financialEvents.map((e: any) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="min-w-0">{label(FINANCIAL_EVENT_TYPE, e.type, tl)} <span className="text-xs text-gray-500">({label(FINANCIAL_DIRECTION, e.direction, tl)})</span></span>
                    <span className="shrink-0 tabular-nums">{e.amountMinor != null ? money(e.amountMinor) : t('dash')}</span>
                  </li>
                ))}
              </ul>
            )}
            {detail.hatlyFundedDiscount && detail.hatlyFundedDiscount.recordedMinor > 0 && (
              <p className="mt-2 text-xs text-gray-600" data-testid="hatly-funded-net">
                {t('opHatlyFundedNet', {
                  recorded: formatMinor(detail.hatlyFundedDiscount.recordedMinor),
                  restored: formatMinor(detail.hatlyFundedDiscount.restoredMinor),
                  net: formatMinor(detail.hatlyFundedDiscount.netMinor),
                })}
              </p>
            )}
          </Card>
        </div>

        <aside className="space-y-4">
          <Card title={t('detailCustomer')}>
            <dl className="space-y-2 text-sm">
              <Fact label={t('detailCustomer')}>{detail.customer?.fullName ?? detail.customerId}{detail.customer?.phone && <span dir="ltr" className="ms-2 text-gray-500">{detail.customer.phone}</span>}</Fact>
              {detail.deliveryAddress && <Fact label={t('detailDeliveryAddress')}><span data-testid="order-delivery-address">{deliveryAddressText(detail.deliveryAddress, locale)}</span></Fact>}
              <Fact label={t('detailDriver')}>{detail.driver?.fullName ?? t('dash')}{detail.driver?.phone && <span dir="ltr" className="ms-2 text-gray-500">{detail.driver.phone}</span>}</Fact>
              <Fact label={t('detailPayment')}>
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  {label(PAYMENT_METHOD, detail.paymentMethod, tl)}
                  {detail.payment && <><StatusPill status={detail.payment.status} label={label(PAYMENT_STATUS, detail.payment.status, tl)} /><span className="tabular-nums text-gray-600">{money(detail.payment.amountMinor ?? 0)}</span></>}
                  {/* Jump to the transfer of THIS order (verify it, or record a refund) — the page opens on this order number. */}
                  {detail.paymentMethod === 'MANUAL_TRANSFER' && (
                    <Link href={`/manual-transfer?order=${encodeURIComponent(detail.orderNumber)}`} className="text-xs font-medium text-hatly-orangeDark hover:underline" data-testid="order-open-transfer">
                      {tl('Open this transfer', 'فتح هذا التحويل')} <span aria-hidden className="rtl:rotate-180">→</span>
                    </Link>
                  )}
                </span>
              </Fact>
              {detail.status === 'FAILED_DELIVERY' && (
                <Fact label={tl('Failed delivery', 'توصيل فاشل')}>
                  <Link href={`/failed-deliveries/${detail.id}`} className="text-sm font-medium text-hatly-orangeDark hover:underline">{tl('Decide what happens next', 'قرّر الخطوة التالية')} <span aria-hidden className="rtl:rotate-180">→</span></Link>
                </Fact>
              )}
            </dl>
          </Card>
          <OrderTotals detail={detail} />
          {detail.refundSummary && <RefundSummaryCard summary={detail.refundSummary} />}
          <OrderExtrasPanel orderId={detail.id} status={detail.status} onChanged={refresh} />
        </aside>
      </div>
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

/**
 * Control Tower milestone — the order's delivery & dispatch state, its "no eligible driver" alerts, its status timeline, and
 * (for an admin holding ASSIGN_REASSIGN_ORDERS) the same assign / reassign control the Control Tower uses. After an action the
 * order is re-read from the backend.
 */
function OperationsPanel({ detail, onChanged }: { detail: AdminOrderDetail; onChanged: () => Promise<void> | void }) {
  const { t } = useI18n();
  const { t: tl, dateTime } = useLang();
  const canAssign = useAdminPermission('ASSIGN_REASSIGN_ORDERS');
  const [drivers, setDrivers] = useState<DispatchDriver[] | null>(null);
  const [driversError, setDriversError] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ ok: boolean; message: string } | null>(null);
  const dispatchable = detail.fulfillmentType === 'DELIVERY' && (detail.status === 'READY_FOR_PICKUP' || detail.status === 'ASSIGNED_TO_DRIVER');

  useEffect(() => {
    if (canAssign !== true || !dispatchable) return;
    let cancelled = false;
    listDispatchDrivers()
      .then((list) => !cancelled && setDrivers(list))
      .catch((err) => !cancelled && setDriversError(apiErrorMessage(err, t('dxDriversFailed'))));
    return () => {
      cancelled = true;
    };
  }, [canAssign, dispatchable, detail.status, detail.driver?.id, t]);

  const fmt = (iso: string | null | undefined) => (iso ? dateTime(iso) : t('dash'));

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 text-sm shadow-sm" data-testid="order-operations">
      <h2 className="text-sm font-semibold text-gray-900">{t('odOperations')}</h2>
      {detail.fulfillmentType !== 'DELIVERY' ? (
        <>
          <p className="mt-1 text-gray-600">{t('odPickupOrder')}</p>
          <PickupCollection detail={detail} onChanged={onChanged} />
        </>
      ) : (
        <>
          {!detail.delivery && <p className="mt-1 text-gray-600">{t('odNoDeliveryYet')}</p>}
          {detail.delivery && (
            <dl className="mt-1 grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5">
              <dt className="text-gray-500">{t('odAssignedAt')}</dt>
              <dd data-testid="od-assigned-at">{fmt(detail.delivery.assignedAt)}</dd>
              {detail.delivery.acceptDeadlineAt && (
                <>
                  <dt className="text-gray-500">{t('odAcceptDeadline')}</dt>
                  <dd>{fmt(detail.delivery.acceptDeadlineAt)}</dd>
                </>
              )}
              {detail.delivery.assignedAt && (
                <>
                  <dt className="text-gray-500">{t('odAcknowledgedAt')}</dt>
                  <dd data-testid="od-acknowledged-at">{detail.delivery.acknowledgedAt ? fmt(detail.delivery.acknowledgedAt) : t('odNotAcknowledged')}</dd>
                </>
              )}
              <dt className="text-gray-500">{t('odPickedUpAt')}</dt>
              <dd>{fmt(detail.delivery.pickedUpAt)}</dd>
              <dt className="text-gray-500">{t('odDeliveredAt')}</dt>
              <dd>{fmt(detail.delivery.deliveredAt)}</dd>
              <dt className="text-gray-500">{t('odReassignments')}</dt>
              <dd data-testid="od-reassignments">{detail.delivery.reassignmentCount}</dd>
            </dl>
          )}
          {flash && (
            <p role="status" data-testid="od-flash" className={`mt-2 text-xs ${flash.ok ? 'text-green-700' : 'text-amber-800'}`}>
              {flash.message}
            </p>
          )}
          {dispatchable && canAssign === false && <p className="mt-2 text-xs text-gray-500">{t('dxNoPermission')}</p>}
          {dispatchable && canAssign === true && driversError && <p className="mt-2 text-xs text-red-600">{driversError}</p>}
          {dispatchable && canAssign === true && drivers && (
            <div className="mt-2">
              <DispatchAction
                orderId={detail.id}
                orderNumber={detail.orderNumber}
                status={detail.status}
                currentDriver={detail.driver}
                drivers={drivers}
                onChanged={async (outcome) => {
                  setFlash(outcome);
                  await onChanged();
                }}
              />
            </div>
          )}
        </>
      )}

      {detail.dispatchAlerts && detail.dispatchAlerts.length > 0 && (
        <div className="mt-3">
          <h3 className="text-xs font-medium uppercase text-gray-500">{t('odDispatchAlerts')}</h3>
          <ul className="mt-1 space-y-0.5" data-testid="od-alerts">
            {detail.dispatchAlerts.map((a) => (
              <li key={a.id}>
                {t(`opReason_${a.reason}` as MessageKey)}{a.detail ? ` (${a.detail})` : ''} — {fmt(a.createdAt)} ·{' '}
                <span className={a.resolvedAt ? 'text-green-700' : 'text-amber-800'}>{a.resolvedAt ? `${t('ctAlertResolved')} ${fmt(a.resolvedAt)}` : t('ctAlertOpen')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {detail.dispatchAttempts && <DispatchAttemptsList attempts={detail.dispatchAttempts} />}

      {detail.timeline && detail.timeline.length > 0 && (
        <div className="mt-3">
          <h3 className="text-xs font-medium uppercase text-gray-500">{t('odTimeline')}</h3>
          <ol className="mt-1 space-y-0.5" data-testid="od-timeline">
            {detail.timeline.map((e, i) => (
              <li key={`${e.status}-${e.at}-${i}`} className="relative border-s-2 border-gray-200 ps-3 pb-2 last:pb-0">
                <span aria-hidden className="absolute -start-[5px] top-1.5 h-2 w-2 rounded-full bg-hatly-orange" />
                <span className="font-medium">{label(ORDER_STATUS, e.status, tl)}</span> — {fmt(e.at)}
                {e.actorRole && <span className="ms-1 text-gray-500">({t('odBy', { role: e.actorRole })})</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

/**
 * U2 — the admin support fallback for a PICKUP order the customer collected (normally the branch confirms it). Needs
 * MANAGE_ORDER_ISSUES, the same permission the backend requires of an ADMIN moving an order; confirmed before sending,
 * double-click safe, and the order is always re-read afterwards (whoever won, the page shows the backend's truth).
 */
function PickupCollection({ detail, onChanged }: { detail: AdminOrderDetail; onChanged: () => Promise<void> | void }) {
  const { t } = useI18n();
  const canCollect = useAdminPermission('MANAGE_ORDER_ISSUES');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ ok: boolean; message: string } | null>(null);
  const busyRef = useRef(false);

  if (detail.status === 'COLLECTED') {
    return (
      <p className="mt-2 text-green-700" data-testid="od-collected" role="status">
        {flash?.ok ? flash.message : t('odPickupCollectedDone')}
      </p>
    );
  }
  if (detail.status !== 'READY_FOR_PICKUP') return null;

  async function collect() {
    if (busyRef.current) return;
    if (!window.confirm(t('odPickupCollectConfirm', { order: detail.orderNumber }))) return;
    busyRef.current = true;
    setBusy(true);
    setFlash(null);
    try {
      await markOrderCollected(detail.id);
      setFlash({ ok: true, message: t('odPickupCollected', { order: detail.orderNumber }) });
    } catch (err) {
      setFlash({ ok: false, message: apiErrorMessage(err, t('odPickupCollectFailed')) });
    } finally {
      await onChanged();
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="mt-2">
      {canCollect === true && (
        <button data-testid="od-mark-collected" onClick={collect} disabled={busy} className="rounded-lg border px-3 py-1 font-medium disabled:opacity-50 border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40">
          {busy ? t('odPickupCollecting') : t('odPickupCollect')}
        </button>
      )}
      {canCollect === false && <p className="text-xs text-gray-500">{t('odPickupCollectNoPermission')}</p>}
      {flash && !flash.ok && (
        <p role="alert" data-testid="od-collect-error" className="mt-1 text-xs text-red-600">
          {flash.message}
        </p>
      )}
    </div>
  );
}
