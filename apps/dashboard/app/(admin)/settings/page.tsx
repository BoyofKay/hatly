'use client';

import { useEffect, useState } from 'react';
import { getBusinessConfigValue, setBusinessConfigValue } from '../../../lib/api/admin-business-config';

const CUSTOMER_OTP_ENABLED_KEY = 'CUSTOMER_OTP_ENABLED';

/**
 * Customer Authentication Modes (master implementation). The single
 * minimum Dashboard control required — reuses the existing generic
 * GET/PUT admin/business-config/:key endpoints and MANAGE_BUSINESS_CONFIG
 * permission (enforced server-side; a 403 here shows as a plain error,
 * never bypassed). Not a general settings-management UI — just this
 * one toggle, per the approved design's explicit "minimum" scope.
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
      setError(err?.response?.data?.message ?? 'Failed to load setting.');
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
      setError(err?.response?.data?.message ?? 'Failed to update setting.');
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
    </div>
  );
}
