'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiClient } from '../../lib/api/client';
import { useLang } from '../../lib/ui/lang';

/**
 * Owner decision 2026-11-23: a yellow notice on every admin page while "Forgot password?" requests wait that THIS person may answer
 * (someone below them in level / within their permissions). Checked every minute; silent for staff without any reset permission.
 */
export function PasswordRequestsBanner() {
  const { t } = useLang();
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  useEffect(() => {
    let stopped = false;
    let denied = false;
    const load = async () => {
      if (denied) return;
      try {
        const res = await apiClient.get('/admin/password-reset-requests', { params: { actionable: 'true' }, _skipAuthRetry: false } as never);
        if (!stopped) setCount((res.data.data as unknown[]).length);
      } catch (e: any) {
        if (e?.response?.status === 403) denied = true;
      }
    };
    void load();
    const id = setInterval(() => void load(), 60_000);
    return () => { stopped = true; clearInterval(id); };
  }, [pathname]);

  if (count === 0 || pathname === '/password-requests') return null;
  return (
    <div role="status" className="border-b border-amber-200 bg-amber-100 px-4 py-2 text-sm text-amber-900 sm:px-6 lg:px-8" data-testid="password-requests-banner">
      <Link href="/password-requests" className="font-semibold hover:underline">
        {t(`${count} password reset request(s) waiting — answer them →`, `${count} طلب إعادة تعيين كلمة مرور بانتظارك — أجب عليها ←`)}
      </Link>
    </div>
  );
}
