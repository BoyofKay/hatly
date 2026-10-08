'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FailedDeliveryQueueItem, listFailedDeliveryQueue } from '../../../lib/api/admin-failed-deliveries';
import { apiErrorMessage } from '../../../lib/api/errors';

/**
 * Failed Delivery Operations UI (Chunk 2d). Consumes the existing,
 * unchanged `GET admin/orders/failed-deliveries` (Chunk 2b) — a case
 * leaves this list the moment a resolution exists, regardless of
 * outcome (the backend's own definition of "unresolved," reused
 * as-is, never duplicated here). Mirrors the Manual Transfer page's
 * exact conventions: plain useState/useEffect, no query library, the
 * backend is authoritative for everything beyond display.
 */
export default function FailedDeliveriesPage() {
  const [items, setItems] = useState<FailedDeliveryQueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      setItems(await listFailedDeliveryQueue());
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to load failed deliveries.'));
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Failed Deliveries</h1>
        <button onClick={refresh} className="text-sm text-gray-500 underline">
          Refresh
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}{' '}
          <button onClick={refresh} className="underline">
            Retry
          </button>
        </div>
      )}

      {!error && items === null && <p className="mt-4 text-gray-500">Loading...</p>}
      {!error && items !== null && items.length === 0 && (
        <p className="mt-4 text-gray-500">No unresolved failed deliveries.</p>
      )}

      <div className="mt-4 overflow-x-auto rounded border bg-white">
        {items && items.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2">Order</th>
                <th className="px-4 py-2">Failed At</th>
                <th className="px-4 py-2">Reason</th>
                <th className="px-4 py-2">Customer</th>
                <th className="px-4 py-2">Driver</th>
                <th className="px-4 py-2">Total</th>
                <th className="px-4 py-2">Payment</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.orderId} className="border-b last:border-0">
                  <td className="px-4 py-2">
                    <Link href={`/order-search/${item.orderId}`} className="font-medium text-hatly-orange hover:underline" dir="ltr">
                      {item.orderNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{item.failedAt ? new Date(item.failedAt).toLocaleString() : '—'}</td>
                  <td className="px-4 py-2">{item.failureReason ?? '—'}</td>
                  <td className="px-4 py-2">{item.customerName ?? item.customerId.slice(0, 8)}</td>
                  <td className="px-4 py-2">{item.driverName ?? (item.driverId ? item.driverId.slice(0, 8) : '—')}</td>
                  <td className="px-4 py-2">
                    {item.totalMinor != null ? (item.totalMinor / 100).toFixed(2) : '—'}
                  </td>
                  <td className="px-4 py-2">
                    {item.paymentMethod}
                    {item.paymentStatus ? ` (${item.paymentStatus})` : ''}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link href={`/failed-deliveries/${item.orderId}`} className="text-hatly-orange underline">
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
