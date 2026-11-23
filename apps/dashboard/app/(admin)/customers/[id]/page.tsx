'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CustomerExtras } from '../../../../components/customers/CustomerExtras';
import { ResetPasswordButton } from '../../../../components/admin/ResetPasswordButton';
import { getMyAdminPermissions } from '../../../../lib/api/admin-me';
import { AdminCustomerDetail, getAdminCustomerDetail } from '../../../../lib/api/admin-customers';
import { apiErrorMessage } from '../../../../lib/api/errors';
import { ORDER_STATUS, label } from '../../../../lib/admin/labels';
import { useLang } from '../../../../lib/ui/lang';
import { Badge, Card, ErrorState, KpiCard, Skeleton, StatusPill } from '../../../../components/ui';

/**
 * Admin Customer detail. Orders open in the existing `/order-search/[id]` page (never a second order-detail implementation). Money comes from the
 * backend's integer minor units and is formatted by string arithmetic only.
 */
export default function CustomerDetailPage() {
  const { t, money, date } = useLang();
  const params = useParams();
  const customerId = params.id as string;
  const [detail, setDetail] = useState<AdminCustomerDetail | null>(null);
  // Reset password (owner request 2026-11-23) — shown to whoever may manage customers; the server checks it again.
  const [canManage, setCanManage] = useState(false);
  useEffect(() => {
    getMyAdminPermissions()
      .then((me) => setCanManage(me.role === 'SUPER_ADMIN' || me.permissions.includes('MANAGE_CUSTOMERS')))
      .catch(() => setCanManage(false));
  }, []);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setDetail(await getAdminCustomerDetail(customerId));
    } catch (err: any) {
      setError(apiErrorMessage(err, t('Failed to load customer.', 'تعذّر تحميل العميل.')));
    }
  }, [customerId, t]);

  useEffect(() => {
    if (customerId) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  const back = <Link href="/customers" className="mb-3 inline-flex min-h-[36px] items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900"><span aria-hidden className="rtl:rotate-180">←</span> {t('Customers', 'العملاء')}</Link>;
  if (error) return <div className="max-w-6xl">{back}<ErrorState message={error} onRetry={refresh} /></div>;
  if (!detail) return <div className="max-w-6xl space-y-4" aria-busy="true">{back}<Skeleton className="h-9 w-64" /><Skeleton className="h-40" /></div>;

  return (
    <div className="max-w-6xl">
      {back}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">{detail.fullName}</h1>
        <Badge tone={detail.isActive ? 'green' : 'gray'}>{detail.isActive ? t('Active', 'نشط') : t('Inactive', 'غير نشط')}</Badge>
        {canManage && <span className="ms-auto"><ResetPasswordButton path={`/admin/customers/${detail.id}/reset-password`} name={detail.fullName} /></span>}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label={t('Orders', 'الطلبات')} value={detail.orderCount} />
        <KpiCard label={t('Wallet balance', 'رصيد المحفظة')} value={money(detail.walletBalanceMinor)} />
        <KpiCard label={t('Phone', 'الهاتف')} value={<span dir="ltr" className="text-lg">{detail.phone}</span>} hint={detail.isPhoneVerified ? t('Verified', 'مُوثَّق') : t('Not verified', 'غير مُوثَّق')} />
        <KpiCard label={t('Customer since', 'عميل منذ')} value={<span className="text-lg">{date(detail.createdAt)}</span>} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title={t('Recent orders', 'آخر الطلبات')} actions={<span className="text-xs text-gray-500">{t(`${detail.orderCount} total`, `الإجمالي ${detail.orderCount}`)}</span>}>
            {detail.recentOrders.length === 0 ? (
              <p className="text-sm text-gray-500">{t('No orders yet.', 'لا توجد طلبات بعد.')}</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {detail.recentOrders.map((order) => (
                  <li key={order.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="font-mono text-xs font-semibold">{order.orderNumber}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                        <StatusPill status={order.status} label={label(ORDER_STATUS, order.status, t)} />
                        <span className="tabular-nums">{order.totalMinor != null ? money(order.totalMinor) : '—'}</span>
                      </p>
                    </div>
                    <Link href={`/order-search/${order.id}`} className="inline-flex min-h-[40px] shrink-0 items-center font-medium text-hatly-orangeDark hover:underline">{t('Open', 'فتح')}</Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <CustomerExtras customerId={customerId} />
        </div>
        <aside>
          <Card title={t('Address', 'العنوان')}>
            {detail.address ? (
              <div className="text-sm">
                {detail.address.label && <p className="text-xs text-gray-500">{detail.address.label}</p>}
                <p>{detail.address.line1}</p>
                <p className="text-gray-500">{[detail.address.city, detail.address.governorate].filter(Boolean).join(', ') || '—'}</p>
              </div>
            ) : (
              <p className="text-sm text-gray-500">{t('No address on file.', 'لا يوجد عنوان محفوظ.')}</p>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
