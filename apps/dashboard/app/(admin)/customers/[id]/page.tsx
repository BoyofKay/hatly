'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AdminCustomerDetail, getAdminCustomerDetail } from '../../../../lib/api/admin-customers';
import { apiErrorMessage } from '../../../../lib/api/errors';

/**
 * M3c (Launch-Readiness Gap Audit, G-10) — read-only Admin Customer
 * detail. Reuses the EXISTING `/order-search/[id]` route for opening a
 * recent order (never a duplicate order-detail implementation) — a
 * recent order's "Open" link below navigates there directly.
 */
export default function CustomerDetailPage() {
  const params = useParams();
  const customerId = params.id as string;

  const [detail, setDetail] = useState<AdminCustomerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      setDetail(await getAdminCustomerDetail(customerId));
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to load customer.'));
    }
  }

  useEffect(() => {
    if (customerId) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  if (error) {
    return (
      <div className="mx-auto max-w-2xl rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error}{' '}
        <button onClick={refresh} className="underline">
          Retry
        </button>
      </div>
    );
  }
  if (!detail) return <p className="mx-auto max-w-2xl text-gray-500">Loading...</p>;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">{detail.fullName}</h1>

      <div className="rounded border bg-white p-4 text-sm">
        <p><span className="text-gray-500">Phone:</span> {detail.phone}</p>
        <p><span className="text-gray-500">Status:</span> {detail.isActive ? 'Active' : 'Inactive'}</p>
        <p><span className="text-gray-500">Phone verified:</span> {detail.isPhoneVerified ? 'Yes' : 'No'}</p>
        <p><span className="text-gray-500">Customer since:</span> {new Date(detail.createdAt).toLocaleDateString()}</p>
      </div>

      <div className="rounded border bg-white p-4 text-sm">
        <h2 className="font-medium">Wallet</h2>
        <p className="mt-1">{(detail.walletBalanceMinor / 100).toFixed(2)}</p>
      </div>

      <div className="rounded border bg-white p-4 text-sm">
        <h2 className="font-medium">Address</h2>
        {detail.address ? (
          <div className="mt-1">
            {detail.address.label && <p className="text-xs text-gray-500">{detail.address.label}</p>}
            <p>{detail.address.line1}</p>
            <p className="text-gray-500">
              {[detail.address.city, detail.address.governorate].filter(Boolean).join(', ') || '—'}
            </p>
          </div>
        ) : (
          <p className="mt-1 text-gray-500">No address on file.</p>
        )}
      </div>

      <div className="rounded border bg-white p-4 text-sm">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Orders</h2>
          <span className="text-gray-500">{detail.orderCount} total</span>
        </div>
        {detail.recentOrders.length === 0 ? (
          <p className="mt-2 text-gray-500">No orders yet.</p>
        ) : (
          <ul className="mt-2 divide-y">
            {detail.recentOrders.map((order) => (
              <li key={order.id} className="flex items-center justify-between py-2">
                <div>
                  <p className="font-mono text-xs">{order.orderNumber}</p>
                  <p className="text-xs text-gray-500">
                    {order.status} &middot; {order.totalMinor != null ? (order.totalMinor / 100).toFixed(2) : '—'}
                  </p>
                </div>
                <Link href={`/order-search/${order.id}`} className="text-hatly-orange underline">
                  Open
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
