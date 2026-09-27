'use client';

import { useEffect, useState } from 'react';
import { AdminDriver, createDriver, listDrivers } from '../../../lib/api/admin-dispatch';

/**
 * Real Admin Driver provisioning — consumes the real backend
 * `GET/POST admin/drivers` exactly (list added in Chunk 6, create
 * existing since Chunk 5). CONFIRMED (locked decisions): phone +
 * password only, no OTP field anywhere; no acceptance-configuration
 * field, since none exists on the backend DTO.
 */
export default function AdminDriversPage() {
  const [drivers, setDrivers] = useState<AdminDriver[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      setDrivers(await listDrivers());
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Failed to load drivers.');
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setCreateError(null);
    setSuccessMessage(null);
    try {
      const driver = await createDriver({ fullName, phone, password });
      setFullName('');
      setPhone('');
      // Password is never kept in state beyond this submission.
      setPassword('');
      setSuccessMessage(`Driver "${driver.fullName}" created.`);
      await refresh();
    } catch (err: any) {
      setCreateError(err?.response?.data?.message ?? 'Failed to create driver.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-xl font-semibold">Drivers</h1>

      <div className="mt-4 rounded border bg-white p-4">
        <h2 className="font-semibold">Create Driver</h2>
        <form onSubmit={handleCreate} className="mt-3 space-y-3">
          <div>
            <label className="block text-sm font-medium">Full name</label>
            <input
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mt-1 w-full rounded border px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Phone number</label>
            <input
              required
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+20..."
              className="mt-1 w-full rounded border px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Password</label>
            <input
              required
              type="password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded border px-3 py-2"
            />
            <p className="mt-1 text-xs text-gray-500">
              At least 8 characters. The driver uses this with their phone number to log into the Driver app — no OTP.
            </p>
          </div>
          {createError && <p className="text-sm text-red-600">{createError}</p>}
          {successMessage && <p className="text-sm text-green-700">{successMessage}</p>}
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded bg-hatly-orange px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isSubmitting ? 'Creating...' : 'Create Driver'}
          </button>
        </form>
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">All Drivers</h2>
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
        {!error && drivers === null && <p className="mt-2 text-gray-500">Loading...</p>}
        {!error && drivers !== null && drivers.length === 0 && (
          <p className="mt-2 text-gray-500">No drivers yet. Create one above.</p>
        )}
        {!error && drivers !== null && drivers.length > 0 && (
          <ul className="mt-2 divide-y rounded border bg-white">
            {drivers.map((d) => (
              <li key={d.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="font-medium">{d.fullName}</p>
                  <p className="text-xs text-gray-500">{d.phone}</p>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className={`rounded px-2 py-0.5 ${d.isOnline ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
                    {d.isOnline ? 'Online' : 'Offline'}
                  </span>
                  <span className={`rounded px-2 py-0.5 ${d.isAvailable ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-600'}`}>
                    {d.isAvailable ? 'Available' : 'Unavailable'}
                  </span>
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-gray-600">{d.verificationStatus}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
