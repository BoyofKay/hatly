'use client';

import { useEffect, useState } from 'react';
import { formatMinor } from '../../../lib/money';
import Link from 'next/link';
import {
  AdminOrderListItem,
  FULFILLMENT_TYPES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  searchAdminOrders,
} from '../../../lib/api/admin-order-search';
import { I18nProvider, useI18n } from '../../../lib/i18n/i18n';
import { LocaleToggle } from '../../../components/orders/LocaleToggle';
import { apiErrorMessage } from '../../../lib/api/errors';

/**
 * M3b (Launch-Readiness Gap Audit, G-04) — Admin Order Search. Reuses
 * the new, unchanged `GET admin/orders` endpoint exactly; opening a
 * result reuses the EXISTING admin order detail endpoint via
 * `/order-search/[id]` (a thin, read-only presentation page — see that
 * page's own top comment for why it isn't the Failed-Delivery detail
 * page). Mirrors this dashboard's established list-page conventions
 * (Failed Deliveries' table layout, Dispatch's loading/error/retry
 * shape) rather than inventing a new one.
 */
export default function OrderSearchPage() {
  return (
    <I18nProvider>
      <OrderSearchScreen />
    </I18nProvider>
  );
}

function OrderSearchScreen() {
  const { t } = useI18n();
  const [pricing, setPricing] = useState<'' | 'PENDING'>('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [fulfillmentType, setFulfillmentType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<AdminOrderListItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(20);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function runSearch(targetPage = page, statusOverride?: string, fulfillmentOverride?: string) {
    setIsLoading(true);
    setError(null);
    const effectiveStatus = statusOverride ?? status;
    const effectiveFulfillment = fulfillmentOverride ?? fulfillmentType;
    try {
      const result = await searchAdminOrders({
        page: targetPage,
        search: search || undefined,
        status: effectiveStatus || undefined,
        paymentStatus: paymentStatus || undefined,
        paymentMethod: paymentMethod || undefined,
        fulfillmentType: effectiveFulfillment || undefined,
        hasPendingPricing: pricing === 'PENDING' ? true : undefined,
        dateFrom: dateFrom ? new Date(dateFrom).toISOString() : undefined,
        dateTo: dateTo ? new Date(dateTo).toISOString() : undefined,
      });
      setItems(result.data);
      setTotal(result.meta.total);
      setLimit(result.meta.limit);
      setPage(result.meta.page);
    } catch (err: any) {
      setError(apiErrorMessage(err, t('listFailed')));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    // A valid `?status=` / `?fulfillmentType=` (e.g. from a Control Tower count) pre-selects the filter; anything else is ignored.
    const query = new URLSearchParams(window.location.search);
    const fromUrl = query.get('status') ?? '';
    const initialStatus = (ORDER_STATUSES as readonly string[]).includes(fromUrl) ? fromUrl : '';
    if (initialStatus) setStatus(initialStatus);
    const fulfillmentFromUrl = query.get('fulfillmentType') ?? '';
    const initialFulfillment = (FULFILLMENT_TYPES as readonly string[]).includes(fulfillmentFromUrl) ? fulfillmentFromUrl : '';
    if (initialFulfillment) setFulfillmentType(initialFulfillment);
    runSearch(1, initialStatus, initialFulfillment);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    runSearch(1);
  }

  const totalPages = Math.max(1, Math.ceil(total / (limit || 1)));

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">{t('listTitle')}</h1>
        <LocaleToggle />
      </div>

      <form onSubmit={handleSearchSubmit} className="mt-4 space-y-3 rounded border bg-white p-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('listSearchPlaceholder')}
          className="w-full rounded border px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap gap-2">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded border px-2 py-1.5 text-sm">
            <option value="">{t('listAnyStatus')}</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)} className="rounded border px-2 py-1.5 text-sm">
            <option value="">{t('listAnyPaymentStatus')}</option>
            {PAYMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="rounded border px-2 py-1.5 text-sm">
            <option value="">{t('listAnyPaymentMethod')}</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <select
            value={fulfillmentType}
            onChange={(e) => setFulfillmentType(e.target.value)}
            aria-label={t('listFulfillmentLabel')}
            data-testid="list-fulfillment"
            className="rounded border px-2 py-1.5 text-sm"
          >
            <option value="">{t('listAnyFulfillment')}</option>
            {FULFILLMENT_TYPES.map((f) => (
              <option key={f} value={f}>
                {t(f === 'PICKUP' ? 'listFulfillmentPickup' : 'listFulfillmentDelivery')}
              </option>
            ))}
          </select>
          <select
            value={pricing}
            onChange={(e) => setPricing(e.target.value as '' | 'PENDING')}
            aria-label={t('listPricingFilterLabel')}
            className="rounded border px-2 py-1.5 text-sm"
          >
            <option value="">{t('listPricingAll')}</option>
            <option value="PENDING">{t('listPricingPending')}</option>
          </select>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded border px-2 py-1.5 text-sm" />
          <span className="self-center text-sm text-gray-400">{t('listTo')}</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded border px-2 py-1.5 text-sm" />
          <button type="submit" disabled={isLoading} className="rounded bg-hatly-orange px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            {isLoading ? t('listSearching') : t('listSearch')}
          </button>
        </div>
      </form>

      {error && (
        <div className="mt-4 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}{' '}
          <button onClick={() => runSearch(page)} className="underline">
            {t('retry')}
          </button>
        </div>
      )}

      {!error && isLoading && items === null && <p className="mt-4 text-gray-500">{t('loading')}</p>}
      {!error && items !== null && items.length === 0 && <p className="mt-4 text-gray-500">{pricing === 'PENDING' ? t('listEmptyPending') : t('listEmpty')}</p>}

      {!error && items !== null && items.length > 0 && (
        <>
          <div className="mt-4 overflow-x-auto rounded border bg-white">
            <table className="w-full text-start text-sm">
              <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-2">{t('listColOrder')}</th>
                  <th className="px-4 py-2">{t('listColStatus')}</th>
                  <th className="px-4 py-2">{t('listColCustomer')}</th>
                  <th className="px-4 py-2">{t('listColTotal')}</th>
                  <th className="px-4 py-2">{t('listColPayment')}</th>
                  <th className="px-4 py-2">{t('listColSegments')}</th>
                  <th className="px-4 py-2">{t('listColCreated')}</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {items.map((order) => (
                  <tr key={order.id} className="border-b last:border-0">
                    <td className="px-4 py-2 font-mono text-xs">
                      {order.orderNumber}
                      {order.hasPendingHatlyServicePricing && (
                        <span
                          className="ms-2 inline-block rounded bg-amber-100 px-2 py-0.5 font-sans text-xs font-medium text-amber-800"
                          data-testid="pending-price-badge"
                        >
                          {t('priceBadge')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{order.status}</span>
                      {order.fulfillmentType === 'PICKUP' && (
                        <span className="ms-1 rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-800" data-testid="pickup-badge">
                          {t('listFulfillmentPickup')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {order.customer ? `${order.customer.fullName} (${order.customer.phone})` : '—'}
                    </td>
                    <td className="px-4 py-2">
                      {order.totalMinor != null ? formatMinor(order.totalMinor) : order.hasPendingHatlyServicePricing ? t('totalPendingShort') : t('dash')}
                    </td>
                    <td className="px-4 py-2">
                      {order.paymentMethod}
                      {order.paymentStatus ? ` (${order.paymentStatus})` : ''}
                    </td>
                    <td className="px-4 py-2">{order.segmentCount}</td>
                    <td className="px-4 py-2">{new Date(order.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-2 text-end">
                      <Link href={`/order-search/${order.id}`} className="text-hatly-orange underline">
                        {t('listOpen')}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex items-center justify-between text-sm text-gray-600">
            <span>
              {total === 1 ? t('listPageOfOne', { page, pages: totalPages }) : t('listPageOf', { page, pages: totalPages, total })}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => runSearch(page - 1)}
                disabled={isLoading || page <= 1}
                className="rounded border px-3 py-1 disabled:opacity-50"
              >
                {t('listPrevious')}
              </button>
              <button
                onClick={() => runSearch(page + 1)}
                disabled={isLoading || page >= totalPages}
                className="rounded border px-3 py-1 disabled:opacity-50"
              >
                {t('listNext')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
