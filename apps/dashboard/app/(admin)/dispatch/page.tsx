'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLang } from '../../../lib/ui/lang';

/**
 * Dispatch now lives in the Control Tower (assign / reassign on each delivery row, dispatch alerts, the dispatcher's driver
 * picker). This route forwards there so existing links and bookmarks keep working, instead of keeping a second, divergent
 * dispatch UI (the old one decided assign-vs-reassign from a stale list, showed internal ids, and could not load at all for a
 * dispatcher without MANAGE_DRIVERS).
 */
export default function DispatchRedirectPage() {
  const router = useRouter();
  const { t } = useLang();
  useEffect(() => {
    router.replace('/control-tower');
  }, [router]);
  return (
    <p className="text-sm text-gray-500">
      {t('Dispatch has moved to the', 'تم نقل إدارة التوزيع إلى')} <Link href="/control-tower" className="underline">{t('Control Tower', 'مركز التحكم')}</Link>.
    </p>
  );
}
