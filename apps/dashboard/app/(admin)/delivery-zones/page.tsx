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
import { useLang } from '../../../lib/ui/lang';
import { useIsMobile } from '../../../lib/ui/use-media-query';

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
  zoneName: string;
  zoneNameAr: string;
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
  zoneName: '',
  zoneNameAr: '',
  name: '',
  nameAr: '',
  displayOrder: '0',
  fee: '15.00',
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
    ['zoneName', 'Delivery Zone (EN)'],
    ['zoneNameAr', 'Delivery Zone (AR)'],
    ['name', 'Neighborhood / Village (EN)'],
    ['nameAr', 'Neighborhood / Village (AR)'],
  ];
  for (const [key, label] of required) {
    if (!form[key].trim()) return { ok: false, error: `${label} is required.` };
  }
  // A priced row represents ONE child: never accept a comma/newline-separated list.
  for (const key of ['zoneName', 'zoneNameAr', 'name', 'nameAr'] as const) {
    if (/[,،;|\r\n]/.test(form[key])) return { ok: false, error: 'Add each neighborhood/village separately, with its own English name, Arabic name and fee.' };
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
      zoneName: form.zoneName.trim(),
      zoneNameAr: form.zoneNameAr.trim(),
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
    zoneName: zone.zoneName ?? '',
    zoneNameAr: zone.zoneNameAr ?? '',
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
      <input data-testid={testId} dir={dir} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm" />
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
    <form onSubmit={submit} data-testid="zone-form" className="mt-4 space-y-3 rounded-xl border bg-white p-4 border-gray-200 shadow-sm">
      <label className="block text-sm">
        <span className="font-medium">Service area</span>
        <select data-testid="zone-service-area" value={form.serviceAreaId} onChange={(e) => set('serviceAreaId')(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm">
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
        <Field label="Delivery Zone (EN)" value={form.zoneName} onChange={set('zoneName')} testId="parent-zone-name" placeholder="Central Belbeis" />
        <Field label="Delivery Zone (AR)" value={form.zoneNameAr} onChange={set('zoneNameAr')} testId="parent-zone-name-ar" dir="rtl" placeholder="وسط بلبيس" />
        <Field label="Neighborhood / Village (EN)" value={form.name} onChange={set('name')} testId="zone-name" placeholder="Abu Naseeb" />
        <Field label="Neighborhood / Village (AR)" value={form.nameAr} onChange={set('nameAr')} testId="zone-name-ar" dir="rtl" placeholder="أبو نصيب" />
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
        <button type="submit" disabled={busy} className="rounded-lg bg-hatly-orange px-4 py-2 text-sm font-medium text-white disabled:opacity-50 shadow-sm hover:bg-hatly-orangeDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40">
          {busy ? 'Saving…' : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border px-4 py-2 text-sm border-gray-300 bg-white font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40">
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
        <input data-testid="zone-fee-input" value={value} onChange={(e) => setValue(e.target.value)} className="w-24 rounded-lg border px-2 py-1 text-sm border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100" />
        <button data-testid="zone-fee-save" onClick={save} disabled={busy} className="rounded-lg bg-hatly-orange px-2 py-1 text-xs text-white disabled:opacity-50 shadow-sm hover:bg-hatly-orangeDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40">
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
  const { t: tl } = useLang();
  const isPhone = useIsMobile();
  const [zones, setZones] = useState<DeliveryZone[] | null>(null);
  const [areas, setAreas] = useState<ServiceArea[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createPrefill, setCreatePrefill] = useState<FormState | null>(null);
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
  const [q, setQ] = useState('');
  const [stateFilter, setStateFilter] = useState<'' | 'active' | 'inactive'>('');
  const sorted = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...(zones ?? [])]
      .filter((z) => (!stateFilter || (stateFilter === 'active') === z.isActive) && (!needle || [z.zoneName ?? '', z.zoneNameAr ?? '', z.name, z.nameAr, z.city, z.cityAr, z.governorate, z.governorateAr].some((v) => (v ?? '').toLowerCase().includes(needle))))
      .sort((a, b) => a.cityAr.localeCompare(b.cityAr) || (a.zoneNameAr ?? '').localeCompare(b.zoneNameAr ?? '') || a.displayOrder - b.displayOrder || a.nameAr.localeCompare(b.nameAr));
  }, [zones, q, stateFilter]);
  const activeCount = (zones ?? []).filter((z) => z.isActive).length;
  const legacyCount = (zones ?? []).filter((z) => !z.zoneName || !z.zoneNameAr).length;
  function createChildOf(zone: DeliveryZone) {
    setEditingId(null);
    setCreatePrefill({
      ...toForm(zone),
      name: '', nameAr: '', fee: '15.00', lat: '', lng: '', displayOrder: String(zone.displayOrder + 1),
    });
    setCreating(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

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
    <div className="max-w-6xl">
      <div className="flex items-center justify-between">
        <div className="min-w-0"><h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">{tl('Delivery Zones', 'مناطق التوصيل')}</h1><p className="mt-1 max-w-3xl text-sm text-gray-500">{tl('The areas you deliver to and the delivery fee of each.', 'المناطق التي توصّل إليها ورسوم التوصيل لكل منها.')}</p></div>
        <button
          data-testid="zone-new"
          onClick={() => { setCreatePrefill(null); setCreating((v) => !v); }}
          disabled={!canCreate}
          title={canCreate ? undefined : 'Requires MANAGE_SERVICE_AREAS and MANAGE_DELIVERY_FEE_MULTIPLIER'}
          className="rounded-lg bg-hatly-orange px-4 py-2 text-sm font-medium text-white disabled:opacity-50 shadow-sm hover:bg-hatly-orangeDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40"
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
          Hatly &amp; Wasally: fee = base fee × the Hatly &amp; Wasally multiplier (Settings). For a manually chosen area the base fee is this zone&apos;s fee; a GPS address uses road distance instead.
        </p>
        <p>Changes never alter orders that were already placed.</p>
      </div>

      {creating && (
        <ZoneForm
          key={createPrefill ? `child-${createPrefill.serviceAreaId}-${createPrefill.zoneNameAr}` : 'new-zone'}
          initial={createPrefill ?? { ...EMPTY_FORM, serviceAreaId: areas.length === 1 ? areas[0].id : '' }}
          areas={areas}
          showFee
          submitLabel="Add neighborhood / village"
          onCancel={() => setCreating(false)}
          onSubmit={async (v) => {
            await createDeliveryZone({ ...v.details, deliveryFeeMinor: v.feeMinor! });
            setCreating(false);
            setCreatePrefill(null);
            await refresh();
          }}
        />
      )}

      <div className="mt-4 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600">
        One row = one neighborhood/village, with one Arabic name, one English name and its own delivery fee.
        Existing delivery zones can contain multiple separately priced neighborhoods.
        {legacyCount > 0 && (
          <p className="mt-1 text-amber-700" data-testid="legacy-zone-review">
            {legacyCount} legacy item(s) still need an explicit parent delivery zone.
            All original names, fees and customer references have been preserved; check combined names before separating them.
          </p>
        )}
      </div>
      <div className="mt-6">
        {error && (
          <div data-testid="zones-error" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}{' '}
            <button onClick={refresh} className="underline">
              Retry
            </button>
          </div>
        )}
        {!error && zones === null && <p className="text-gray-500">Loading...</p>}
        {!error && zones !== null && zones.length === 0 && <p className="text-gray-500">No delivery zones yet.</p>}
        {zones !== null && zones.length > 0 && (
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center" data-testid="zones-toolbar">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tl('Search delivery zone, neighborhood, city or governorate', 'ابحث بالمنطقة أو المدينة أو المحافظة')} aria-label={tl('Search zones', 'البحث في المناطق')} className="min-h-[44px] w-full rounded-lg border border-gray-300 px-3 text-sm sm:max-w-sm" />
            <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value as typeof stateFilter)} aria-label={tl('Status', 'الحالة')} className="min-h-[44px] rounded-lg border border-gray-300 px-2 text-sm">
              <option value="">{tl('Any status', 'أي حالة')}</option>
              <option value="active">{tl('Active', 'نشط')}</option>
              <option value="inactive">{tl('Inactive', 'غير نشط')}</option>
            </select>
            <span className="text-xs text-gray-500" aria-live="polite">{tl(`${sorted.length} of ${zones.length} zones · ${activeCount} active`, `${sorted.length} من ${zones.length} منطقة · ${activeCount} نشطة`)}</span>
          </div>
        )}
        {zones !== null && zones.length > 0 && sorted.length === 0 && <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">{tl('No zone matches these filters.', 'لا توجد منطقة مطابقة.')}</p>}
        {zones !== null && sorted.length > 0 && !isPhone && (
          <div className="overflow-x-auto">
          <table data-testid="zones-table" className="mt-2 w-full divide-y rounded border bg-white text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500 tracking-wide">
              <tr>
                <th className="px-3 py-2 text-start font-medium">Delivery Zone</th>
                <th className="px-3 py-2 text-start font-medium">Neighborhood / Village</th>
                <th className="px-3 py-2 text-start font-medium">Delivery fee</th>
                <th className="px-3 py-2 text-start font-medium">Order</th>
                <th className="px-3 py-2 text-start font-medium">Point</th>
                <th className="px-3 py-2 text-start font-medium">Status</th>
                <th className="px-3 py-2 text-start font-medium" />
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
                      <div className="font-medium" dir="rtl">{z.zoneNameAr ?? z.cityAr}</div>
                      <div className="text-xs text-gray-500">{z.zoneName ?? z.city}</div>
                      {!z.zoneName && <div className="text-xs text-amber-700">Legacy: review parent</div>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium" dir="rtl">{z.nameAr}</div>
                      <div className="text-xs text-gray-500">{z.name}</div>
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
                      <button data-testid="add-neighborhood" disabled={!canCreate || !z.zoneName} onClick={() => createChildOf(z)} className="text-xs text-hatly-orangeDark underline disabled:opacity-40">Add child</button>
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
          </div>
        )}
        {zones !== null && sorted.length > 0 && isPhone && (
          <ul className="space-y-3" data-testid="zones-cards">
            {sorted.map((z) => (
              <li key={`card-${z.id}`} className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                {editingId === z.id ? (
                  <ZoneForm initial={toForm(z)} areas={areas} showFee={false} submitLabel="Save changes" onCancel={() => setEditingId(null)} onSubmit={async (v) => { await updateDeliveryZone(z.id, v.details); setEditingId(null); await refresh(); }} />
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold" dir="rtl">{z.zoneNameAr ?? z.cityAr} | {z.nameAr}</p>
                        <p className="text-xs text-gray-500">{z.zoneName ?? z.city} | {z.name}</p>
                        {!z.zoneName && <p className="text-xs text-amber-700">Legacy: review parent</p>
                        <p className="mt-1 text-xs text-gray-600" dir="rtl">{z.governorateAr} — {z.cityAr}</p>
                        <p className="text-xs text-gray-400">{areaName.get(z.serviceAreaId) ?? z.serviceAreaId}</p>
                      </div>
                      <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${z.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>{z.isActive ? tl('Active', 'نشط') : tl('Inactive', 'غير نشط')}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 border-t border-gray-100 pt-2">
                      <FeeEditor zone={z} canEdit={canPrice === true && canManage === true} onSaved={refresh} />
                      <span className="flex gap-2">
                        <button disabled={!canCreate || !z.zoneName} onClick={() => createChildOf(z)} className="min-h-[44px] px-2 text-sm font-medium text-hatly-orangeDark disabled:opacity-40">{tl('Add child', 'إضافة حي/قرية')}</button>
                        <button disabled={canManage !== true} onClick={() => setEditingId(z.id)} className="min-h-[44px] px-2 text-sm font-medium text-hatly-orangeDark disabled:opacity-40">{tl('Edit', 'تعديل')}</button>
                        <button disabled={canManage !== true} onClick={() => toggle(z)} className="min-h-[44px] px-2 text-sm font-medium text-gray-700 disabled:opacity-40">{z.isActive ? tl('Deactivate', 'إيقاف') : tl('Activate', 'تفعيل')}</button>
                      </span>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
