'use client';

import { useEffect, useState } from 'react';
import {
  AdminDriver,
  DispatchOrder,
  assignDriver,
  listDispatchableOrders,
  listDrivers,
  reassignDriver,
} from '../../../lib/api/admin-dispatch';

/**
 * Real Admin Dispatch — consumes the Chunk 6 backend additions
 * (`GET admin/orders/dispatchable`, `GET admin/drivers`) plus the
 * already-existing assign/reassign endpoints. The backend's own
 * DriverRankingService eligibility check remains the sole authority
 * for whether a chosen driver is actually assignable — this page
 * shows every driver, and surfaces a rejection plainly if one isn't
 * eligible (never a client-side eligibility rule).
 */
export default function DispatchPage() {
  const [orders, setOrders] = useState<DispatchOrder[] | null>(null);
  const [drivers, setDrivers] = useState<AdminDriver[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedDriverByOrder, setSelectedDriverByOrder] = useState<Record<string, string>>({});
  const [actionErrorByOrder, setActionErrorByOrder] = useState<Record<string, string>>({});
  const [submittingOrderId, setSubmittingOrderId] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      const [orderList, driverList] = await Promise.all([listDispatchableOrders(), listDrivers()]);
      setOrders(orderList);
      setDrivers(driverList);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Failed to load dispatch data.');
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleAssign(order: DispatchOrder) {
    const driverId = selectedDriverByOrder[order.orderId];
    if (!driverId) {
      setActionErrorByOrder((prev) => ({ ...prev, [order.orderId]: 'Select a driver first.' }));
      return;
    }
    setSubmittingOrderId(order.orderId);
    setActionErrorByOrder((prev) => ({ ...prev, [order.orderId]: '' }));
    try {
      // Re-check current state before mutating — the assignment could
      // have changed since this list was last loaded.
      await refresh();
      if (order.currentDriverId) {
        await reassignDriver(order.orderId, driverId);
      } else {
        await assignDriver(order.orderId, driverId);
      }
      await refresh();
    } catch (err: any) {
      setActionErrorByOrder((prev) => ({
        ...prev,
        [order.orderId]: err?.response?.data?.message ?? 'Failed to assign driver.',
      }));
      await refresh();
    } finally {
      setSubmittingOrderId(null);
    }
  }

  const unassigned = orders?.filter((o) => !o.currentDriverId) ?? [];
  const assigned = orders?.filter((o) => o.currentDriverId) ?? [];

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Dispatch</h1>
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

      {!error && orders === null && <p className="mt-4 text-gray-500">Loading...</p>}

      {!error && orders !== null && (
        <>
          <section className="mt-6">
            <h2 className="font-semibold">Awaiting Assignment ({unassigned.length})</h2>
            {unassigned.length === 0 && <p className="mt-2 text-sm text-gray-500">Nothing waiting for a driver.</p>}
            <div className="mt-2 space-y-3">
              {unassigned.map((order) => (
                <_OrderRow
                  key={order.orderId}
                  order={order}
                  drivers={drivers}
                  selectedDriverId={selectedDriverByOrder[order.orderId] ?? ''}
                  onSelectDriver={(driverId) =>
                    setSelectedDriverByOrder((prev) => ({ ...prev, [order.orderId]: driverId }))
                  }
                  onSubmit={() => handleAssign(order)}
                  isSubmitting={submittingOrderId === order.orderId}
                  actionError={actionErrorByOrder[order.orderId]}
                  actionLabel="Assign"
                />
              ))}
            </div>
          </section>

          <section className="mt-8">
            <h2 className="font-semibold">Assigned ({assigned.length})</h2>
            {assigned.length === 0 && <p className="mt-2 text-sm text-gray-500">No orders currently assigned.</p>}
            <div className="mt-2 space-y-3">
              {assigned.map((order) => (
                <_OrderRow
                  key={order.orderId}
                  order={order}
                  drivers={drivers}
                  selectedDriverId={selectedDriverByOrder[order.orderId] ?? ''}
                  onSelectDriver={(driverId) =>
                    setSelectedDriverByOrder((prev) => ({ ...prev, [order.orderId]: driverId }))
                  }
                  onSubmit={() => handleAssign(order)}
                  isSubmitting={submittingOrderId === order.orderId}
                  actionError={actionErrorByOrder[order.orderId]}
                  actionLabel="Reassign"
                />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function _OrderRow({
  order,
  drivers,
  selectedDriverId,
  onSelectDriver,
  onSubmit,
  isSubmitting,
  actionError,
  actionLabel,
}: {
  order: DispatchOrder;
  drivers: AdminDriver[];
  selectedDriverId: string;
  onSelectDriver: (driverId: string) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  actionError?: string;
  actionLabel: string;
}) {
  const currentDriver = drivers.find((d) => d.id === order.currentDriverId);

  return (
    <div className="rounded border bg-white p-4">
      <div className="flex items-center justify-between">
        <span className="font-medium">Order #{order.orderId.slice(0, 8)}</span>
        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{order.status}</span>
      </div>
      {order.deliveryAddressSnapshot?.line1 && (
        <p className="mt-1 text-sm text-gray-600">{order.deliveryAddressSnapshot.line1}</p>
      )}
      {currentDriver && <p className="mt-1 text-sm text-gray-600">Currently: {currentDriver.fullName}</p>}
      <div className="mt-2 flex gap-2">
        <select
          value={selectedDriverId}
          onChange={(e) => onSelectDriver(e.target.value)}
          className="flex-1 rounded border px-2 py-1.5 text-sm"
        >
          <option value="">Select a driver...</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.fullName} {d.isOnline ? '(online)' : '(offline)'}
            </option>
          ))}
        </select>
        <button
          onClick={onSubmit}
          disabled={isSubmitting}
          className="rounded bg-hatly-orange px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {isSubmitting ? '...' : actionLabel}
        </button>
      </div>
      {actionError && <p className="mt-1 text-sm text-red-600">{actionError}</p>}
    </div>
  );
}
