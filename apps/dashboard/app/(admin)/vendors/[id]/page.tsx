'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  Vendor,
  VendorBranch,
  activateVendor,
  createVendorBranch,
  deactivateVendor,
  getVendor,
  listVendorBranches,
  updateVendor,
} from '../../../../lib/api/admin-vendors';
import { apiErrorMessage } from '../../../../lib/api/errors';

/**
 * Real Vendor detail/edit/activate/deactivate + its Branches, and
 * Branch creation — consumes Chunk 1's `admin/vendors`/
 * `admin/vendor-branches` endpoints exactly. New Branches are never
 * auto-activated here either — the backend already starts them
 * inactive.
 */
export default function VendorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [branches, setBranches] = useState<VendorBranch[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [showBranchForm, setShowBranchForm] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [branchAddress, setBranchAddress] = useState('');
  const [branchLat, setBranchLat] = useState('');
  const [branchLng, setBranchLng] = useState('');
  const [branchCommission, setBranchCommission] = useState('');
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      const [v, b] = await Promise.all([getVendor(id), listVendorBranches(id)]);
      setVendor(v);
      setName(v.name);
      setNameAr(v.nameAr ?? '');
      setLogoUrl(v.logoUrl ?? '');
      setBranches(b);
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to load vendor.'));
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    setActionError(null);
    try {
      const updated = await updateVendor(id, { name, nameAr: nameAr || undefined, logoUrl: logoUrl || undefined });
      setVendor(updated);
    } catch (err: any) {
      setActionError(apiErrorMessage(err, 'Failed to save.'));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleToggleActive() {
    if (!vendor) return;
    setActionError(null);
    try {
      const updated = vendor.isActive ? await deactivateVendor(id) : await activateVendor(id);
      setVendor(updated);
    } catch (err: any) {
      setActionError(apiErrorMessage(err, 'Failed to update status.'));
    }
  }

  async function handleCreateBranch(e: React.FormEvent) {
    e.preventDefault();
    if (isCreatingBranch) return;
    const latitude = Number(branchLat);
    const longitude = Number(branchLng);
    if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
      setBranchError('Latitude/longitude must be valid numbers.');
      return;
    }
    setIsCreatingBranch(true);
    setBranchError(null);
    try {
      await createVendorBranch({
        vendorId: id,
        name: branchName,
        address: branchAddress,
        latitude,
        longitude,
        commissionRateBasisPoints: branchCommission ? Number(branchCommission) : undefined,
      });
      setBranchName('');
      setBranchAddress('');
      setBranchLat('');
      setBranchLng('');
      setBranchCommission('');
      setShowBranchForm(false);
      await refresh();
    } catch (err: any) {
      setBranchError(apiErrorMessage(err, 'Failed to create branch.'));
    } finally {
      setIsCreatingBranch(false);
    }
  }

  if (error) {
    return (
      <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error}{' '}
        <button onClick={refresh} className="underline">
          Retry
        </button>
      </div>
    );
  }
  if (!vendor) return <p className="text-gray-500">Loading...</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/vendors" className="text-sm text-gray-500">
        &larr; All vendors
      </Link>

      <div className="rounded border bg-white p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">{vendor.name}</h1>
          <button
            onClick={handleToggleActive}
            className={`rounded px-3 py-1 text-sm font-medium ${
              vendor.isActive ? 'bg-gray-200 text-gray-700' : 'bg-green-600 text-white'
            }`}
          >
            {vendor.isActive ? 'Deactivate' : 'Activate'}
          </button>
        </div>

        <form onSubmit={handleSave} className="mt-4 space-y-3">
          <div>
            <label className="block text-sm font-medium">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium">Name (Arabic)</label>
            <input value={nameAr} onChange={(e) => setNameAr(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium">Logo URL</label>
            <input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" />
          </div>
          {actionError && <p className="text-sm text-red-600">{actionError}</p>}
          <button
            type="submit"
            disabled={isSaving}
            className="rounded bg-hatly-orange px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </form>
      </div>

      <div className="rounded border bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Branches</h2>
          <button
            onClick={() => setShowBranchForm((v) => !v)}
            className="rounded bg-hatly-orange px-3 py-1.5 text-sm font-medium text-white"
          >
            {showBranchForm ? 'Cancel' : 'New Branch'}
          </button>
        </div>

        {showBranchForm && (
          <form onSubmit={handleCreateBranch} className="mt-4 space-y-3 rounded border p-3">
            <div>
              <label className="block text-sm font-medium">Branch name</label>
              <input
                required
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                className="mt-1 w-full rounded border px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Address</label>
              <input
                required
                value={branchAddress}
                onChange={(e) => setBranchAddress(e.target.value)}
                className="mt-1 w-full rounded border px-3 py-2"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium">Latitude</label>
                <input
                  required
                  value={branchLat}
                  onChange={(e) => setBranchLat(e.target.value)}
                  className="mt-1 w-full rounded border px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium">Longitude</label>
                <input
                  required
                  value={branchLng}
                  onChange={(e) => setBranchLng(e.target.value)}
                  className="mt-1 w-full rounded border px-3 py-2"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium">Commission rate (basis points)</label>
              <input
                value={branchCommission}
                onChange={(e) => setBranchCommission(e.target.value)}
                placeholder="e.g. 1500 = 15%"
                className="mt-1 w-full rounded border px-3 py-2"
              />
            </div>
            {branchError && <p className="text-sm text-red-600">{branchError}</p>}
            <button
              type="submit"
              disabled={isCreatingBranch}
              className="rounded bg-hatly-orange px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {isCreatingBranch ? 'Creating...' : 'Create Branch'}
            </button>
            <p className="text-xs text-gray-500">
              The new branch starts inactive. Delivery/pickup default to enabled; adjust after creation if needed. Assign
              a Marketplace Sector from the branch page.
            </p>
          </form>
        )}

        <div className="mt-4">
          {branches === null && <p className="text-gray-500">Loading branches...</p>}
          {branches !== null && branches.length === 0 && <p className="text-gray-500">No branches yet.</p>}
          {branches !== null && branches.length > 0 && (
            <ul className="divide-y rounded border">
              {branches.map((b) => (
                <li key={b.id}>
                  <Link href={`/branches/${b.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
                    <span>{b.name}</span>
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        b.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'
                      }`}
                    >
                      {b.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
