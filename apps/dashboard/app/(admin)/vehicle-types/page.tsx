'use client';

import { useEffect, useState } from 'react';
import {
  VehicleType,
  createVehicleType,
  listVehicleTypes,
  updateVehicleType,
} from '../../../lib/api/admin-vehicle-types';
import { apiErrorMessage } from '../../../lib/api/errors';

/**
 * M3a (Launch-Readiness Gap Audit, G-29). Reuses the existing, unchanged
 * `admin/vehicle-types` endpoints exactly. Kept deliberately simple — a
 * list with inline edit controls plus a create form, matching the
 * Drivers page's own "create form + list" shape. `maxActiveDeliveries`
 * is scaffolding only today (nothing reads/enforces it yet — see the
 * entity's own comment); this page just lets Admin manage the data the
 * backend already stores, not a new business rule.
 */
export default function VehicleTypesPage() {
  const [types, setTypes] = useState<VehicleType[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [maxActiveDeliveries, setMaxActiveDeliveries] = useState('');
  const [isBicycle, setIsBicycle] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [savingId, setSavingId] = useState<string | null>(null);
  const [rowErrorById, setRowErrorById] = useState<Record<string, string>>({});

  async function refresh() {
    setError(null);
    try {
      setTypes(await listVehicleTypes(true));
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to load vehicle types.'));
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (isCreating) return;
    setCreateError(null);
    const max = Number(maxActiveDeliveries);
    if (!name.trim() || !maxActiveDeliveries || !Number.isInteger(max) || max <= 0) {
      setCreateError('Name and a positive integer max active deliveries are required.');
      return;
    }
    setIsCreating(true);
    try {
      await createVehicleType({ name: name.trim(), nameAr: nameAr.trim() || undefined, maxActiveDeliveries: max, isBicycle });
      setName('');
      setNameAr('');
      setMaxActiveDeliveries('');
      setIsBicycle(false);
      await refresh();
    } catch (err: any) {
      setCreateError(apiErrorMessage(err, 'Failed to create vehicle type.'));
    } finally {
      setIsCreating(false);
    }
  }

  /** Deactivating hides this vehicle type from future assignment eligibility — confirmed before sending, same as every other irreversible-feeling toggle in this dashboard. */
  async function handleToggleActive(type: VehicleType) {
    if (savingId) return;
    const next = !type.isActive;
    if (!next && !window.confirm(`Deactivate "${type.name}"? Drivers using this vehicle type may become ineligible for new assignments.`)) {
      return;
    }
    setSavingId(type.id);
    setRowErrorById((prev) => ({ ...prev, [type.id]: '' }));
    try {
      await updateVehicleType(type.id, { isActive: next });
      await refresh();
    } catch (err: any) {
      setRowErrorById((prev) => ({ ...prev, [type.id]: apiErrorMessage(err, 'Failed to update.' )}));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold">Vehicle Types</h1>

      <section className="rounded border bg-white p-4">
        <h2 className="font-semibold">Create Vehicle Type</h2>
        <form onSubmit={handleCreate} className="mt-3 space-y-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="w-full rounded border px-2 py-1.5 text-sm" />
          <input value={nameAr} onChange={(e) => setNameAr(e.target.value)} placeholder="Name (Arabic, optional)" className="w-full rounded border px-2 py-1.5 text-sm" />
          <input type="number" min={1} step={1} value={maxActiveDeliveries} onChange={(e) => setMaxActiveDeliveries(e.target.value)} placeholder="Max active deliveries" className="w-full rounded border px-2 py-1.5 text-sm" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isBicycle} onChange={(e) => setIsBicycle(e.target.checked)} />
            Bicycle (subject to the max pickup distance policy)
          </label>
          {createError && <p className="text-sm text-red-600">{createError}</p>}
          <button type="submit" disabled={isCreating} className="rounded bg-hatly-orange px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {isCreating ? 'Creating...' : 'Create'}
          </button>
        </form>
      </section>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">All Vehicle Types</h2>
          <button onClick={refresh} className="text-sm text-gray-500 underline">
            Refresh
          </button>
        </div>
        {error && (
          <div className="mt-2 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}{' '}
            <button onClick={refresh} className="underline">
              Retry
            </button>
          </div>
        )}
        {!error && types === null && <p className="mt-2 text-gray-500">Loading...</p>}
        {!error && types !== null && types.length === 0 && <p className="mt-2 text-gray-500">No vehicle types yet.</p>}
        {!error && types !== null && types.length > 0 && (
          <ul className="mt-2 divide-y rounded border bg-white">
            {types.map((t) => (
              <li key={t.id} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">
                      {t.name} {t.isBicycle && <span className="ml-1 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">Bicycle</span>}
                    </p>
                    <p className="text-xs text-gray-500">Max active deliveries: {t.maxActiveDeliveries}</p>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`rounded px-2 py-0.5 ${t.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
                      {t.isActive ? 'Active' : 'Inactive'}
                    </span>
                    <button
                      onClick={() => handleToggleActive(t)}
                      disabled={savingId === t.id}
                      className="rounded bg-gray-200 px-2 py-1 font-medium text-gray-700 disabled:opacity-50"
                    >
                      {t.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                </div>
                {rowErrorById[t.id] && <p className="mt-1 text-xs text-red-600">{rowErrorById[t.id]}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
