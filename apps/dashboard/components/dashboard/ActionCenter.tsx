'use client';

import Link from 'next/link';
import { useApi } from '../../lib/ui/api';
import { useLang } from '../../lib/ui/lang';
import { usePermissions } from '../../lib/ui/permissions';
import type { ControlTowerSummary } from '../../lib/api/admin-control-tower';

/**
 * "Needs your action now" — the first thing on the Admin Home. Every queue an admin works through, as one tile: how many are waiting and
 * one click straight to the list that resolves them. Each tile appears only for an admin allowed to act on it; the numbers are the backend's
 * own (control-tower summary, product and store requests). Display only — nothing here changes data.
 */
type Tone = 'urgent' | 'waiting';
interface Tile { id: string; count: number; en: string; ar: string; hintEn: string; hintAr: string; href: string; tone: Tone }

export function ActionCenter() {
  const { t, num } = useLang();
  const { can } = usePermissions();
  const summary = useApi<ControlTowerSummary>(can('VIEW_ORDERS') ? '/admin/control-tower/summary' : null, undefined, { refreshInterval: 20_000 });
  const products = useApi<any[]>(can('MANAGE_CATALOG', 'CATALOG_VIEW') ? '/admin/product-change-requests' : null, { status: 'PENDING' }, { refreshInterval: 60_000 });
  const stores = useApi<any[]>(can('MANAGE_VENDORS') ? '/admin/branch-change-requests' : null, { status: 'PENDING' }, { refreshInterval: 60_000 });

  const s = summary.data;
  const ops = s?.operations;
  const alerts = ops?.openDispatchAlerts;
  const tiles: Tile[] = [];
  if (s && ops) {
    tiles.push(
      { id: 'needs-driver', count: s.attention.awaitingAssignment, en: 'Need a driver', ar: 'تحتاج سائقًا', hintEn: 'Ready orders with no driver yet', hintAr: 'طلبات جاهزة بلا سائق', href: '/order-management?view=needsDriver', tone: 'urgent' },
      { id: 'accept-overdue', count: ops.pendingAcceptanceOverdue, en: 'Store has not accepted', ar: 'لم يقبلها المتجر', hintEn: `Waiting more than ${ops.pendingAcceptanceAlertMinutes} min — call the store`, hintAr: `تنتظر أكثر من ${ops.pendingAcceptanceAlertMinutes} دقائق — اتصل بالمتجر`, href: '/order-management?view=pending', tone: 'urgent' },
      { id: 'prep-overdue', count: ops.preparationOverdue, en: 'Preparation late', ar: 'تحضير متأخر', hintEn: 'Past the expected ready time', hintAr: 'تجاوزت وقت التجهيز المتوقع', href: '/order-management?view=preparing', tone: 'urgent' },
      { id: 'driver-issues', count: (alerts?.ACKNOWLEDGEMENT_OVERDUE ?? 0) + (alerts?.DRIVER_NOT_RESPONDING ?? 0) + (alerts?.ASSIGNMENT_ERROR ?? 0) + s.attention.assignedPastAcceptDeadline, en: 'Driver problems', ar: 'مشكلات السائقين', hintEn: 'Not acknowledged, not responding or assignment failed', hintAr: 'لم يؤكد أو لا يستجيب أو فشل الإسناد', href: '/control-tower', tone: 'urgent' },
      { id: 'failed', count: s.attention.failedDeliveriesUnresolved, en: 'Failed deliveries', ar: 'توصيلات فاشلة', hintEn: 'Waiting for your decision', hintAr: 'بانتظار قرارك', href: '/failed-deliveries', tone: 'urgent' },
      { id: 'pending', count: ops.pendingAcceptance, en: 'New orders', ar: 'طلبات جديدة', hintEn: 'Waiting for the store to accept', hintAr: 'بانتظار قبول المتجر', href: '/order-management?view=pending', tone: 'waiting' },
      { id: 'pickup', count: s.attention.readyForCustomerPickup, en: 'Ready for customer pickup', ar: 'جاهزة لاستلام العميل', hintEn: 'Pickup orders at the store', hintAr: 'طلبات استلام في المتجر', href: '/order-management?view=readyPickup', tone: 'waiting' },
    );
    if (can('VERIFY_MANUAL_PAYMENTS')) {
      tiles.push(
        { id: 'transfers', count: ops.transfersToVerify ?? 0, en: 'Transfers to verify', ar: 'تحويلات للتحقق', hintEn: 'Check the money arrived, then approve', hintAr: 'تأكد من وصول المبلغ ثم وافق', href: '/manual-transfer', tone: 'urgent' },
        { id: 'refunds', count: ops.refundsToSend, en: 'Refunds to send', ar: 'مستردات للإرسال', hintEn: 'Send the money, then mark it sent', hintAr: 'أرسل المبلغ ثم سجّل الإرسال', href: '/manual-transfer', tone: 'urgent' },
      );
    }
  }
  if (products.data) tiles.push({ id: 'product-requests', count: products.data.length, en: 'Product requests', ar: 'طلبات المنتجات', hintEn: 'Store changes waiting for approval', hintAr: 'تعديلات متاجر بانتظار الموافقة', href: '/product-requests', tone: 'waiting' });
  if (stores.data) tiles.push({ id: 'store-requests', count: stores.data.length, en: 'Store requests', ar: 'طلبات المتاجر', hintEn: 'Hours and details waiting for approval', hintAr: 'مواعيد وبيانات بانتظار الموافقة', href: '/branch-requests', tone: 'waiting' });

  if (tiles.length === 0) return null;
  const open = tiles.filter((x) => x.count > 0).sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'urgent' ? -1 : 1));
  const clear = tiles.filter((x) => x.count === 0);

  return (
    <section aria-labelledby="action-center-title" className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5" data-testid="action-center">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="action-center-title" className="text-base font-semibold text-gray-900">{t('Needs your action now', 'يحتاج إجراءك الآن')}</h2>
        {open.length > 0 && <span className="text-xs text-gray-500">{t('Click a box to open its list', 'اضغط على أي مربع لفتح قائمته')}</span>}
      </div>
      {open.length === 0 ? (
        <p className="flex items-center gap-2 rounded-xl bg-green-50 px-4 py-3 text-sm font-medium text-green-800" data-testid="action-center-clear">
          <span aria-hidden>✓</span>{t('Nothing is waiting for you. Everything is handled.', 'لا شيء بانتظارك. كل شيء تحت السيطرة.')}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {open.map((x) => (
            <li key={x.id}>
              <Link href={x.href} data-testid={`action-${x.id}`}
                className={`flex h-full items-start gap-3 rounded-xl border p-3 transition hover:shadow-md ${x.tone === 'urgent' ? 'border-red-200 bg-red-50/70 hover:border-red-300' : 'border-amber-200 bg-amber-50/70 hover:border-amber-300'}`}>
                <span className={`min-w-[2.5rem] shrink-0 whitespace-nowrap rounded-lg px-2 py-1 text-center text-lg font-bold tabular-nums ${x.tone === 'urgent' ? 'bg-red-600 text-white' : 'bg-amber-500 text-white'}`}>{num(x.count)}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-gray-900">{t(x.en, x.ar)}</span>
                  <span className="block text-xs text-gray-600">{t(x.hintEn, x.hintAr)}</span>
                </span>
                <span aria-hidden className="ms-auto self-center text-gray-400 rtl:rotate-180">›</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {open.length > 0 && clear.length > 0 && (
        <p className="mt-3 text-xs text-gray-500">
          <span className="font-medium text-green-700">✓ {t('All clear:', 'لا شيء معلّق:')}</span> {clear.map((x) => t(x.en, x.ar)).join(' · ')}
        </p>
      )}
    </section>
  );
}
