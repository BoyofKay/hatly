'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Vendor, createVendor, listVendors } from '../../../lib/api/admin-vendors';
import { apiErrorMessage } from '../../../lib/api/errors';

/**
 * Real Vendor management — consumes `GET/POST admin/vendors` (Chunk
 * 1). Only `name`/`nameAr`/`logoUrl` are collected — `category`/
 * `commissionPercent` are excluded, per the closed decision. A newly
 * created Vendor is NEVER auto-activated here; the backend itself
 * already starts it inactive.
 */
export default function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [name, setName] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      const data = await listVendors();
      setVendors(data);
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to load vendors.'));
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
    try {
      await createVendor({
        name,
        nameAr: nameAr || undefined,
        logoUrl: logoUrl || undefined,
      });
      setName('');
      setNameAr('');
      setLogoUrl('');
      setShowCreateForm(false);
      await refresh();
    } catch (err: any) {
      setCreateError(apiErrorMessage(err, 'Failed to create vendor.'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Vendors</h1>
        <button
          onClick={() => setShowCreateForm((v) => !v)}
          className="rounded bg-hatly-orange px-4 py-2 text-sm font-medium text-white"
        >
          {showCreateForm ? 'Cancel' : 'New Vendor'}
        </button>
      </div>

      {showCreateForm && (
        <form onSubmit={handleCreate} className="mt-4 space-y-3 rounded border bg-white p-4">
          <div>
            <label className="block text-sm font-medium">Name</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded border px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Name (Arabic)</label>
            <input
              value={nameAr}
              onChange={(e) => setNameAr(e.target.value)}
              className="mt-1 w-full rounded border px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Logo URL</label>
            <input
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              className="mt-1 w-full rounded border px-3 py-2"
            />
          </div>
          {createError && <p className="text-sm text-red-600">{createError}</p>}
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded bg-hatly-orange px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isSubmitting ? 'Creating...' : 'Create Vendor'}
          </button>
          <p className="text-xs text-gray-500">The new vendor starts inactive until you activate it.</p>
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
        {!error && vendors === null && <p className="text-gray-500">Loading...</p>}
        {!error && vendors !== null && vendors.length === 0 && (
          <p className="text-gray-500">No vendors yet. Create one to get started.</p>
        )}
        {!error && vendors !== null && vendors.length > 0 && (
          <ul className="divide-y rounded border bg-white">
            {vendors.map((v) => (
              <li key={v.id}>
                <Link href={`/vendors/${v.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
                  <span className="font-medium">{v.name}</span>
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${
                      v.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'
                    }`}
                  >
                    {v.isActive ? 'Active' : 'Inactive'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
