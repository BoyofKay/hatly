'use client';

import type { AdminOrderDetail } from '../../lib/api/admin-failed-deliveries';
import { useI18n } from '../../lib/i18n/i18n';
import { formatMinor } from '../../lib/money';

const AD_HOC = 'AD_HOC_SERVICE';

/**
 * Displays the backend's amounts — the order's `totalMinor` / `amountDueMinor` and each segment's own `subtotalMinor` — and never
 * a browser-computed total. While any Hatly Service price is PENDING the backend leaves the total null and this shows
 * "Pending price confirmation" instead of a number that could be mistaken for final.
 */
export function OrderTotals({ detail }: { detail: AdminOrderDetail }) {
  const { t } = useI18n();
  const money = (minor: number) => `${formatMinor(minor)} ${t('currency')}`;

  const vendorSegments = detail.segments.filter((s) => s.groupType !== AD_HOC);
  const hatlySegments = detail.segments.filter((s) => s.groupType === AD_HOC);
  const hatlyItems = hatlySegments.flatMap((s) => s.items);
  const hatlyPending = hatlyItems.filter((i) => i.priceStatus !== 'CONFIRMED').length;
  const totalPending = detail.totalMinor == null && (detail.hasPendingHatlyServicePricing ?? hatlyPending > 0);

  const sumSegments = (segments: typeof detail.segments) => segments.reduce((sum, s) => sum + (s.subtotalMinor ?? 0), 0);
  const walletMinor = detail.walletAmountMinor ?? 0;

  const row = (label: string, value: string, testId: string, strong = false) => (
    <div className={`flex justify-between gap-4 ${strong ? 'border-t pt-1 font-semibold' : ''}`} data-testid={testId}>
      <dt className={strong ? '' : 'text-gray-500'}>{label}</dt>
      <dd>{value}</dd>
    </div>
  );

  return (
    <div className="rounded-xl border bg-white p-4 text-sm border-gray-200 shadow-sm" data-testid="order-totals" data-total-pending={totalPending ? 'true' : 'false'}>
      <h2 className="font-medium">{t('totalsTitle')}</h2>
      <dl className="mt-2 space-y-1">
        {vendorSegments.length > 0 && row(t('totalsVendorItems'), money(sumSegments(vendorSegments)), 'totals-vendor')}
        {hatlySegments.length > 0 &&
          row(
            t('totalsHatlyServiceItems'),
            hatlyPending > 0
              ? t('totalsHatlyServicePending', { confirmed: hatlyItems.length - hatlyPending, all: hatlyItems.length })
              : money(sumSegments(hatlySegments)),
            'totals-hatly',
          )}
        {row(t('totalsDeliveryFee'), detail.deliveryFeeMinor != null ? money(detail.deliveryFeeMinor) : t('dash'), 'totals-delivery')}
        {detail.discountMinor > 0 && row(t('totalsDiscount'), `-${money(detail.discountMinor)}`, 'totals-discount')}
        {walletMinor > 0 && row(t('totalsWallet'), money(walletMinor), 'totals-wallet')}
        {row(t('totalsTotal'), totalPending ? t('totalsPending') : detail.totalMinor != null ? money(detail.totalMinor) : t('dash'), 'totals-total', true)}
        {row(
          t('totalsAmountDue'),
          totalPending ? t('totalsPending') : detail.amountDueMinor != null ? money(detail.amountDueMinor) : t('dash'),
          'totals-amount-due',
        )}
      </dl>
      {totalPending && <p className="mt-2 text-xs text-amber-800">{t('totalsPendingNote')}</p>}
    </div>
  );
}
