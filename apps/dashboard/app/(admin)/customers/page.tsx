'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AdminCustomerListItem, searchAdminCustomers } from '../../../lib/api/admin-customers';
import { apiErrorMessage } from '../../../lib/api/errors';

/**
 * M3c (Launch-Readiness Gap Audit, G-10) — Admin Customer Management.
 * Mirrors Order Search's exact conventions (search box + one status
 * filter + pagination + table + loading/empty/error/retry) — reuses
 * the same patterns rather than inventing a new list-page shape.
 */
export default function CustomersPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | 'active' | 'inactive'>('');
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<AdminCustomerListItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(20);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function runSearch(targetPage = page) {
    setIsLoading(true);
    setError(null);
    try {
      const result = await searchAdminCustomers({
        page: targetPage,
        search: search || undefined,
        isActive: statusFilter === '' ? undefined : statusFilter === 'active',
      });
      setItems(result.data);
      setTotal(result.meta.total);
      setLimit(result.meta.limit);
      setPage(result.meta.page);
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to search customers.'));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    runSearch(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    runSearch(1);
  }

  const totalPages = Math.max(1, Math.ceil(total / (limit || 1)));

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-xl font-semibold">Customers</h1>

      <form onSubmit={handleSearchSubmit} className="mt-4 space-y-3 rounded border bg-white p-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Customer name, phone, or customer id"
          className="w-full rounded border px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap gap-2">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="rounded border px-2 py-1.5 text-sm">
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <button type="submit" disabled={isLoading} className="rounded bg-hatly-orange px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            {isLoading ? 'Searching...' : 'Search'}
          </button>
        </div>
      </form>

      {error && (
        <div className="mt-4 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}{' '}
          <button onClick={() => runSearch(page)} className="underline">
            Retry
          </button>
        </div>
      )}

      {!error && isLoading && items === null && <p className="mt-4 text-gray-500">Loading...</p>}
      {!error && items !== null && items.length === 0 && <p className="mt-4 text-gray-500">No customers match this search.</p>}

      {!error && items !== null && items.length > 0 && (
        <>
          <div className="mt-4 overflow-x-auto rounded border bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Phone</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Phone Verified</th>
                  <th className="px-4 py-2">Created</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {items.map((customer) => (
                  <tr key={customer.id} className="border-b last:border-0">
                    <td className="px-4 py-2">{customer.fullName}</td>
                    <td className="px-4 py-2">{customer.phone}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded px-2 py-0.5 text-xs ${customer.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
                        {customer.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-2">{customer.isPhoneVerified ? 'Yes' : 'No'}</td>
                    <td className="px-4 py-2">{new Date(customer.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-2 text-right">
                      <Link href={`/customers/${customer.id}`} className="text-hatly-orange underline">
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex items-center justify-between text-sm text-gray-600">
            <span>
              Page {page} of {totalPages} &middot; {total} customer{total === 1 ? '' : 's'}
            </span>
            <div className="flex gap-2">
              <button onClick={() => runSearch(page - 1)} disabled={isLoading || page <= 1} className="rounded border px-3 py-1 disabled:opacity-50">
                Previous
              </button>
              <button onClick={() => runSearch(page + 1)} disabled={isLoading || page >= totalPages} className="rounded border px-3 py-1 disabled:opacity-50">
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
