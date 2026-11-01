'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser, logout } from '../../lib/auth/session';
import { VendorOrdersFeedProvider } from '../../lib/vendor/orders-feed';
import { LangProvider } from '../../lib/ui/lang';
import { ToastProvider } from '../../components/ui';
import { VendorShell } from '../../components/shell/VendorShell';

/**
 * Vendor route group — reuses the EXACT session/auth infrastructure (`getCurrentUser`/`logout`), not a second login implementation. The guard is
 * a UX convenience only — every `vendor/*` backend endpoint independently enforces VENDOR/VENDOR_MANAGER + branch ownership regardless of this
 * check. ADMIN/SUPER_ADMIN sessions are explicitly NOT treated as vendor staff here. The Vendor area is Arabic-first (right-to-left) until the
 * person chooses English.
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
    <LangProvider defaultLocale="ar">
      <ToastProvider>
        <VendorOrdersFeedProvider>
          <VendorShell onSignOut={() => logout().finally(() => router.replace('/login'))}>{children}</VendorShell>
        </VendorOrdersFeedProvider>
      </ToastProvider>
    </LangProvider>
  );
}
