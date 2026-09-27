'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { VendorOrder, listVendorOrders } from '../../../lib/api/vendor-orders';

/**
 * Real Vendor order list — consumes `GET vendor/orders`. Shows only
 * the caller's own segment(s) per order (server-scoped — see
 * VendorOrdersService's own comment); the Order-level `status` is
 * shown as read-only context only, never something this UI writes.
 */
export default function VendorOrdersPage() {
  const [orders, setOrders] = useState<VendorOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      setOrders(await listVendorOrders());
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Failed to load orders.');
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Incoming Orders</h1>
        <button onClick={refresh} className="text-sm text-gray-500 underline">
          Refresh
        </button>
      </div>

      <div className="mt-4">
        {error && (
          <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}{' '}
            <button onClick={refresh} className="underline">
              Retry
            </button>
          </div>
        )}
        {!error && orders === null && <p className="text-gray-500">Loading...</p>}
        {!error && orders !== null && orders.length === 0 && (
          <p className="text-gray-500">No orders yet.</p>
        )}
        {!error && orders !== null && orders.length > 0 && (
          <ul className="divide-y rounded border bg-white">
            {orders.map((order) => (
              <li key={order.id}>
                <Link href={`/orders/${order.id}`} className="block px-4 py-3 hover:bg-gray-50">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Order #{order.id.slice(0, 8)}</span>
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{order.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    {order.segments.length} segment(s) &middot; {order.paymentMethod}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {order.segments.map((s) => (
                      <span key={s.id} className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                        {s.status}
                      </span>
                    ))}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
