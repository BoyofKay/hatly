'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '../../lib/auth/session';
import { LangProvider } from '../../lib/ui/lang';
import { PermissionProvider } from '../../lib/ui/permissions';
import { ToastProvider } from '../../components/ui';
import { AdminShell } from '../../components/shell/AdminShell';

/**
 * Admin route group — client-side guard redirects to /login if no session exists or the session isn't Admin/Super Admin. This is a UX
 * convenience only, never the real authorization boundary — every `admin/*` backend endpoint independently enforces its own
 * permission check regardless of what this guard does. The shell (sidebar, top bar, search, language) is shared by every page.
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
    <LangProvider>
      <PermissionProvider>
        <ToastProvider>
          <AdminShell>{children}</AdminShell>
        </ToastProvider>
      </PermissionProvider>
    </LangProvider>
  );
}
