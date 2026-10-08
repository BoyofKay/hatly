'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { AdminOrderDetail, getAdminOrderDetail } from '../../../../lib/api/admin-failed-deliveries';
import { MANAGE_HATLY_SERVICE_PRICING } from '../../../../lib/api/admin-hatly-service-pricing';
import { useAdminPermission } from '../../../../lib/auth/use-admin-permission';
import { I18nProvider, useI18n } from '../../../../lib/i18n/i18n';
import { formatMinor } from '../../../../lib/money';
import { DispatchDriver, listDispatchDrivers } from '../../../../lib/api/admin-control-tower';
import { DispatchAction } from '../../../../components/operations/DispatchAction';
import { markOrderCollected } from '../../../../lib/api/order-collection';
import { deliveryAddressText } from '../../../../lib/delivery-address';
import { LocaleToggle } from '../../../../components/orders/LocaleToggle';
import { HatlyServiceItem, HatlyServiceRoute } from '../../../../components/orders/HatlyServiceItem';
import { OrderTotals } from '../../../../components/orders/OrderTotals';
import { apiErrorMessage } from '../../../../lib/api/errors';

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
export default function OrderSearchDetailPage() {
  return (
    <I18nProvider>
      <OrderDetailScreen />
    </I18nProvider>
  );
}

function OrderDetailScreen() {
  const { t, locale } = useI18n();
  const params = useParams();
  const orderId = params.id as string;
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

  if (error) {
    return (
      <div className="mx-auto max-w-3xl rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error}{' '}
        <button onClick={refresh} className="underline">
          {t('retry')}
        </button>
      </div>
    );
  }
  if (!detail) return <p className="mx-auto max-w-3xl text-gray-500">{t('loading')}</p>;

  const pendingHatlyCount = detail.segments
    .filter((s) => s.groupType === 'AD_HOC_SERVICE')
    .flatMap((s) => s.items)
    .filter((i) => i.priceStatus !== 'CONFIRMED').length;
  const hasHatlyService = detail.segments.some((s) => s.groupType === 'AD_HOC_SERVICE');

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-xl font-semibold">
          {t('detailTitle', { number: detail.orderNumber })}{' '}
          <span className="text-sm font-normal text-gray-500" dir="ltr">
            ({detail.id.slice(0, 8)})
          </span>
        </h1>
        <LocaleToggle />
      </div>

      <div className="rounded border bg-white p-4 text-sm">
        <p><span className="text-gray-500">{t('detailStatus')}:</span> {detail.status}</p>
        <p><span className="text-gray-500">{t('detailCreated')}:</span> {new Date(detail.createdAt).toLocaleString()}</p>
        <p><span className="text-gray-500">{t('detailCustomer')}:</span> {detail.customer?.fullName ?? detail.customerId} {detail.customer?.phone ? `(${detail.customer.phone})` : ''}</p>
        <p><span className="text-gray-500">{t('detailDriver')}:</span> {detail.driver?.fullName ?? t('dash')} {detail.driver?.phone ? `(${detail.driver.phone})` : ''}</p>
        {detail.deliveryAddress && (
          <p data-testid="order-delivery-address"><span className="text-gray-500">{t('detailDeliveryAddress')}:</span> {deliveryAddressText(detail.deliveryAddress, locale)}</p>
        )}
        <p><span className="text-gray-500">{t('detailPayment')}:</span> {detail.paymentMethod}{detail.payment ? ` — ${detail.payment.status} (${formatMinor(detail.payment.amountMinor ?? 0)})` : ''}</p>
        {detail.cancellationReason && <p><span className="text-gray-500">{t('detailCancellationReason')}:</span> {detail.cancellationReason} ({detail.cancelledByRole})</p>}
        {detail.failureReason && <p><span className="text-gray-500">{t('detailFailureReason')}:</span> {detail.failureReason}</p>}
      </div>

      <OrderTotals detail={detail} />

      <OperationsPanel detail={detail} onChanged={refresh} />

      <div className="rounded border bg-white p-4 text-sm">
        <h2 className="font-medium">{t('detailItems')}</h2>
        {hasHatlyService && (
          <p
            className={`mt-1 text-xs ${pendingHatlyCount > 0 ? 'font-medium text-amber-800' : 'text-gray-500'}`}
            data-testid="hatly-pending-summary"
          >
            {pendingHatlyCount > 0 ? t('hsPendingCount', { count: pendingHatlyCount }) : t('hsAllConfirmed')}
          </p>
        )}
        {detail.segments.map((segment) => (
          <div key={segment.id} className="mt-2 border-t pt-2 first:border-0 first:pt-0">
            <p className="text-xs text-gray-500">{t('detailSegment')} {segment.id.slice(0, 8)} — {segment.groupType} — {segment.status}</p>
            {segment.groupType === 'AD_HOC_SERVICE' ? (
              <>
                <p className="mt-1 text-sm font-medium">{t('hsHeading')}</p>
                {segment.hatlyService && <HatlyServiceRoute service={segment.hatlyService} detail={detail} />}
                {segment.items.map((item) => (
                  <HatlyServiceItem key={item.id} item={item} orderStatus={detail.status} canConfirm={canConfirmPrices} onChanged={refresh} />
                ))}
              </>
            ) : (
              segment.items.map((item) => (
                <p key={item.id} className="mt-1">
                  {item.productNameSnapshot ?? item.freeTextDescription ?? t('detailCustomItem')} &times; {item.quantity}
                  {item.unitPriceMinor != null && <span className="ms-2 text-gray-500">{formatMinor(item.unitPriceMinor)}</span>}
                </p>
              ))
            )}
          </div>
        ))}
      </div>

      <div className="rounded border bg-white p-4 text-sm">
        <h2 className="font-medium">{t('detailFinancialEvents')}</h2>
        {detail.financialEvents.length === 0 && <p className="text-gray-500">{t('detailNone')}</p>}
        {detail.financialEvents.map((e: any) => (
          <p key={e.id}>
            {e.type} — {e.amountMinor != null ? formatMinor(e.amountMinor) : t('dash')} ({e.direction})
          </p>
        ))}
      </div>
    </div>
  );
}

/**
 * Control Tower milestone — the order's delivery & dispatch state, its "no eligible driver" alerts, its status timeline, and
 * (for an admin holding ASSIGN_REASSIGN_ORDERS) the same assign / reassign control the Control Tower uses. After an action the
 * order is re-read from the backend.
 */
function OperationsPanel({ detail, onChanged }: { detail: AdminOrderDetail; onChanged: () => Promise<void> | void }) {
  const { t, locale } = useI18n();
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

  const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB') : t('dash'));

  return (
    <div className="rounded border bg-white p-4 text-sm" data-testid="order-operations">
      <h2 className="font-medium">{t('odOperations')}</h2>
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
                {t('ctAlertNoEligible')} — {fmt(a.createdAt)} ·{' '}
                <span className={a.resolvedAt ? 'text-green-700' : 'text-amber-800'}>{a.resolvedAt ? `${t('ctAlertResolved')} ${fmt(a.resolvedAt)}` : t('ctAlertOpen')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {detail.timeline && detail.timeline.length > 0 && (
        <div className="mt-3">
          <h3 className="text-xs font-medium uppercase text-gray-500">{t('odTimeline')}</h3>
          <ol className="mt-1 space-y-0.5" data-testid="od-timeline">
            {detail.timeline.map((e, i) => (
              <li key={`${e.status}-${e.at}-${i}`}>
                <span className="font-medium">{e.status.replace(/_/g, ' ')}</span> — {fmt(e.at)}
                {e.actorRole && <span className="ms-1 text-gray-500">({t('odBy', { role: e.actorRole })})</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
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
        <button data-testid="od-mark-collected" onClick={collect} disabled={busy} className="rounded border px-3 py-1 font-medium disabled:opacity-50">
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
