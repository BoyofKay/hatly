'use client';

import { useEffect, useState } from 'react';
import {
  ServiceArea,
  activateServiceArea,
  createServiceArea,
  deactivateServiceArea,
  listServiceAreas,
  updateServiceArea,
} from '../../../lib/api/admin-service-areas';
import { apiErrorMessage } from '../../../lib/api/errors';

/**
 * Real Admin ServiceArea management — consumes the Phase I-B backend
 * exactly. A ServiceArea is a center-point + radius delivery zone
 * (not a polygon) — the form collects exactly those fields, nothing
 * fabricated.
 */
export default function ServiceAreasPage() {
  const [areas, setAreas] = useState<ServiceArea[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [name, setName] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [radius, setRadius] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      setAreas(await listServiceAreas());
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to load service areas.'));
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (isSubmitting) return;
    const centerLatitude = Number(lat);
    const centerLongitude = Number(lng);
    const radiusMeters = Number(radius);
    if ([centerLatitude, centerLongitude, radiusMeters].some((n) => Number.isNaN(n))) {
      setCreateError('Latitude, longitude, and radius must all be valid numbers.');
      return;
    }
    setIsSubmitting(true);
    setCreateError(null);
    try {
      await createServiceArea({ name, centerLatitude, centerLongitude, radiusMeters });
      setName('');
      setLat('');
      setLng('');
      setRadius('');
      setShowCreateForm(false);
      await refresh();
    } catch (err: any) {
      setCreateError(apiErrorMessage(err, 'Failed to create service area.'));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleToggle(area: ServiceArea) {
    setError(null);
    try {
      area.isActive ? await deactivateServiceArea(area.id) : await activateServiceArea(area.id);
      await refresh();
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to update service area.'));
    }
  }

  async function handleRename(area: ServiceArea) {
    const newName = window.prompt('Service area name', area.name);
    if (!newName || newName === area.name) return;
    try {
      await updateServiceArea(area.id, { name: newName });
      await refresh();
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to rename service area.'));
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Service Areas</h1>
        <button
          onClick={() => setShowCreateForm((v) => !v)}
          className="rounded bg-hatly-orange px-4 py-2 text-sm font-medium text-white"
        >
          {showCreateForm ? 'Cancel' : 'New Service Area'}
        </button>
      </div>

      {showCreateForm && (
        <form onSubmit={handleCreate} className="mt-4 space-y-3 rounded border bg-white p-4">
          <div>
            <label className="block text-sm font-medium">Name</label>
            <input required value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium">Center latitude</label>
              <input required value={lat} onChange={(e) => setLat(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" />
            </div>
            <div>
              <label className="block text-sm font-medium">Center longitude</label>
              <input required value={lng} onChange={(e) => setLng(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" />
            </div>
            <div>
              <label className="block text-sm font-medium">Radius (meters)</label>
              <input required value={radius} onChange={(e) => setRadius(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" />
            </div>
          </div>
          {createError && <p className="text-sm text-red-600">{createError}</p>}
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded bg-hatly-orange px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isSubmitting ? 'Creating...' : 'Create Service Area'}
          </button>
        </form>
      )}

      <div className="mt-6">
        {error && (
          <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}{' '}
            <button onClick={refresh} className="underline">
              Retry
            </button>
          </div>
        )}
        {!error && areas === null && <p className="text-gray-500">Loading...</p>}
        {!error && areas !== null && areas.length === 0 && <p className="text-gray-500">No service areas yet.</p>}
        {!error && areas !== null && areas.length > 0 && (
          <ul className="mt-2 divide-y rounded border bg-white">
            {areas.map((a) => (
              <li key={a.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <button onClick={() => handleRename(a)} className="text-left font-medium hover:underline">
                    {a.name}
                  </button>
                  <p className="text-xs text-gray-500">
                    {a.centerLatitude}, {a.centerLongitude} &middot; {(a.radiusMeters / 1000).toFixed(1)} km radius
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-xs ${a.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
                    {a.isActive ? 'Active' : 'Inactive'}
                  </span>
                  <button onClick={() => handleToggle(a)} className="text-xs text-gray-500 underline">
                    {a.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
