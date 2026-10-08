'use client';

import { useEffect, useState } from 'react';
import {
  AdminUser,
  grantPermission,
  listAdminUsers,
  listPermissionCatalog,
  revokePermission,
} from '../../../lib/api/admin-users';
import { apiErrorMessage } from '../../../lib/api/errors';

/**
 * M3b (Launch-Readiness Gap Audit, G-08) — replaces the earlier
 * placeholder stub. Reuses the EXISTING grant/revoke endpoints
 * (`AdminPermissionsController`, already built and unchanged) and the
 * new, read-only `GET admin/users` / `GET admin/permissions` listing
 * endpoints. Server-side authorization (SUPER_ADMIN-only, via
 * `RolesGuard`) remains the real boundary — a non-SUPER_ADMIN who
 * somehow reaches this page gets a plain 403 from every call here,
 * never a client-side redirect pretending to be the security check.
 * No customer management of any kind — this page only ever lists
 * ADMIN/SUPER_ADMIN-tier users (what `GET admin/users` itself returns).
 */
export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [catalog, setCatalog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [selectedPermissionByUser, setSelectedPermissionByUser] = useState<Record<string, string>>({});
  const [mutatingKey, setMutatingKey] = useState<string | null>(null);
  const [rowErrorByUser, setRowErrorByUser] = useState<Record<string, string>>({});

  async function refresh() {
    setError(null);
    try {
      const [userList, permissionList] = await Promise.all([listAdminUsers(), listPermissionCatalog()]);
      setUsers(userList);
      setCatalog(permissionList);
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to load admin users.'));
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleGrant(user: AdminUser) {
    const permission = selectedPermissionByUser[user.id];
    if (!permission || mutatingKey) return;
    const key = `${user.id}:grant`;
    if (!window.confirm(`Grant "${permission}" to ${user.fullName}? This changes what they can do immediately.`)) return;

    setMutatingKey(key);
    setRowErrorByUser((prev) => ({ ...prev, [user.id]: '' }));
    try {
      await grantPermission(user.id, permission);
      await refresh();
    } catch (err: any) {
      setRowErrorByUser((prev) => ({ ...prev, [user.id]: apiErrorMessage(err, 'Failed to grant permission.' )}));
    } finally {
      setMutatingKey(null);
    }
  }

  async function handleRevoke(user: AdminUser, permission: string) {
    if (mutatingKey) return;
    const key = `${user.id}:revoke:${permission}`;
    if (!window.confirm(`Revoke "${permission}" from ${user.fullName}? They will lose this access immediately.`)) return;

    setMutatingKey(key);
    setRowErrorByUser((prev) => ({ ...prev, [user.id]: '' }));
    try {
      await revokePermission(user.id, permission);
      await refresh();
    } catch (err: any) {
      setRowErrorByUser((prev) => ({ ...prev, [user.id]: apiErrorMessage(err, 'Failed to revoke permission.' )}));
    } finally {
      setMutatingKey(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Admin Users &amp; Permissions</h1>
        <button onClick={refresh} className="text-sm text-gray-500 underline">
          Refresh
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}{' '}
          <button onClick={refresh} className="underline">
            Retry
          </button>
        </div>
      )}

      {!error && users === null && <p className="mt-4 text-gray-500">Loading...</p>}
      {!error && users !== null && users.length === 0 && <p className="mt-4 text-gray-500">No admin users found.</p>}

      <div className="mt-4 space-y-4">
        {users?.map((user) => (
          <div key={user.id} className="rounded border bg-white p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{user.fullName}</p>
                <p className="text-xs text-gray-500">{user.phone}</p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className={`rounded px-2 py-0.5 ${user.role === 'SUPER_ADMIN' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                  {user.role}
                </span>
                <span className={`rounded px-2 py-0.5 ${user.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
                  {user.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>

            {user.role === 'SUPER_ADMIN' ? (
              <p className="mt-3 text-sm text-gray-500">
                SUPER_ADMIN has every capability by role — permissions are not granted/revoked individually.
              </p>
            ) : (
              <>
                <div className="mt-3">
                  <p className="text-xs font-medium text-gray-500">Granted permissions</p>
                  {user.permissions.length === 0 ? (
                    <p className="mt-1 text-sm text-gray-500">None yet.</p>
                  ) : (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {user.permissions.map((permission) => (
                        <span key={permission} className="flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                          {permission}
                          <button
                            onClick={() => handleRevoke(user, permission)}
                            disabled={mutatingKey === `${user.id}:revoke:${permission}`}
                            className="text-gray-400 hover:text-red-600 disabled:opacity-50"
                            aria-label={`Revoke ${permission}`}
                            title={`Revoke ${permission}`}
                          >
                            &times;
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-3 flex gap-2">
                  <select
                    value={selectedPermissionByUser[user.id] ?? ''}
                    onChange={(e) => setSelectedPermissionByUser((prev) => ({ ...prev, [user.id]: e.target.value }))}
                    className="flex-1 rounded border px-2 py-1.5 text-sm"
                  >
                    <option value="">Grant a permission...</option>
                    {catalog
                      .filter((p) => !user.permissions.includes(p))
                      .map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                  </select>
                  <button
                    onClick={() => handleGrant(user)}
                    disabled={!selectedPermissionByUser[user.id] || mutatingKey === `${user.id}:grant`}
                    className="rounded bg-hatly-orange px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    Grant
                  </button>
                </div>
              </>
            )}
            {rowErrorByUser[user.id] && <p className="mt-2 text-sm text-red-600">{rowErrorByUser[user.id]}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
