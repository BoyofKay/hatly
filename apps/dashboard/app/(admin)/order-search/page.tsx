'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AdminOrderListItem, FULFILLMENT_TYPES, ORDER_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES, searchAdminOrders } from '../../../lib/api/admin-order-search';
import { apiErrorMessage } from '../../../lib/api/errors';
import { FULFILLMENT, ORDER_STATUS, PAYMENT_METHOD, PAYMENT_STATUS, label } from '../../../lib/admin/labels';
import { I18nProvider, useI18n } from '../../../lib/i18n/i18n';
import { useLang } from '../../../lib/ui/lang';
import { Badge, Button, Card, Column, DataTable, inputCls, LabeledSelect, PageHeader, Pagination, StatusPill } from '../../../components/ui';

/**
 * Admin Order Search — find any order and open its detail. One search box (order number, order id, customer phone or name) plus filters; the less
 * common filters sit behind "More filters" with a count of what is active. Reuses `GET admin/orders` exactly. Filters live in the URL so a result list
 * can be shared or reloaded, and `?status=` / `?fulfillmentType=` links from the Control Tower still pre-select the filter.
 */
export default function OrderSearchPage() {
  return (
    <I18nProvider>
      <OrderSearchScreen />
    </I18nProvider>
  );
}

const pickOne = (v: string | null, allowed: readonly string[]) => (v && allowed.includes(v) ? v : '');

function OrderSearchScreen() {
  const { t } = useI18n();
  const { t: tl, money, dateTime } = useLang();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [fulfillmentType, setFulfillmentType] = useState('');
  const [pricing, setPricing] = useState<'' | 'PENDING'>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);

  const [items, setItems] = useState<AdminOrderListItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(20);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const moreActive = [paymentStatus, paymentMethod, fulfillmentType, dateFrom, dateTo].filter(Boolean).length;
  const anyActive = moreActive + (pricing ? 1 : 0) + (status ? 1 : 0) + (search.trim() ? 1 : 0);

  const run = useCallback(async (targetPage: number, f: { search: string; status: string; paymentStatus: string; paymentMethod: string; fulfillmentType: string; pricing: string; dateFrom: string; dateTo: string }) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await searchAdminOrders({
        page: targetPage,
        search: f.search.trim() || undefined,
        status: f.status || undefined,
        paymentStatus: f.paymentStatus || undefined,
        paymentMethod: f.paymentMethod || undefined,
        fulfillmentType: f.fulfillmentType || undefined,
        hasPendingPricing: f.pricing === 'PENDING' ? true : undefined,
        dateFrom: f.dateFrom ? new Date(f.dateFrom).toISOString() : undefined,
        dateTo: f.dateTo ? new Date(f.dateTo).toISOString() : undefined,
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
  }, [t]);

  const current = () => ({ search, status, paymentStatus, paymentMethod, fulfillmentType, pricing, dateFrom, dateTo });

  function syncUrl(f: ReturnType<typeof current>) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) q.set(k, v);
    window.history.replaceState(null, '', q.toString() ? `?${q}` : window.location.pathname);
  }

  function apply(next: Partial<ReturnType<typeof current>> = {}, targetPage = 1) {
    const f = { ...current(), ...next };
    syncUrl(f);
    void run(targetPage, f);
  }

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const f = {
      search: q.get('search') ?? '',
      status: pickOne(q.get('status'), ORDER_STATUSES),
      paymentStatus: pickOne(q.get('paymentStatus'), PAYMENT_STATUSES),
      paymentMethod: pickOne(q.get('paymentMethod'), PAYMENT_METHODS),
      fulfillmentType: pickOne(q.get('fulfillmentType'), FULFILLMENT_TYPES),
      pricing: q.get('pricing') === 'PENDING' ? 'PENDING' : '',
      dateFrom: /^\d{4}-\d{2}-\d{2}$/.test(q.get('dateFrom') ?? '') ? q.get('dateFrom')! : '',
      dateTo: /^\d{4}-\d{2}-\d{2}$/.test(q.get('dateTo') ?? '') ? q.get('dateTo')! : '',
    };
    setSearch(f.search); setStatus(f.status); setPaymentStatus(f.paymentStatus); setPaymentMethod(f.paymentMethod);
    setFulfillmentType(f.fulfillmentType); setPricing(f.pricing as '' | 'PENDING'); setDateFrom(f.dateFrom); setDateTo(f.dateTo);
    if (f.paymentStatus || f.paymentMethod || f.fulfillmentType || f.dateFrom || f.dateTo) setMoreOpen(true);
    void run(1, f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearAll() {
    setSearch(''); setStatus(''); setPaymentStatus(''); setPaymentMethod(''); setFulfillmentType(''); setPricing(''); setDateFrom(''); setDateTo('');
    apply({ search: '', status: '', paymentStatus: '', paymentMethod: '', fulfillmentType: '', pricing: '', dateFrom: '', dateTo: '' });
  }

  const columns: Column<AdminOrderListItem>[] = [
    {
      key: 'order', header: t('listColOrder'),
      cell: (o) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <Link href={`/order-search/${o.id}`} className="font-mono text-xs font-semibold text-gray-900 hover:underline">{o.orderNumber}</Link>
          {o.hasPendingHatlyServicePricing && <span data-testid="pending-price-badge"><Badge tone="amber">{t('priceBadge')}</Badge></span>}
        </span>
      ),
    },
    {
      key: 'status', header: t('listColStatus'),
      cell: (o) => (
        <span className="inline-flex flex-wrap items-center justify-end gap-1 md:justify-start">
          <StatusPill status={o.status} label={label(ORDER_STATUS, o.status, tl)} />
          {o.fulfillmentType === 'PICKUP' && <span data-testid="pickup-badge"><Badge tone="blue">{t('listFulfillmentPickup')}</Badge></span>}
        </span>
      ),
    },
    { key: 'customer', header: t('listColCustomer'), cell: (o) => (o.customer ? <span><span className="font-medium text-gray-900">{o.customer.fullName}</span> <span dir="ltr" className="text-xs text-gray-500">{o.customer.phone}</span></span> : '—') },
    { key: 'total', header: t('listColTotal'), align: 'end', cell: (o) => (o.totalMinor != null ? money(o.totalMinor) : o.hasPendingHatlyServicePricing ? t('totalPendingShort') : t('dash')) },
    {
      key: 'payment', header: t('listColPayment'),
      cell: (o) => (
        <span className="inline-flex flex-wrap items-center justify-end gap-1 md:justify-start">
          <span className="text-gray-700">{label(PAYMENT_METHOD, o.paymentMethod, tl)}</span>
          {o.paymentStatus && <StatusPill status={o.paymentStatus} label={label(PAYMENT_STATUS, o.paymentStatus, tl)} />}
        </span>
      ),
    },
    { key: 'segments', header: t('listColSegments'), align: 'end', cell: (o) => o.segmentCount },
    { key: 'created', header: t('listColCreated'), cell: (o) => <span className="whitespace-nowrap text-gray-600">{dateTime(o.createdAt)}</span> },
    { key: 'open', header: '', align: 'end', cell: (o) => <Link href={`/order-search/${o.id}`} className="inline-flex min-h-[36px] items-center font-medium text-hatly-orangeDark hover:underline">{t('listOpen')}</Link> },
  ];

  return (
    <div className="max-w-6xl">
      <PageHeader title={t('listTitle')} subtitle={tl('Find any order by number, customer or status, then open it to see the full history.', 'ابحث عن أي طلب برقمه أو بالعميل أو بالحالة ثم افتحه لمشاهدة السجل الكامل.')} />

      <form onSubmit={(e) => { e.preventDefault(); apply(); }} className="mb-4 space-y-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm sm:p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('listSearchPlaceholder')} aria-label={t('listSearchPlaceholder')}
            className={`${inputCls} min-h-[44px] flex-1 sm:min-h-0`} data-testid="os-search"
          />
          <Button type="submit" variant="primary" loading={isLoading} className="min-h-[44px] sm:min-h-0">{isLoading ? t('listSearching') : t('listSearch')}</Button>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,16rem)_minmax(0,16rem)_auto_auto] sm:items-end">
          <LabeledSelect label={t('listColStatus')} value={status} onChange={(e) => { setStatus(e.target.value); apply({ status: e.target.value }); }}>
            <option value="">{t('listAnyStatus')}</option>
            {ORDER_STATUSES.map((s) => <option key={s} value={s}>{label(ORDER_STATUS, s, tl)}</option>)}
          </LabeledSelect>
          <LabeledSelect label={t('listPricingFilterLabel')} value={pricing} onChange={(e) => { setPricing(e.target.value as '' | 'PENDING'); apply({ pricing: e.target.value as '' | 'PENDING' }); }} aria-label={t('listPricingFilterLabel')}>
              <option value="">{t('listPricingAll')}</option>
              <option value="PENDING">{t('listPricingPending')}</option>
            </LabeledSelect>
          <Button type="button" onClick={() => setMoreOpen((v) => !v)} aria-expanded={moreOpen} className="min-h-[40px]">
            {tl('More filters', 'المزيد من الفلاتر')}{moreActive > 0 && <Badge tone="orange">{moreActive}</Badge>}
          </Button>
          {anyActive > 0 && <Button type="button" variant="ghost" onClick={clearAll} className="min-h-[40px]">{tl('Clear filters', 'مسح الفلاتر')}</Button>}
        </div>
        {moreOpen && (
          <div className="grid gap-3 border-t border-gray-100 pt-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="os-more">
            <LabeledSelect label={t('listColPayment')} value={paymentStatus} onChange={(e) => { setPaymentStatus(e.target.value); apply({ paymentStatus: e.target.value }); }}>
              <option value="">{t('listAnyPaymentStatus')}</option>
              {PAYMENT_STATUSES.map((s) => <option key={s} value={s}>{label(PAYMENT_STATUS, s, tl)}</option>)}
            </LabeledSelect>
            <LabeledSelect label={tl('Payment method', 'طريقة الدفع')} value={paymentMethod} onChange={(e) => { setPaymentMethod(e.target.value); apply({ paymentMethod: e.target.value }); }}>
              <option value="">{t('listAnyPaymentMethod')}</option>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{label(PAYMENT_METHOD, m, tl)}</option>)}
            </LabeledSelect>
            <LabeledSelect label={t('listFulfillmentLabel')} value={fulfillmentType} onChange={(e) => { setFulfillmentType(e.target.value); apply({ fulfillmentType: e.target.value }); }} aria-label={t('listFulfillmentLabel')} data-testid="list-fulfillment">
              <option value="">{t('listAnyFulfillment')}</option>
              {FULFILLMENT_TYPES.map((f) => <option key={f} value={f}>{label(FULFILLMENT, f, tl)}</option>)}
            </LabeledSelect>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="os-from">{tl('From', 'من')}</label>
              <input id="os-from" type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); apply({ dateFrom: e.target.value }); }} className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="os-to">{t('listTo')}</label>
              <input id="os-to" type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); apply({ dateTo: e.target.value }); }} className={inputCls} />
            </div>
          </div>
        )}
      </form>

      <Card pad={false}>
        {items && (
          <p className="border-b border-gray-100 px-4 py-2 text-xs text-gray-500" aria-live="polite" data-testid="os-count">
            {tl(`${total} order${total === 1 ? '' : 's'}`, `${total} طلب`)}
          </p>
        )}
        <DataTable
          columns={columns}
          rows={items ?? undefined}
          rowKey={(o) => o.id}
          loading={isLoading}
          error={error}
          onRetry={() => apply({}, page)}
          emptyTitle={pricing === 'PENDING' ? t('listEmptyPending') : t('listEmpty')}
          emptyHint={anyActive > 0 ? tl('Try removing a filter or checking the spelling.', 'جرّب إزالة أحد الفلاتر أو مراجعة الكتابة.') : undefined}
          onRowClick={(o) => router.push(`/order-search/${o.id}`)}
          renderCard={(o) => (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-sm font-semibold text-gray-900">{o.orderNumber}</span>
                  {o.hasPendingHatlyServicePricing && <Badge tone="amber">{t('priceBadge')}</Badge>}
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-gray-900">{o.totalMinor != null ? money(o.totalMinor) : o.hasPendingHatlyServicePricing ? t('totalPendingShort') : t('dash')}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusPill status={o.status} label={label(ORDER_STATUS, o.status, tl)} />
                {o.fulfillmentType === 'PICKUP' && <Badge tone="blue">{t('listFulfillmentPickup')}</Badge>}
                {o.paymentStatus && <StatusPill status={o.paymentStatus} label={`${label(PAYMENT_METHOD, o.paymentMethod, tl)} · ${label(PAYMENT_STATUS, o.paymentStatus, tl)}`} />}
              </div>
              <p className="flex items-center justify-between gap-2 text-xs text-gray-500">
                <span className="min-w-0 truncate">{o.customer ? o.customer.fullName : '—'}</span>
                <span className="shrink-0">{dateTime(o.createdAt)}</span>
              </p>
            </div>
          )}
        />
        {items && items.length > 0 && <Pagination page={page} limit={limit} total={total} onPage={(p) => apply({}, p)} />}
      </Card>
    </div>
  );
}
