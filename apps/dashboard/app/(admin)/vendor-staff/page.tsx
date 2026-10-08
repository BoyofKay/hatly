'use client';

import { useEffect, useState } from 'react';
import { VendorStaffMember, activateVendorStaff, createVendorStaff, deactivateVendorStaff, listVendorStaff } from '../../../lib/api/admin-vendor-staff';
import { Vendor, VendorBranch, listVendorBranches, listVendors } from '../../../lib/api/admin-vendors';
import { apiErrorMessage } from '../../../lib/api/errors';

/**
 * Real Admin Vendor Staff management — consumes the Chunk 10 backend
 * (`GET/POST admin/vendor-staff`) exactly, reusing `MANAGE_VENDOR_STAFF`
 * (enforced server-side; a 403 here is shown as a plain error, never
 * bypassed). No password reset, invitations, deletion, or new
 * permission — out of scope, per the locked chunk boundary.
 */
export default function VendorStaffPage() {
  const [staff, setStaff] = useState<VendorStaffMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [branches, setBranches] = useState<VendorBranch[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'VENDOR' | 'VENDOR_MANAGER'>('VENDOR');
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [toggleErrorById, setToggleErrorById] = useState<Record<string, string>>({});
  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      const [staffList, vendorList] = await Promise.all([listVendorStaff(), listVendors()]);
      setStaff(staffList);
      setVendors(vendorList);
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to load vendor staff.'));
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!selectedVendorId) {
      setBranches([]);
      setSelectedBranchId('');
      return;
    }
    listVendorBranches(selectedVendorId)
      .then(setBranches)
      .catch(() => setBranches([]));
  }, [selectedVendorId]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (isSubmitting) return;
    if (!selectedBranchId) {
      setCreateError('Select a vendor branch.');
      return;
    }
    setIsSubmitting(true);
    setCreateError(null);
    setSuccessMessage(null);
    try {
      const created = await createVendorStaff({
        phone,
        fullName,
        password,
        vendorBranchId: selectedBranchId,
        role,
      });
      setFullName('');
      setPhone('');
      // Password is never kept in state beyond this submission.
      setPassword('');
      setSuccessMessage(`Staff account "${created.fullName}" created.`);
      await refresh();
    } catch (err: any) {
      setCreateError(apiErrorMessage(err, 'Failed to create staff account.'));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleToggleActive(member: VendorStaffMember) {
    setTogglingId(member.id);
    setToggleErrorById((prev) => ({ ...prev, [member.id]: '' }));
    try {
      member.isActive ? await deactivateVendorStaff(member.id) : await activateVendorStaff(member.id);
      await refresh();
    } catch (err: any) {
      setToggleErrorById((prev) => ({
        ...prev,
        [member.id]: apiErrorMessage(err, 'Failed to update status.'),
      }));
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Vendor Staff</h1>
        <button
          onClick={() => setShowCreateForm((v) => !v)}
          className="rounded bg-hatly-orange px-4 py-2 text-sm font-medium text-white"
        >
          {showCreateForm ? 'Cancel' : 'New Staff Account'}
        </button>
      </div>

      {showCreateForm && (
        <form onSubmit={handleCreate} className="mt-4 space-y-3 rounded border bg-white p-4">
          <div>
            <label className="block text-sm font-medium">Full name</label>
            <input required value={fullName} onChange={(e) => setFullName(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium">Phone number</label>
            <input required type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+20..." className="mt-1 w-full rounded border px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium">Password</label>
            <input required type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" />
            <p className="mt-1 text-xs text-gray-500">At least 8 characters. Used with the phone number to log into the Dashboard — no OTP for staff accounts.</p>
          </div>
          <div>
            <label className="block text-sm font-medium">Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value as 'VENDOR' | 'VENDOR_MANAGER')} className="mt-1 w-full rounded border px-3 py-2">
              <option value="VENDOR">Vendor</option>
              <option value="VENDOR_MANAGER">Vendor Manager</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium">Vendor</label>
              <select required value={selectedVendorId} onChange={(e) => setSelectedVendorId(e.target.value)} className="mt-1 w-full rounded border px-3 py-2">
                <option value="">Select a vendor...</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium">Branch</label>
              <select
                required
                value={selectedBranchId}
                onChange={(e) => setSelectedBranchId(e.target.value)}
                disabled={!selectedVendorId}
                className="mt-1 w-full rounded border px-3 py-2 disabled:bg-gray-100"
              >
                <option value="">Select a branch...</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {createError && <p className="text-sm text-red-600">{createError}</p>}
          {successMessage && <p className="text-sm text-green-700">{successMessage}</p>}
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded bg-hatly-orange px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isSubmitting ? 'Creating...' : 'Create Staff Account'}
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
        {!error && staff === null && <p className="text-gray-500">Loading...</p>}
        {!error && staff !== null && staff.length === 0 && <p className="text-gray-500">No vendor staff yet.</p>}
        {!error && staff !== null && staff.length > 0 && (
          <ul className="mt-2 divide-y rounded border bg-white">
            {staff.map((s) => (
              <li key={s.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="font-medium">{s.fullName}</p>
                  <p className="text-xs text-gray-500">
                    {s.phone} &middot; {s.vendorName} / {s.vendorBranchName}
                  </p>
                  {toggleErrorById[s.id] && <p className="mt-1 text-xs text-red-600">{toggleErrorById[s.id]}</p>}
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-gray-600">{s.role}</span>
                  <span className={`rounded px-2 py-0.5 ${s.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
                    {s.isActive ? 'Active' : 'Inactive'}
                  </span>
                  <button
                    onClick={() => handleToggleActive(s)}
                    disabled={togglingId === s.id}
                    className="text-gray-500 underline disabled:opacity-50"
                  >
                    {s.isActive ? 'Deactivate' : 'Activate'}
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
