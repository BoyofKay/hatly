'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  DeliveryZone,
  DeliveryZoneDetailsInput,
  MANAGE_DELIVERY_FEE_MULTIPLIER,
  MANAGE_SERVICE_AREAS,
  createDeliveryZone,
  listDeliveryZones,
  setDeliveryZoneActive,
  updateDeliveryZone,
  updateDeliveryZoneFee,
  zoneErrorMessage,
} from '../../../lib/api/admin-delivery-zones';
import { ServiceArea, listServiceAreas } from '../../../lib/api/admin-service-areas';
import { useAdminPermission } from '../../../lib/auth/use-admin-permission';
import { formatMinor, parseEgpToMinorAllowZero } from '../../../lib/money';

/**
 * PD-009 — Delivery Zones. A zone is a named local delivery area inside a Service Area ("بلبيس — أبو نصيب"). For an address
 * WITHOUT a map pin, the zone the customer selected decides serviceability and its fee is the base delivery fee (the
 * additional-vendor fee still applies on top). Changing a fee or deactivating a zone only affects NEW quotes and orders —
 * every placed order keeps its frozen fee and zone. Representative coordinates are optional metadata only.
 *
 * Permissions are enforced by the backend; the UI only disables what the signed-in admin cannot do.
 */

interface FormState {
  serviceAreaId: string;
  governorate: string;
  governorateAr: string;
  city: string;
  cityAr: string;
  name: string;
  nameAr: string;
  displayOrder: string;
  fee: string;
  lat: string;
  lng: string;
}

const EMPTY_FORM: FormState = {
  serviceAreaId: '',
  governorate: 'Sharqia',
  governorateAr: 'الشرقية',
  city: '',
  cityAr: '',
  name: '',
  nameAr: '',
  displayOrder: '0',
  fee: '',
  lat: '',
  lng: '',
};

type Validated = { ok: true; details: DeliveryZoneDetailsInput; feeMinor: number | null } | { ok: false; error: string };

/** Client-side validation mirrors the backend's DTO rules so the admin sees the problem before submitting. */
function validateZoneForm(form: FormState, opts: { requireFee: boolean }): Validated {
  const required: Array<[keyof FormState, string]> = [
    ['serviceAreaId', 'Service area'],
    ['governorate', 'Governorate (EN)'],
    ['governorateAr', 'Governorate (AR)'],
    ['city', 'City (EN)'],
    ['cityAr', 'City (AR)'],
    ['name', 'Zone name (EN)'],
    ['nameAr', 'Zone name (AR)'],
  ];
  for (const [key, label] of required) {
    if (!form[key].trim()) return { ok: false, error: `${label} is required.` };
  }
  const displayOrder = Number(form.displayOrder.trim() || '0');
  if (!Number.isInteger(displayOrder) || displayOrder < 0) return { ok: false, error: 'Display order must be a whole number ≥ 0.' };

  const hasLat = form.lat.trim() !== '';
  const hasLng = form.lng.trim() !== '';
  if (hasLat !== hasLng) return { ok: false, error: 'Enter both representative latitude and longitude, or neither.' };
  let representativeLatitude: number | null = null;
  let representativeLongitude: number | null = null;
  if (hasLat) {
    representativeLatitude = Number(form.lat);
    representativeLongitude = Number(form.lng);
    if (!Number.isFinite(representativeLatitude) || Math.abs(representativeLatitude) > 90) return { ok: false, error: 'Latitude must be between -90 and 90.' };
    if (!Number.isFinite(representativeLongitude) || Math.abs(representativeLongitude) > 180) return { ok: false, error: 'Longitude must be between -180 and 180.' };
  }

  let feeMinor: number | null = null;
  if (opts.requireFee) {
    const fee = parseEgpToMinorAllowZero(form.fee);
    if (!fee.ok) return { ok: false, error: fee.reason === 'EMPTY' ? 'Delivery fee is required.' : 'Delivery fee must be an amount in EGP, e.g. 15 or 15.50.' };
    feeMinor = fee.minor;
  }

  return {
    ok: true,
    feeMinor,
    details: {
      serviceAreaId: form.serviceAreaId,
      governorate: form.governorate.trim(),
      governorateAr: form.governorateAr.trim(),
      city: form.city.trim(),
      cityAr: form.cityAr.trim(),
      name: form.name.trim(),
      nameAr: form.nameAr.trim(),
      displayOrder,
      representativeLatitude,
      representativeLongitude,
    },
  };
}

function toForm(zone: DeliveryZone): FormState {
  return {
    serviceAreaId: zone.serviceAreaId,
    governorate: zone.governorate,
    governorateAr: zone.governorateAr,
    city: zone.city,
    cityAr: zone.cityAr,
    name: zone.name,
    nameAr: zone.nameAr,
    displayOrder: String(zone.displayOrder),
    fee: formatMinor(zone.deliveryFeeMinor),
    lat: zone.representativeLatitude == null ? '' : String(zone.representativeLatitude),
    lng: zone.representativeLongitude == null ? '' : String(zone.representativeLongitude),
  };
}

function Field({ label, value, onChange, testId, dir, placeholder }: { label: string; value: string; onChange: (v: string) => void; testId: string; dir?: 'rtl' | 'ltr'; placeholder?: string }) {
  return (
    <label className="block text-sm">
      <span className="font-medium">{label}</span>
      <input data-testid={testId} dir={dir} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" />
    </label>
  );
}

function ZoneForm({
  initial,
  areas,
  showFee,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: FormState;
  areas: ServiceArea[];
  showFee: boolean;
  submitLabel: string;
  onSubmit: (v: Extract<Validated, { ok: true }>) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [key]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const v = validateZoneForm(form, { requireFee: showFee });
    if (!v.ok) {
      setError(v.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(v);
    } catch (err) {
      setError(zoneErrorMessage(err, 'Failed to save the zone.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} data-testid="zone-form" className="mt-4 space-y-3 rounded border bg-white p-4">
      <label className="block text-sm">
        <span className="font-medium">Service area</span>
        <select data-testid="zone-service-area" value={form.serviceAreaId} onChange={(e) => set('serviceAreaId')(e.target.value)} className="mt-1 w-full rounded border px-3 py-2">
          <option value="">Choose…</option>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.nameAr ? ` / ${a.nameAr}` : ''}
              {a.isActive ? '' : ' (inactive)'}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Governorate (EN)" value={form.governorate} onChange={set('governorate')} testId="zone-governorate" />
        <Field label="Governorate (AR)" value={form.governorateAr} onChange={set('governorateAr')} testId="zone-governorate-ar" dir="rtl" />
        <Field label="City (EN)" value={form.city} onChange={set('city')} testId="zone-city" placeholder="Belbeis" />
        <Field label="City (AR)" value={form.cityAr} onChange={set('cityAr')} testId="zone-city-ar" dir="rtl" placeholder="بلبيس" />
        <Field label="Zone name (EN)" value={form.name} onChange={set('name')} testId="zone-name" placeholder="Abu Naseeb" />
        <Field label="Zone name (AR)" value={form.nameAr} onChange={set('nameAr')} testId="zone-name-ar" dir="rtl" placeholder="أبو نصيب" />
        <Field label="Display order" value={form.displayOrder} onChange={set('displayOrder')} testId="zone-display-order" />
        {showFee && <Field label="Delivery fee (EGP)" value={form.fee} onChange={set('fee')} testId="zone-fee" placeholder="15.00" />}
      </div>
      <fieldset className="rounded border border-dashed p-3">
        <legend className="px-1 text-xs text-gray-500">Representative point (optional metadata — never used for pricing or serviceability)</legend>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Latitude" value={form.lat} onChange={set('lat')} testId="zone-lat" />
          <Field label="Longitude" value={form.lng} onChange={set('lng')} testId="zone-lng" />
        </div>
      </fieldset>
      {error && (
        <p data-testid="zone-form-error" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="rounded bg-hatly-orange px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {busy ? 'Saving…' : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="rounded border px-4 py-2 text-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}

function FeeEditor({ zone, canEdit, onSaved }: { zone: DeliveryZone; canEdit: boolean; onSaved: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(formatMinor(zone.deliveryFeeMinor));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const fee = parseEgpToMinorAllowZero(value);
    if (!fee.ok) {
      setError('Enter an amount in EGP, e.g. 15 or 15.50.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateDeliveryZoneFee(zone.id, fee.minor);
      setEditing(false);
      await onSaved();
    } catch (err) {
      setError(zoneErrorMessage(err, 'Failed to change the fee.'));
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <span data-testid="zone-fee-value">{formatMinor(zone.deliveryFeeMinor)} EGP</span>
        <button
          data-testid="zone-fee-edit"
          disabled={!canEdit}
          title={canEdit ? 'Change the delivery fee' : 'Requires the MANAGE_DELIVERY_FEE_MULTIPLIER permission'}
          onClick={() => {
            setValue(formatMinor(zone.deliveryFeeMinor));
            setEditing(true);
          }}
          className="text-xs text-gray-500 underline disabled:no-underline disabled:opacity-40"
        >
          Change
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <input data-testid="zone-fee-input" value={value} onChange={(e) => setValue(e.target.value)} className="w-24 rounded border px-2 py-1 text-sm" />
        <button data-testid="zone-fee-save" onClick={save} disabled={busy} className="rounded bg-hatly-orange px-2 py-1 text-xs text-white disabled:opacity-50">
          {busy ? '…' : 'Save'}
        </button>
        <button onClick={() => setEditing(false)} className="text-xs underline">
          Cancel
        </button>
      </div>
      <p className="text-xs text-gray-500">Applies to new quotes and orders only.</p>
      {error && (
        <p data-testid="zone-fee-error" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export default function DeliveryZonesPage() {
  const [zones, setZones] = useState<DeliveryZone[] | null>(null);
  const [areas, setAreas] = useState<ServiceArea[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const canManage = useAdminPermission(MANAGE_SERVICE_AREAS);
  const canPrice = useAdminPermission(MANAGE_DELIVERY_FEE_MULTIPLIER);
  const canCreate = canManage === true && canPrice === true;

  async function refresh() {
    setError(null);
    try {
      const [z, a] = await Promise.all([listDeliveryZones(), listServiceAreas()]);
      setZones(z);
      setAreas(a);
    } catch (err) {
      setError(zoneErrorMessage(err, 'Failed to load delivery zones.'));
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const areaName = useMemo(() => new Map(areas.map((a) => [a.id, a.nameAr ? `${a.name} / ${a.nameAr}` : a.name])), [areas]);
  const sorted = useMemo(
    () => [...(zones ?? [])].sort((a, b) => a.cityAr.localeCompare(b.cityAr) || a.displayOrder - b.displayOrder || a.nameAr.localeCompare(b.nameAr)),
    [zones],
  );

  async function toggle(zone: DeliveryZone) {
    setError(null);
    try {
      await setDeliveryZoneActive(zone.id, !zone.isActive);
      await refresh();
    } catch (err) {
      setError(zoneErrorMessage(err, 'Failed to update the zone.'));
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Delivery Zones</h1>
        <button
          data-testid="zone-new"
          onClick={() => setCreating((v) => !v)}
          disabled={!canCreate}
          title={canCreate ? undefined : 'Requires MANAGE_SERVICE_AREAS and MANAGE_DELIVERY_FEE_MULTIPLIER'}
          className="rounded bg-hatly-orange px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {creating ? 'Cancel' : 'New Delivery Zone'}
        </button>
      </div>
      <div className="mt-2 space-y-1 text-sm text-gray-600">
        <p data-testid="zones-vendor-rule">
          Vendor orders: for an address without a map pin, the zone the customer selects decides whether Hatly delivers there, and its fee is the base
          delivery fee (plus the additional-vendor fee for multi-vendor orders).
        </p>
        <p data-testid="zones-hatly-rule">
          Hatly Service: fee = Delivery Zone fee × Hatly Service multiplier (Settings), with or without a map pin.
        </p>
        <p>Changes never alter orders that were already placed.</p>
      </div>

      {creating && (
        <ZoneForm
          initial={{ ...EMPTY_FORM, serviceAreaId: areas.length === 1 ? areas[0].id : '' }}
          areas={areas}
          showFee
          submitLabel="Create zone"
          onCancel={() => setCreating(false)}
          onSubmit={async (v) => {
            await createDeliveryZone({ ...v.details, deliveryFeeMinor: v.feeMinor! });
            setCreating(false);
            await refresh();
          }}
        />
      )}

      <div className="mt-6">
        {error && (
          <div data-testid="zones-error" className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}{' '}
            <button onClick={refresh} className="underline">
              Retry
            </button>
          </div>
        )}
        {!error && zones === null && <p className="text-gray-500">Loading...</p>}
        {!error && zones !== null && zones.length === 0 && <p className="text-gray-500">No delivery zones yet.</p>}
        {zones !== null && zones.length > 0 && (
          <table data-testid="zones-table" className="mt-2 w-full divide-y rounded border bg-white text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">Zone</th>
                <th className="px-3 py-2">City / service area</th>
                <th className="px-3 py-2">Delivery fee</th>
                <th className="px-3 py-2">Order</th>
                <th className="px-3 py-2">Point</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {sorted.map((z) =>
                editingId === z.id ? (
                  <tr key={z.id}>
                    <td colSpan={7} className="px-3 py-2">
                      <ZoneForm
                        initial={toForm(z)}
                        areas={areas}
                        showFee={false}
                        submitLabel="Save changes"
                        onCancel={() => setEditingId(null)}
                        onSubmit={async (v) => {
                          await updateDeliveryZone(z.id, v.details);
                          setEditingId(null);
                          await refresh();
                        }}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={z.id} data-testid={`zone-row-${z.id}`}>
                    <td className="px-3 py-2">
                      <div className="font-medium" dir="rtl">
                        {z.nameAr}
                      </div>
                      <div className="text-xs text-gray-500">{z.name}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div dir="rtl">
                        {z.governorateAr} — {z.cityAr}
                      </div>
                      <div className="text-xs text-gray-500">{areaName.get(z.serviceAreaId) ?? z.serviceAreaId}</div>
                    </td>
                    <td className="px-3 py-2">
                      <FeeEditor zone={z} canEdit={canPrice === true && canManage === true} onSaved={refresh} />
                    </td>
                    <td className="px-3 py-2">{z.displayOrder}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">
                      {z.representativeLatitude != null ? `${z.representativeLatitude}, ${z.representativeLongitude}` : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <span data-testid="zone-status" className={`rounded px-2 py-0.5 text-xs ${z.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
                        {z.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="space-x-2 px-3 py-2 text-right">
                      <button data-testid="zone-edit" disabled={canManage !== true} onClick={() => setEditingId(z.id)} className="text-xs text-gray-600 underline disabled:opacity-40">
                        Edit
                      </button>
                      <button data-testid="zone-toggle" disabled={canManage !== true} onClick={() => toggle(z)} className="text-xs text-gray-600 underline disabled:opacity-40">
                        {z.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
