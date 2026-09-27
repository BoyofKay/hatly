'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser, logout } from '../../lib/auth/session';

/**
 * Vendor route group — reuses the EXACT session/auth infrastructure
 * from Chunk 3 (`getCurrentUser`/`logout`), not a second login
 * implementation. Guard is a UX convenience only — every
 * `vendor/orders*` backend endpoint independently enforces
 * VENDOR/VENDOR_MANAGER + branch-ownership regardless of this check.
 * CONFIRMED: ADMIN/SUPER_ADMIN sessions are explicitly NOT treated as
 * Vendor Staff here — only VENDOR/VENDOR_MANAGER may enter.
 */
export default function VendorLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const user = getCurrentUser();
    if (!user || (user.role !== 'VENDOR' && user.role !== 'VENDOR_MANAGER')) {
      router.replace('/login');
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) return null;

  return (
    <div data-role-scope="vendor" className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-6 py-3">
        <nav className="flex items-center gap-6">
          <a href="/orders" className="font-semibold text-hatly-orange">
            Hatly Vendor
          </a>
          <a href="/orders" className="text-sm text-gray-600 hover:text-hatly-orange">
            Orders
          </a>
          <a href="/products" className="text-sm text-gray-600 hover:text-hatly-orange">
            Products
          </a>
        </nav>
        <button
          onClick={() => {
            logout();
            router.replace('/login');
          }}
          className="text-sm text-gray-500"
        >
          Sign out
        </button>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
