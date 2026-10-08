'use client';

import { useEffect, useRef, useState } from 'react';
import { getBusinessConfigValue, setBusinessConfigValue } from '../../../lib/api/admin-business-config';
import { apiErrorMessage } from '../../../lib/api/errors';

const CUSTOMER_OTP_ENABLED_KEY = 'CUSTOMER_OTP_ENABLED';

/**
 * M3a (Launch-Readiness Gap Audit, G-28). A curated, understood subset
 * of `BusinessConfigKey` (business-config-key.enum.ts) — NOT every key
 * the backend's generic `PUT admin/business-config/:key` would accept.
 * Deliberately excluded (documented in the M3a report, not silently
 * dropped): `HATLY_SERVICE_DEFAULT_PICKUP_LOCATION` /
 * `..._DESTINATION_LOCATION` (lat/lng/label objects) and
 * `CHECKOUT_ENABLED_ELECTRONIC_METHODS` (an array of a payment-method
 * enum needing a multi-select, not a single scalar control) — both real
 * capabilities, just outside this generic editor's single-scalar shape.
 * `CUSTOMER_OTP_ENABLED` is already its own dedicated control above,
 * not duplicated here.
 */
type ConfigFieldType = 'boolean' | 'integer' | 'decimal' | 'enum' | 'string';

interface ConfigFieldDef {
  key: string;
  label: string;
  type: ConfigFieldType;
  options?: string[];
  unit?: string;
  help?: string;
}

const CONFIG_FIELDS: ConfigFieldDef[] = [
  { key: 'AUTOMATIC_DISPATCH_ENABLED', label: 'Automatic Dispatch', type: 'boolean', help: 'OFF: orders wait for manual assignment on the Dispatch page instead of auto-assigning.' },
  { key: 'MULTI_VENDOR_ORDERS_ENABLED', label: 'Multi-Vendor Orders', type: 'boolean', help: 'OFF: checkout rejects a cart with more than one vendor group.' },
  { key: 'VENDOR_SEGMENT_AUTO_ACCEPT_ENABLED', label: 'Vendor Segment Auto-Accept', type: 'boolean', help: 'ON: new vendor segments start CONFIRMED automatically instead of waiting for vendor acceptance.' },
  { key: 'VENDOR_SETTLEMENT_FREQUENCY', label: 'Vendor Settlement Frequency', type: 'enum', options: ['WEEKLY', 'MONTHLY'] },
  { key: 'DRIVER_SETTLEMENT_FREQUENCY', label: 'Driver Settlement Frequency', type: 'enum', options: ['WEEKLY', 'MONTHLY'] },
  { key: 'REGISTERED_VENDOR_PRICE_PER_100M_MINOR', label: 'Registered-Vendor Price per 100m', type: 'integer', unit: 'minor units' },
  { key: 'REGISTERED_VENDOR_MINIMUM_DELIVERY_FEE_MINOR', label: 'Registered-Vendor Minimum Delivery Fee', type: 'integer', unit: 'minor units' },
  { key: 'REGISTERED_VENDOR_ADDITIONAL_VENDOR_FEE_MINOR', label: 'Registered-Vendor Additional-Vendor Fee', type: 'integer', unit: 'minor units' },
  // PD-009 (amended): Hatly Service pricing is zone-based. Replaces the retired HATLY_SERVICE_DISTANCE_MULTIPLIER (never read).
  {
    key: 'HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER',
    label: 'Hatly Service Delivery Fee Multiplier',
    type: 'decimal',
    unit: '× zone fee',
    help: "Hatly Service fee = Delivery Zone fee × Hatly Service multiplier. The customer's selected delivery zone is always used — a map pin or distance never changes the price. Approved default 1.5. Positive, up to 10. New quotes/orders only — placed orders keep their fee.",
  },
  { key: 'MAX_BICYCLE_PICKUP_DISTANCE_METERS', label: 'Max Bicycle Pickup Distance', type: 'integer', unit: 'meters' },
  { key: 'DISPATCH_ASSIGNMENT_LEAD_TIME_MINUTES', label: 'Dispatch Assignment Lead Time', type: 'integer', unit: 'minutes' },
  { key: 'LOYALTY_POINTS_PER_EGP', label: 'Loyalty Points per EGP', type: 'integer', unit: 'points' },
  { key: 'LOYALTY_WALLET_CONVERSION_POINTS_PER_EGP', label: 'Loyalty→Wallet Conversion Rate', type: 'integer', unit: 'points per EGP' },
  { key: 'CHECKOUT_QUOTE_TTL_SECONDS', label: 'Checkout Quote TTL', type: 'integer', unit: 'seconds' },
  { key: 'ETA_RANGE_BUFFER_MINUTES', label: 'ETA Range Buffer', type: 'integer', unit: 'minutes' },
  { key: 'CUSTOMER_SERVICE_WHATSAPP_NUMBER', label: 'Customer Service WhatsApp Number', type: 'string' },
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
      if (!edited.current) setValue(raw === null || raw === undefined ? '' : String(raw));
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
            className="rounded border px-2 py-1 text-sm"
          >
            <option value="true">ON</option>
            <option value="false">OFF</option>
          </select>
        ) : field.type === 'enum' && field.options ? (
          <select
            value={value}
            onChange={(e) => { edited.current = true; setValue(e.target.value); setSaved(false); }}
            className="rounded border px-2 py-1 text-sm"
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
            inputMode={field.type === 'decimal' ? 'decimal' : undefined}
            data-testid={`config-input-${field.key}`}
            value={value}
            onChange={(e) => { edited.current = true; setValue(e.target.value); setSaved(false); }}
            className="w-40 rounded border px-2 py-1 text-sm"
          />
        )}
        {field.unit && <span className="text-xs text-gray-400">{field.unit}</span>}
        <button
          onClick={handleSave}
          disabled={isSaving || !loaded}
          className="rounded bg-hatly-orange px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
        {saved && <span className="text-xs text-green-700">Saved</span>}
        {error && <span className="text-xs text-red-600">{error}</span>}
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
      <input value={label} onChange={(e) => { setLabel(e.target.value); setSaved(false); }} placeholder="Label (e.g. InstaPay)" className="w-full rounded border px-2 py-1.5 text-sm" />
      <input value={phoneOrAccountNumber} onChange={(e) => { setPhoneOrAccountNumber(e.target.value); setSaved(false); }} placeholder="Phone or account number" className="w-full rounded border px-2 py-1.5 text-sm" />
      <input value={accountName} onChange={(e) => { setAccountName(e.target.value); setSaved(false); }} placeholder="Account name (optional)" className="w-full rounded border px-2 py-1.5 text-sm" />
      {error && <p className="text-sm text-red-600">{error}</p>}
      {saved && <p className="text-sm text-green-700">Saved.</p>}
      <button type="submit" disabled={isSaving} className="rounded bg-hatly-orange px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
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
        'Switch Customer authentication to Password mode? Customers will use Phone + Password instead of OTP until this is turned back on.',
      );
      if (!confirmed) return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await setBusinessConfigValue(CUSTOMER_OTP_ENABLED_KEY, next, 'Controls whether Customers authenticate via OTP or Password.');
      setOtpEnabled(next);
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to update setting.'));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-xl font-semibold">Settings</h1>

      <div className="mt-6 rounded border bg-white p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">Customer Authentication — OTP</p>
            {otpEnabled === true && <p className="mt-1 text-sm text-gray-500">ON: Customers authenticate with OTP.</p>}
            {otpEnabled === false && (
              <p className="mt-1 text-sm text-gray-500">OFF: Customers authenticate with Password instead of OTP.</p>
            )}
          </div>
          {otpEnabled !== null && (
            <button
              onClick={handleToggle}
              disabled={isSaving}
              className={`rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
                otpEnabled ? 'bg-hatly-orange' : 'bg-gray-500'
              }`}
            >
              {isSaving ? 'Saving...' : otpEnabled ? 'ON' : 'OFF'}
            </button>
          )}
        </div>
        {error && (
          <div className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}{' '}
            <button onClick={load} className="underline">
              Retry
            </button>
          </div>
        )}
        {otpEnabled === null && !error && <p className="mt-3 text-sm text-gray-500">Loading...</p>}
      </div>

      <div className="mt-6 rounded border bg-white p-4">
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

      <div className="mt-6 rounded border bg-white p-4">
        <h2 className="font-semibold">Manual Transfer Destination</h2>
        <p className="mt-1 text-xs text-gray-500">Until set, Manual Transfer payments fail closed.</p>
        <div className="mt-2">
          <ManualTransferDestinationForm />
        </div>
      </div>
    </div>
  );
}
