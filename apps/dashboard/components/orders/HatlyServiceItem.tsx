'use client';

import { useEffect, useRef, useState } from 'react';
import type { AdminOrderDetail, AdminHatlyService } from '../../lib/api/admin-failed-deliveries';
import { classifyPricingError, confirmHatlyServicePrice } from '../../lib/api/admin-hatly-service-pricing';
import { useI18n } from '../../lib/i18n/i18n';
import type { MessageKey } from '../../lib/i18n/messages';
import { formatMinor, parseEgpToMinor } from '../../lib/money';
import { resolveMediaUrl } from '../../lib/media-url';
import { deliveryAddressText } from '../../lib/delivery-address';

type Item = AdminOrderDetail['segments'][number]['items'][number];

const NOT_PRICEABLE_STATUSES = ['DELIVERED', 'CANCELLED', 'FAILED_DELIVERY'];

function coords(lat: number | null, lng: number | null) {
  return lat != null && lng != null ? { lat, lng } : null;
}

/**
 * Origin → destination of a Hatly / Wasally request. From PD-012 on the order carries its frozen route (label, coordinates, and whether each end
 * was the customer's choice or the service default). An order placed before that has no route: it is shown by the earlier semantics (the chosen
 * place and the customer's own address).
 */
export function HatlyServiceRoute({ service, detail }: { service: AdminHatlyService; detail: AdminOrderDetail }) {
  const { t, locale } = useI18n();
  if (service.route) {
    const text = (p: NonNullable<AdminHatlyService['route']>['origin']) =>
      t('hsRoutePoint', {
        label: p.label ?? t('dash'),
        lat: p.latitude,
        lng: p.longitude,
        source: p.source === 'DEFAULT' ? t('hsRouteDefault') : t('hsRouteCustomer'),
      });
    return (
      <dl className="mt-1 grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 text-sm" data-testid="hatly-route">
        <dt className="text-gray-500">{t('hsServiceType')}</dt>
        <dd>{service.serviceType === 'BUY_FROM_PLACE' ? t('hsTypeBuy') : service.serviceType === 'DELIVER_TO_PLACE' ? t('hsTypeDeliver') : t('dash')}</dd>
        <dt className="text-gray-500">{t('hsFrom')}</dt>
        <dd data-testid="hatly-route-origin">{text(service.route.origin)}</dd>
        <dt className="text-gray-500">{t('hsTo')}</dt>
        <dd data-testid="hatly-route-destination">{text(service.route.destination)}</dd>
      </dl>
    );
  }
  const address = detail.deliveryAddress;
  const customerAddress = address ? t('hsCustomerAddress', { address: deliveryAddressText(address, locale) }) : t('dash');
  const placeName = service.placeName ?? t('dash');
  const buy = service.serviceType === 'BUY_FROM_PLACE';
  const placeCoords = buy ? coords(service.pickupLatitude, service.pickupLongitude) : coords(service.destinationLatitude, service.destinationLongitude);
  const place = placeCoords ? t('hsPlaceLocation', { name: placeName, lat: placeCoords.lat, lng: placeCoords.lng }) : placeName;
  return (
    <dl className="mt-1 grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 text-sm">
      <dt className="text-gray-500">{t('hsServiceType')}</dt>
      <dd>{buy ? t('hsTypeBuy') : service.serviceType === 'DELIVER_TO_PLACE' ? t('hsTypeDeliver') : t('dash')}</dd>
      <dt className="text-gray-500">{t('hsFrom')}</dt>
      <dd>{buy ? place : customerAddress}</dd>
      <dt className="text-gray-500">{t('hsTo')}</dt>
      <dd>{buy ? customerAddress : place}</dd>
    </dl>
  );
}

/**
 * One Hatly Service request with its price state. PENDING: a price input + "Confirm price" (when the admin holds
 * MANAGE_HATLY_SERVICE_PRICING). CONFIRMED: the amount. The order is always re-read from the backend after a confirmation
 * (`onChanged`) — nothing here computes a total.
 */
export function HatlyServiceItem({
  item,
  orderStatus,
  canConfirm,
  onChanged,
}: {
  item: Item;
  orderStatus: string;
  /** `null` while the admin's permissions are still loading (or could not be read): treated as "not allowed". */
  canConfirm: boolean | null;
  onChanged: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [notice, setNotice] = useState<MessageKey | null>(null);
  const inFlight = useRef(false); // state updates are async: a ref is what actually stops a rapid double-click
  const mounted = useRef(true);
  // Set in the effect body too: React StrictMode (dev) runs mount → cleanup → mount, and the cleanup alone would leave it false.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const pending = item.priceStatus !== 'CONFIRMED';
  const finished = NOT_PRICEABLE_STATUSES.includes(orderStatus);
  const inputId = `price-${item.id}`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current || canConfirm !== true) return;
    const parsed = parseEgpToMinor(value);
    if (!parsed.ok) {
      setNotice(null);
      setError(parsed.reason === 'EMPTY' ? 'errEmpty' : parsed.reason === 'NOT_POSITIVE' ? 'errNotPositive' : 'errFormat');
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const confirmed = await confirmHatlyServicePrice(item.id, parsed.minor);
      await onChanged();
      if (mounted.current) setNotice(confirmed.alreadyApplied ? 'hsAlreadyApplied' : 'hsConfirmSuccess');
    } catch (err) {
      const failure = classifyPricingError(err);
      if (mounted.current) setError(failure.message);
      // A conflict means another admin/driver already priced it: show the current authoritative state, not a stale form.
      if (failure.kind === 'CONFLICT') await onChanged().catch(() => undefined);
    } finally {
      inFlight.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }

  return (
    <div className="mt-2 rounded border border-gray-200 p-3" data-testid={`hatly-item-${item.id}`} data-price-status={item.priceStatus ?? ''}>
      <p className="font-medium">{item.freeTextDescription ?? t('hsNoDescription')}</p>
      <p className="text-xs text-gray-500">
        {t('hsQuantity')}: {item.quantity}
      </p>

      {item.imageUrls && item.imageUrls.length > 0 && (
        <div className="mt-2">
          <p className="text-xs text-gray-500">{t('hsImages')}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {item.imageUrls.map((url) => (
              <a key={url} href={resolveMediaUrl(url)} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={resolveMediaUrl(url)} alt={t('hsImages')} className="h-16 w-16 rounded object-cover" />
              </a>
            ))}
          </div>
        </div>
      )}

      {!pending ? (
        <p className="mt-2 text-sm" data-testid="price-confirmed">
          <span className="text-gray-500">{t('hsPriceConfirmed')}: </span>
          <span className="font-medium">
            {formatMinor(item.actualAmountMinor ?? 0)} {t('currency')}
          </span>
        </p>
      ) : (
        <div className="mt-2">
          <p className="inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800" data-testid="price-pending">
            {t('hsPricePending')}
          </p>
          {finished ? (
            <p className="mt-2 text-xs text-gray-500">{t('errNotPriceable')}</p>
          ) : canConfirm === true ? (
            <form onSubmit={submit} className="mt-2 flex flex-wrap items-start gap-2" noValidate>
              <div>
                <label htmlFor={inputId} className="block text-xs text-gray-600">
                  {t('hsPriceInputLabel')}
                </label>
                <input
                  id={inputId}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={value}
                  onChange={(e) => {
                    setValue(e.target.value);
                    setError(null);
                  }}
                  disabled={submitting}
                  aria-invalid={error != null && error.startsWith('err')}
                  aria-describedby={`${inputId}-hint`}
                  className="w-36 rounded-lg border px-2 py-1.5 text-sm disabled:opacity-60 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100"
                  dir="ltr"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="mt-[18px] rounded-lg bg-hatly-orange px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 shadow-sm hover:bg-hatly-orangeDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40"
              >
                {submitting ? t('hsConfirming') : t('hsConfirmPrice')}
              </button>
              <p id={`${inputId}-hint`} className="basis-full text-xs text-gray-500">
                {t('hsPriceInputHint')}
              </p>
            </form>
          ) : (
            <div className="mt-2">
              <button type="button" disabled className="rounded bg-gray-200 px-3 py-1.5 text-sm font-medium text-gray-500">
                {t('hsConfirmPrice')}
              </button>
              <p className="mt-1 text-xs text-gray-600" data-testid="no-permission">
                {canConfirm === false ? t('hsNoPermission') : t('hsPermissionLoading')}
              </p>
            </div>
          )}
        </div>
      )}

      <div aria-live="polite">
        {error && (
          <p className="mt-2 text-sm text-red-700" role="alert" data-testid="price-error">
            {t(error)}
          </p>
        )}
        {notice && (
          <p className="mt-2 text-sm text-green-700" role="status" data-testid="price-notice">
            {t(notice)}
          </p>
        )}
      </div>
    </div>
  );
}
