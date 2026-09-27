'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser, logout } from '../../lib/auth/session';

/**
 * Admin route group — client-side guard redirects to /login if no
 * session exists or the session isn't Admin/Super Admin. This is a UX
 * convenience only, never the real authorization boundary — every
 * `admin/*` backend endpoint independently enforces its own
 * permission check regardless of what this guard does.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const user = getCurrentUser();
    if (!user || (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN')) {
      router.replace('/login');
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) return null;

  return (
    <div data-role-scope="admin" className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-6 py-3">
        <nav className="flex items-center gap-6">
          <a href="/vendors" className="font-semibold text-hatly-orange">
            Hatly Admin
          </a>
          <a href="/vendors" className="text-sm text-gray-600 hover:text-hatly-orange">
            Vendors
          </a>
          <a href="/vendor-staff" className="text-sm text-gray-600 hover:text-hatly-orange">
            Vendor Staff
          </a>
          <a href="/dispatch" className="text-sm text-gray-600 hover:text-hatly-orange">
            Dispatch
          </a>
          <a href="/service-areas" className="text-sm text-gray-600 hover:text-hatly-orange">
            Service Areas
          </a>
          <a href="/manual-transfer" className="text-sm text-gray-600 hover:text-hatly-orange">
            Manual Transfer
          </a>
          <a href="/failed-deliveries" className="text-sm text-gray-600 hover:text-hatly-orange">
            Failed Deliveries
          </a>
          <a href="/settings" className="text-sm text-gray-600 hover:text-hatly-orange">
            Settings
          </a>
          <a href="/offers" className="text-sm text-gray-600 hover:text-hatly-orange">
            Offers
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
