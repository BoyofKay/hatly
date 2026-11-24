'use client';
import { minorToEgpInput, parseEgpToMinorAllowZero } from '../../../lib/money';

import { useEffect, useRef, useState } from 'react';
import { clearBusinessConfigValue, getBusinessConfigValue, setBusinessConfigValue } from '../../../lib/api/admin-business-config';
import {
  EMPTY_ROUTE_DEFAULT_FORM,
  ROUTE_DEFAULT_DEFS,
  buildRouteDefault,
  formFromValue,
  statusOf,
  type RouteDefaultDef,
  type RouteDefaultForm,
  type RouteDefaultStatus,
} from '../../../lib/service-routes/route-defaults';
import { apiErrorMessage } from '../../../lib/api/errors';
import { useLang } from '../../../lib/ui/lang';

const CUSTOMER_OTP_ENABLED_KEY = 'CUSTOMER_OTP_ENABLED';

/**
 * M3a (Launch-Readiness Gap Audit, G-28). A curated, understood subset
 * of `BusinessConfigKey` (business-config-key.enum.ts) — NOT every key
 * the backend's generic `PUT admin/business-config/:key` would accept.
 * Deliberately excluded (documented in the M3a report, not silently
 * dropped): the Hatly / Wasally default route locations (lat/lng/label objects — they have
 * their own card, `RouteDefaultsCard`, below; PD-012) and
 * `CHECKOUT_ENABLED_ELECTRONIC_METHODS` (an array of a payment-method
 * enum needing a multi-select, not a single scalar control) — both real
 * capabilities, just outside this generic editor's single-scalar shape.
 * `CUSTOMER_OTP_ENABLED` is already its own dedicated control above,
 * not duplicated here.
 */
/** `money`: stored as integer piastres, shown and typed as EGP with up to 2 decimals (10.50). */
type ConfigFieldType = 'boolean' | 'integer' | 'decimal' | 'enum' | 'string' | 'money';

interface ConfigFieldDef {
  key: string;
  label: string;
  type: ConfigFieldType;
  options?: string[];
  unit?: string;
  help?: string;
  /** The setting may be cleared (its absence has a defined meaning, e.g. a default or "off"). */
  clearable?: boolean;
}

const CONFIG_FIELDS: ConfigFieldDef[] = [
  { key: 'AUTOMATIC_DISPATCH_ENABLED', label: 'Automatic Dispatch', type: 'boolean', help: 'OFF: orders wait for manual assignment on the Dispatch page instead of auto-assigning.' },
  { key: 'MULTI_VENDOR_ORDERS_ENABLED', label: 'Multi-Vendor Orders', type: 'boolean', help: 'OFF: checkout rejects a cart with more than one vendor group.' },
  { key: 'VENDOR_SETTLEMENT_FREQUENCY', label: 'Vendor Settlement Frequency', type: 'enum', options: ['WEEKLY', 'MONTHLY'] },
  { key: 'DRIVER_SETTLEMENT_FREQUENCY', label: 'Driver Settlement Frequency', type: 'enum', options: ['WEEKLY', 'MONTHLY'] },
  { key: 'REGISTERED_VENDOR_PRICE_PER_100M_MINOR', label: 'Registered-Vendor Price per 100m', type: 'money', unit: 'EGP' },
  { key: 'REGISTERED_VENDOR_MINIMUM_DELIVERY_FEE_MINOR', label: 'Registered-Vendor Minimum Delivery Fee', type: 'money', unit: 'EGP' },
  { key: 'REGISTERED_VENDOR_ADDITIONAL_VENDOR_FEE_MINOR', label: 'Registered-Vendor Additional-Vendor Fee', type: 'money', unit: 'EGP' },
  // Hatly AND Wasally: base fee by the customer's address method, then this multiplier once. Replaces the retired HATLY_SERVICE_DISTANCE_MULTIPLIER (never read).
  {
    key: 'HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER',
    label: 'Hatly & Wasally Delivery Fee Multiplier',
    type: 'decimal',
    unit: '× base fee',
    help: "Applies to BOTH Hatly and Wasally, once, after the ordinary base delivery fee: Hatly / Wasally fee = base fee × this multiplier. The base fee is the selected delivery area's fixed fee (manual address) or the road-distance fee from the price per 100 m and minimum above (GPS address). It is never applied to the per-100 m price itself. Approved default 1.5. Positive, up to 10. New quotes/orders only — placed orders keep the fee they were frozen with.",
  },
  { key: 'DRIVER_CASH_WARNING_MINOR', label: 'Driver cash exposure warning / تنبيه النقدية المستحقة', type: 'money', unit: 'EGP', help: 'Notify Operations when unclosed plus closed-uncollected cash reaches this limit. Must not exceed the hard cap.' },
  { key: 'DRIVER_CASH_CAP_MINOR', label: 'Driver maximum cash exposure / الحد الأقصى للنقدية', type: 'money', unit: 'EGP', help: 'Blocks new assignments at the cap or if projected COD collections exceed it. Existing orders can be completed.' },
  { key: 'DRIVER_ALLOWANCE_CAP_MINOR', label: 'Maximum outstanding daily allowance / الحد الأقصى للعهدة', type: 'money', unit: 'EGP', help: 'Block additional allowances when outstanding plus new amount exceeds the limit. Zero prevents issuance.' },
  { key: 'EMPLOYEE_LOAN_MAX_OUTSTANDING_MINOR', label: 'Maximum a driver may owe in loans', type: 'money', unit: 'EGP', clearable: true, help: 'The most one employee (driver) may owe in loans at a time. Empty = no cap: the operations supervisor decides each loan.' },
  { key: 'MAX_BICYCLE_PICKUP_DISTANCE_METERS', label: 'Max Bicycle Pickup Distance', type: 'integer', unit: 'meters' },
  {
    key: 'DISPATCH_PREFERRED_RADIUS_METERS',
    label: 'Dispatch: preferred driver radius',
    type: 'integer',
    unit: 'meters',
    help: 'Automatic assignment prefers the driver with the FEWEST active orders among drivers within this distance of the store (then the nearest). Drivers farther away are used only when nobody is this close. Empty = 3000 m. Allowed 300 to 50000.',
    clearable: true,
  },
  {
    key: 'EARLY_DISPATCH_ENABLED',
    label: 'Early dispatch (driver while the store prepares)',
    type: 'boolean',
    help: 'ON: a driver is attached when the store accepts the order, or the lead time below before the expected ready time — whichever is later; the driver heads to the store and marks Picked up once it is ready. Needs Automatic Dispatch ON. Switch it on only after the drivers have driver app 1.0.2 (build 11) or newer.',
  },
  {
    key: 'DISPATCH_ASSIGNMENT_LEAD_TIME_MINUTES',
    label: 'Early dispatch lead time',
    type: 'integer',
    unit: 'minutes',
    help: 'With early dispatch on: attach the driver this many minutes before the order is expected to be ready (never before the store accepts). Empty = 10. Allowed 0 to 120.',
    clearable: true,
  },
  {
    key: 'DISPATCH_ACKNOWLEDGEMENT_WINDOW_MINUTES',
    label: 'Driver Acknowledgement Window',
    type: 'integer',
    unit: 'minutes',
    help: 'How long a driver has to acknowledge an assignment (manual or automatic). Default 5 when empty; allowed 1 to 30. When it passes, Operations get an alert and — when automatic assignment is on — the order is offered to the next driver automatically. Applies to new assignments only.',
    clearable: true,
  },
  {
    key: 'DRIVER_PRESENCE_STALE_MINUTES',
    label: 'Driver App Silent Alert',
    type: 'integer',
    unit: 'minutes',
    help: 'If a driver holding an active order has not been heard from by the driver app for this long, Operations get an alert ("assignment may not have reached the driver"). Empty = this alert is off (a driver switching to offline still alerts). Allowed 2 to 240. Nothing is reassigned or cancelled automatically.',
    clearable: true,
  },
  {
    key: 'MANUAL_TRANSFER_VERIFICATION_WINDOW_MINUTES',
    label: 'Transfer Verification Window',
    type: 'integer',
    unit: 'minutes',
    help: 'An InstaPay / Vodafone Cash order whose money is not verified within this time after it was placed is cancelled automatically and its stock released. Money that arrives later is reviewed and refunded; the order is not reactivated. Empty = never cancelled automatically. Allowed 15 to 10080 (7 days).',
    clearable: true,
  },
  { key: 'LOYALTY_POINTS_PER_EGP', label: 'Loyalty Points per EGP', type: 'integer', unit: 'points' },
  { key: 'LOYALTY_WALLET_CONVERSION_POINTS_PER_EGP', label: 'Loyalty→Wallet Conversion Rate', type: 'integer', unit: 'points per EGP' },
  { key: 'CHECKOUT_QUOTE_TTL_SECONDS', label: 'Checkout Quote TTL', type: 'integer', unit: 'seconds' },
  { key: 'ETA_RANGE_BUFFER_MINUTES', label: 'ETA Range Buffer', type: 'integer', unit: 'minutes' },
  { key: 'CUSTOMER_SERVICE_WHATSAPP_NUMBER', label: 'Customer Service WhatsApp Number', type: 'string' },
  { key: 'OPERATIONS_CONTACT_PHONE', label: 'Operations Phone (for drivers)', type: 'string', help: 'The number the driver app\'s "Call Operations" button dials. Empty: the Customer Service number above is used; if both are empty the button is hidden.', clearable: true },
];

function ConfigRow({ field }: { field: ConfigFieldDef }) {
  const [value, setValue] = useState<string>('');
  const [loaded, setLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Once the admin has edited the field, a load that resolves later (e.g. React StrictMode's second effect run in development)
  // must never overwrite what they typed — otherwise "Save" could silently store the old value instead of theirs.
  const edited = useRef(false);

  async function load() {
    setError(null);
    try {
      const raw = await getBusinessConfigValue<unknown>(field.key);
      if (!edited.current) setValue(raw === null || raw === undefined ? '' : field.type === 'money' ? minorToEgpInput(Number(raw)) : String(raw));
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to load.'));
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field.key]);

  async function handleSave() {
    if (isSaving) return;
    setError(null);
    setSaved(false);
    let parsed: unknown = value;
    if (field.type === 'integer') {
      const n = Number(value);
      if (value.trim() === '' || !Number.isFinite(n)) {
        setError('Enter a valid number.');
        return;
      }
      parsed = n;
    } else if (field.type === 'money') {
      const p = parseEgpToMinorAllowZero(value);
      if (!p.ok) {
        setError('Enter an amount in EGP, e.g. 10 or 10.50.');
        return;
      }
      parsed = p.minor;
    } else if (field.type === 'decimal') {
      const n = Number(value);
      if (!/^\d+(\.\d{1,4})?$/.test(value.trim()) || !(n > 0) || n > 10) {
        setError('Enter a positive number up to 10 (e.g. 1.5).');
        return;
      }
      parsed = n;
    } else if (field.type === 'boolean') {
      parsed = value === 'true';
    }
    setIsSaving(true);
    try {
      await setBusinessConfigValue(field.key, parsed);
      setSaved(true);
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to save.'));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleClear() {
    if (isSaving) return;
    setError(null);
    setSaved(false);
    setIsSaving(true);
    try {
      await clearBusinessConfigValue(field.key);
      edited.current = false;
      setValue('');
      setSaved(true);
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to clear.'));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-1 border-b py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-medium">{field.label}</p>
        {field.help && <p className="text-xs text-gray-500">{field.help}</p>}
      </div>
      <div className="flex items-center gap-2">
        {!loaded ? (
          <span className="text-xs text-gray-400">Loading...</span>
        ) : field.type === 'boolean' ? (
          <select
            value={value || 'false'}
            onChange={(e) => { edited.current = true; setValue(e.target.value); setSaved(false); }}
            className="min-h-[40px] rounded-lg border px-2 py-1 text-sm border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100"
          >
            <option value="true">ON</option>
            <option value="false">OFF</option>
          </select>
        ) : field.type === 'enum' && field.options ? (
          <select
            value={value}
            onChange={(e) => { edited.current = true; setValue(e.target.value); setSaved(false); }}
            className="min-h-[40px] rounded-lg border px-2 py-1 text-sm border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100"
          >
            <option value="">Unset</option>
            {field.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : (
          <input
            type={field.type === 'integer' ? 'number' : 'text'}
            inputMode={field.type === 'decimal' || field.type === 'money' ? 'decimal' : undefined}
            data-testid={`config-input-${field.key}`}
            value={value}
            onChange={(e) => { edited.current = true; setValue(e.target.value); setSaved(false); }}
            className="min-h-[40px] w-40 rounded-lg border px-2 py-1 text-sm border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100"
          />
        )}
        {field.unit && <span className="text-xs text-gray-400">{field.unit}</span>}
        <button
          onClick={handleSave}
          disabled={isSaving || !loaded}
          className="min-h-[40px] rounded-lg bg-hatly-orange px-4 py-1 text-sm font-medium text-white disabled:opacity-50 shadow-sm hover:bg-hatly-orangeDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40"
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
        {field.clearable && (
          <button
            onClick={handleClear}
            disabled={isSaving || !loaded}
            data-testid={`config-clear-${field.key}`}
            className="min-h-[40px] rounded-lg border border-gray-300 px-3 py-1 text-sm text-gray-700 disabled:opacity-50 hover:bg-gray-50"
          >
            Clear
          </button>
        )}
        {saved && <span className="text-xs text-green-700">Saved</span>}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </div>
  );
}


const STATUS_TEXT: Record<RouteDefaultStatus, { text: string; className: string }> = {
  NOT_CONFIGURED: { text: 'Not configured — customers must choose this point themselves', className: 'text-amber-700' },
  CONFIGURED: { text: 'Configured', className: 'text-green-700' },
  INVALID: { text: 'Stored value is invalid — it is ignored until you save a valid one', className: 'text-red-700' },
};

/** One default route location: status, the three fields, Save (validated here and again by the backend) and Clear. */
function RouteDefaultRow({ def, onChanged }: { def: RouteDefaultDef; onChanged: (key: string, raw: unknown) => void }) {
  const [form, setForm] = useState<RouteDefaultForm>({ ...EMPTY_ROUTE_DEFAULT_FORM });
  const [status, setStatus] = useState<RouteDefaultStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await getBusinessConfigValue<unknown>(def.key);
        if (cancelled) return;
        setStatus(statusOf(raw));
        setForm(formFromValue(raw));
        onChanged(def.key, raw);
      } catch (err: any) {
        if (!cancelled) setError(apiErrorMessage(err, 'Failed to load.'));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.key]);

  function edit(patch: Partial<RouteDefaultForm>) {
    setForm((f) => ({ ...f, ...patch }));
    setNote(null);
  }

  async function save() {
    if (busy) return;
    setError(null);
    setNote(null);
    const built = buildRouteDefault(form);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setBusy(true);
    try {
      await setBusinessConfigValue(def.key, built.value);
      setStatus('CONFIGURED');
      setForm(formFromValue(built.value));
      onChanged(def.key, built.value);
      setNote('Saved. New quotes use it immediately; placed orders keep the route they were frozen with.');
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to save.'));
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (busy) return;
    if (!window.confirm(`Clear "${def.title}"? Customers will then have to choose this point themselves.`)) return;
    setError(null);
    setNote(null);
    setBusy(true);
    try {
      await clearBusinessConfigValue(def.key);
      setStatus('NOT_CONFIGURED');
      setForm({ ...EMPTY_ROUTE_DEFAULT_FORM });
      onChanged(def.key, null);
      setNote('Cleared.');
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to clear.'));
    } finally {
      setBusy(false);
    }
  }

  const s = status ? STATUS_TEXT[status] : null;
  return (
    <div className="border-b py-3 last:border-0" data-testid={`route-default-${def.key}`}>
      <p className="text-sm font-medium">{def.title}</p>
      <p className="text-xs text-gray-500">{def.help}</p>
      <p className={`mt-1 text-xs ${s?.className ?? 'text-gray-400'}`} data-testid={`route-default-status-${def.key}`}>
        {s ? s.text : 'Loading...'}
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-[8rem_8rem_1fr]">
        <input
          aria-label={`${def.title} latitude`}
          data-testid={`route-default-lat-${def.key}`}
          inputMode="decimal"
          placeholder="Latitude"
          value={form.latitude}
          onChange={(e) => edit({ latitude: e.target.value })}
          className="rounded-lg border px-2 py-1 text-sm border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100"
        />
        <input
          aria-label={`${def.title} longitude`}
          data-testid={`route-default-lng-${def.key}`}
          inputMode="decimal"
          placeholder="Longitude"
          value={form.longitude}
          onChange={(e) => edit({ longitude: e.target.value })}
          className="rounded-lg border px-2 py-1 text-sm border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100"
        />
        <input
          aria-label={`${def.title} label`}
          data-testid={`route-default-label-${def.key}`}
          maxLength={120}
          placeholder="Label customers see (e.g. the place name)"
          value={form.label}
          onChange={(e) => edit({ label: e.target.value })}
          className="rounded-lg border px-2 py-1 text-sm border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100"
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button onClick={save} disabled={busy || status === null} className="rounded-lg bg-hatly-orange px-3 py-1 text-xs font-medium text-white disabled:opacity-50 shadow-sm hover:bg-hatly-orangeDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40">
          {busy ? 'Working...' : 'Save'}
        </button>
        <button onClick={clear} disabled={busy || status === null || status === 'NOT_CONFIGURED'} className="rounded-lg border px-3 py-1 text-xs disabled:opacity-50 border-gray-300 bg-white font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40">
          Clear
        </button>
        {note && <span className="text-xs text-green-700">{note}</span>}
        {error && <span className="text-xs text-red-600" role="alert">{error}</span>}
      </div>
    </div>
  );
}

/**
 * PD-012. Where Hatly and Wasally routes start and end when the customer does not choose. Hatly has an origin and a destination
 * default; Wasally only a destination default (a Wasally pick-up is always the customer's choice). Nothing is pre-filled or invented:
 * until a default is saved the customer app asks the customer to choose that point.
 */
function RouteDefaultsCard() {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [loadedKeys, setLoadedKeys] = useState<Set<string>>(new Set());
  const onChanged = (key: string, raw: unknown) => {
    setValues((v) => ({ ...v, [key]: raw }));
    setLoadedKeys((k) => new Set(k).add(key));
  };
  const missing = ROUTE_DEFAULT_DEFS.filter((d) => loadedKeys.has(d.key) && statusOf(values[d.key]) !== 'CONFIGURED');
  return (
    <div className="mt-6 rounded-xl border bg-white p-4 border-gray-200 shadow-sm" data-testid="route-defaults-card">
      <h2 className="font-semibold">Hatly &amp; Wasally default route points</h2>
      <p className="mt-1 text-xs text-gray-500">
        Every Hatly / Wasally request goes from an origin to a destination. Each end is the customer&apos;s own choice; when they do not
        choose one, the default below is used. Hatly and Wasally keep separate defaults. A default is never taken from the customer&apos;s
        address, and nothing is filled in for you: enter the real coordinates and the name customers will see.
      </p>
      {missing.length > 0 && (
        <p className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800" data-testid="route-defaults-missing">
          Still to enter: {missing.map((d) => d.title).join(' · ')}.
        </p>
      )}
      <div className="mt-2">
        {ROUTE_DEFAULT_DEFS.map((def) => (
          <RouteDefaultRow key={def.key} def={def} onChanged={onChanged} />
        ))}
      </div>
    </div>
  );
}

/** M3a (Launch-Readiness Gap Audit, G-28). `{ label, phoneOrAccountNumber, accountName? }` — see BusinessConfigKey's own doc comment. Until set, Manual Transfer fails closed. */
function ManualTransferDestinationForm() {
  const KEY = 'MANUAL_TRANSFER_DESTINATION';
  const [label, setLabel] = useState('');
  const [phoneOrAccountNumber, setPhoneOrAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function load() {
    setError(null);
    try {
      const raw = await getBusinessConfigValue<{ label?: string; phoneOrAccountNumber?: string; accountName?: string }>(KEY);
      setLabel(raw?.label ?? '');
      setPhoneOrAccountNumber(raw?.phoneOrAccountNumber ?? '');
      setAccountName(raw?.accountName ?? '');
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to load.'));
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (isSaving) return;
    if (!label.trim() || !phoneOrAccountNumber.trim()) {
      setError('Label and phone/account number are required.');
      return;
    }
    setError(null);
    setSaved(false);
    setIsSaving(true);
    try {
      await setBusinessConfigValue(KEY, { label: label.trim(), phoneOrAccountNumber: phoneOrAccountNumber.trim(), accountName: accountName.trim() || undefined });
      setSaved(true);
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to save.'));
    } finally {
      setIsSaving(false);
    }
  }

  if (!loaded) return <p className="text-sm text-gray-500">Loading...</p>;

  return (
    <form onSubmit={handleSave} className="space-y-2">
      <input value={label} onChange={(e) => { setLabel(e.target.value); setSaved(false); }} placeholder="Label (e.g. InstaPay)" className="w-full rounded-lg border px-2 py-1.5 text-sm border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100" />
      <input value={phoneOrAccountNumber} onChange={(e) => { setPhoneOrAccountNumber(e.target.value); setSaved(false); }} placeholder="Phone or account number" className="w-full rounded-lg border px-2 py-1.5 text-sm border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100" />
      <input value={accountName} onChange={(e) => { setAccountName(e.target.value); setSaved(false); }} placeholder="Account name (optional)" className="w-full rounded-lg border px-2 py-1.5 text-sm border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100" />
      {error && <p className="text-sm text-red-600">{error}</p>}
      {saved && <p className="text-sm text-green-700">Saved.</p>}
      <button type="submit" disabled={isSaving} className="rounded-lg bg-hatly-orange px-4 py-2 text-sm font-medium text-white disabled:opacity-50 shadow-sm hover:bg-hatly-orangeDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40">
        {isSaving ? 'Saving...' : 'Save'}
      </button>
    </form>
  );
}

/**
 * Customer Authentication Modes (master implementation) + M3a
 * (Launch-Readiness Gap Audit, G-28) Operational Configuration section.
 * Reuses the existing generic GET/PUT admin/business-config/:key
 * endpoints and MANAGE_BUSINESS_CONFIG permission throughout (enforced
 * server-side; a 403 here shows as a plain error, never bypassed).
 */
export default function SettingsPage() {
  const { t: tl } = useLang();
  const [otpEnabled, setOtpEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function load() {
    setError(null);
    try {
      const value = await getBusinessConfigValue<boolean>(CUSTOMER_OTP_ENABLED_KEY);
      // Matches the backend's own default: unset (null) means OTP mode (true).
      setOtpEnabled(value ?? true);
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to load setting.'));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleToggle() {
    if (otpEnabled === null || isSaving) return;
    const next = !otpEnabled;
    if (!next) {
      // Lightweight confirmation before switching OFF — window.confirm,
      // matching this Dashboard's existing convention (no new
      // confirmation-dialog infrastructure introduced).
      const confirmed = window.confirm(
        'Turn OFF phone verification by OTP? New customers will still register and sign in with Phone + Password, but they will not be asked to verify their phone number with a code until this is turned back on. Existing accounts and sessions are not affected.',
      );
      if (!confirmed) return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await setBusinessConfigValue(CUSTOMER_OTP_ENABLED_KEY, next, 'Controls first-time phone verification by OTP during customer registration. It never changes sign-in: customers always sign in with phone + password.');
      setOtpEnabled(next);
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to update setting.'));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="max-w-6xl">
      <div className="min-w-0"><h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">{tl('Settings', 'الإعدادات')}</h1><p className="mt-1 max-w-3xl text-sm text-gray-500">{tl('Platform-wide settings. A change applies immediately to every customer and vendor.', 'إعدادات على مستوى المنصة. يسري أي تغيير فورًا على كل العملاء والمتاجر.')}</p></div>

      <nav aria-label={tl('Settings sections', 'أقسام الإعدادات')} className="sticky top-0 z-10 -mx-1 mt-4 flex gap-2 overflow-x-auto bg-gray-50/95 px-1 py-2 backdrop-blur" data-testid="settings-nav">
        {([['sec-auth', tl('Authentication', 'تسجيل الدخول')], ['sec-config', tl('Operational configuration', 'الإعدادات التشغيلية')], ['sec-routes', tl('Hatly & Wasally routes', 'مسارات هاتلي ووصّلي')], ['sec-payments', tl('Manual transfer', 'التحويل اليدوي')]] as const).map(([id, label]) => (
          <a key={id} href={`#${id}`} className="inline-flex min-h-[40px] shrink-0 items-center rounded-full border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50">{label}</a>
        ))}
      </nav>

      <div id="sec-auth" className="mt-4 scroll-mt-16 rounded-xl border bg-white p-4 border-gray-200 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium">Customer Authentication — OTP</p>
            <p className="mt-1 text-sm text-gray-500">
              OTP is used only to verify a customer&apos;s phone number the first time, during registration. It is not used to
              sign in: customers always sign in with phone + password, and every account has a password.
            </p>
            {otpEnabled === true && (
              <p className="mt-1 text-sm text-gray-500">ON: new customers are asked to verify their phone number with a code.</p>
            )}
            {otpEnabled === false && (
              <p className="mt-1 text-sm text-gray-500">
                OFF: new customers register with phone + password and are not asked for a code; their phone stays unverified until
                verification is turned back on and they complete it.
              </p>
            )}
          </div>
          {otpEnabled !== null && (
            <button
              onClick={handleToggle}
              disabled={isSaving}
              className={`min-h-[44px] rounded-lg px-5 py-2 text-sm font-medium text-white disabled:opacity-50 ${
                otpEnabled ? 'bg-hatly-orange' : 'bg-gray-500'
              }`}
            >
              {isSaving ? 'Saving...' : otpEnabled ? 'ON' : 'OFF'}
            </button>
          )}
        </div>
        {error && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}{' '}
            <button onClick={load} className="underline">
              Retry
            </button>
          </div>
        )}
        {otpEnabled === null && !error && <p className="mt-3 text-sm text-gray-500">Loading...</p>}
      </div>

      <div id="sec-config" className="mt-6 scroll-mt-16 rounded-xl border bg-white p-4 border-gray-200 shadow-sm">
        <h2 className="font-semibold">Operational Configuration</h2>
        <p className="mt-1 text-xs text-gray-500">
          Each value is saved independently. An unset value shown blank means the backend has no value yet — the
          relevant feature fails closed until it is set (never a fabricated default).
        </p>
        <div className="mt-2">
          {CONFIG_FIELDS.map((field) => (
            <ConfigRow key={field.key} field={field} />
          ))}
        </div>
      </div>

      <div id="sec-routes" className="scroll-mt-16"><RouteDefaultsCard /></div>

      <div id="sec-payments" className="mt-6 scroll-mt-16 rounded-xl border bg-white p-4 border-gray-200 shadow-sm">
        <h2 className="font-semibold">Manual Transfer Destination</h2>
        <p className="mt-1 text-xs text-gray-500">Until set, Manual Transfer payments fail closed.</p>
        <div className="mt-2">
          <ManualTransferDestinationForm />
        </div>
      </div>
    </div>
  );
}
