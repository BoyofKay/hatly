'use client';

import { useRef, useState } from 'react';
import { assignDriver, reassignDriver } from '../../lib/api/admin-dispatch';
import { DispatchDriver } from '../../lib/api/admin-control-tower';
import { apiErrorMessage } from '../../lib/api/errors';
import { useI18n } from '../../lib/i18n/i18n';

/**
 * Assign (order READY_FOR_PICKUP) or reassign (order ASSIGNED_TO_DRIVER) a named driver — the only two manual dispatch
 * operations Hatly has. Every rule (eligibility, OVERRIDE_DISPATCH, availability, order state) is the backend's: this never
 * pre-filters drivers by a client-side rule, it shows each driver's state and surfaces the backend's refusal verbatim.
 *
 * - One request at a time: a ref guard (not just state) blocks a fast double click.
 * - A reassignment is confirmed first (it releases the current driver).
 * - The reassignment carries the driver this screen showed (`expectedCurrentDriverId`): if someone else changed the
 *   assignment meanwhile, the backend refuses (ASSIGNMENT_CHANGED) and the caller reloads instead of overriding blindly.
 * - After success OR a refusal, `onChanged` lets the caller re-read the real state (never an optimistic guess).
 */
export function DispatchAction({
  orderId,
  orderNumber,
  status,
  currentDriver,
  drivers,
  onChanged,
}: {
  orderId: string;
  orderNumber: string;
  status: string;
  currentDriver: { id: string; fullName: string } | null;
  drivers: DispatchDriver[];
  onChanged: (outcome: { ok: boolean; message: string }) => void;
}) {
  const { t } = useI18n();
  const [driverId, setDriverId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  const isReassign = status === 'ASSIGNED_TO_DRIVER';
  if (status !== 'READY_FOR_PICKUP' && !isReassign) return null;

  const choices = drivers.filter((d) => d.id !== currentDriver?.id);

  async function submit() {
    if (inFlight.current) return;
    const chosen = choices.find((d) => d.id === driverId);
    if (!chosen) {
      setError(t('dxChooseFirst'));
      return;
    }
    if (isReassign && !window.confirm(t('dxConfirmReassign', { order: orderNumber, from: currentDriver?.fullName ?? '—', to: chosen.fullName }))) {
      return;
    }
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      if (isReassign) {
        await reassignDriver(orderId, chosen.id, currentDriver?.id);
        onChanged({ ok: true, message: t('dxReassigned', { order: orderNumber, driver: chosen.fullName }) });
      } else {
        await assignDriver(orderId, chosen.id);
        onChanged({ ok: true, message: t('dxAssigned', { order: orderNumber, driver: chosen.fullName }) });
      }
      setDriverId('');
    } catch (err) {
      const message = apiErrorMessage(err, t('ctLoadFailed'));
      setError(message);
      // A refusal often means the order or driver changed under us — re-read the real state.
      onChanged({ ok: false, message });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  // R18: a driver may carry several orders up to their configured capacity — show the load, and "full" at the limit (the backend refuses).
  const loadText = (d: DispatchDriver) => {
    if (d.capacity == null || d.activeCount == null) return d.activeDelivery ? t('dxOptionBusy', { order: d.activeDelivery.orderNumber }) : t('dxOptionFree');
    if (d.activeCount >= d.capacity) return t('dxOptionFull', { active: d.activeCount, capacity: d.capacity });
    return t('dxOptionLoad', { active: d.activeCount, capacity: d.capacity });
  };
  const label = (d: DispatchDriver) => `${d.fullName} — ${!d.isOnline ? t('dxOptionOffline') : loadText(d)}${d.vehicleTypeName ? ` · ${d.vehicleTypeName}` : ''}`;

  return (
    <div data-testid={`dispatch-action-${orderId}`} className="space-y-1">
      <div className="flex gap-2">
        <select
          data-testid="dispatch-driver-select"
          aria-label={t('dxSelectDriver')}
          value={driverId}
          disabled={pending}
          onChange={(e) => {
            setDriverId(e.target.value);
            setError(null);
          }}
          className="min-w-0 flex-1 rounded-lg border px-2 py-1 text-sm border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100"
        >
          <option value="">{choices.length === 0 ? t('dxNoDrivers') : t('dxSelectDriver')}</option>
          {choices.map((d) => (
            <option key={d.id} value={d.id}>
              {label(d)}
            </option>
          ))}
        </select>
        <button
          data-testid="dispatch-submit"
          onClick={submit}
          disabled={pending}
          className="whitespace-nowrap rounded-lg bg-hatly-orange px-3 py-1 text-sm font-medium text-white disabled:opacity-50 shadow-sm hover:bg-hatly-orangeDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40"
        >
          {pending ? t('dxWorking') : isReassign ? t('dxReassign') : t('dxAssign')}
        </button>
      </div>
      {error && (
        <p role="alert" data-testid="dispatch-error" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
