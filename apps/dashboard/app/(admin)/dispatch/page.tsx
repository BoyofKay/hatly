'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

/**
 * Dispatch now lives in the Control Tower (assign / reassign on each delivery row, dispatch alerts, the dispatcher's driver
 * picker). This route forwards there so existing links and bookmarks keep working, instead of keeping a second, divergent
 * dispatch UI (the old one decided assign-vs-reassign from a stale list, showed internal ids, and could not load at all for a
 * dispatcher without MANAGE_DRIVERS).
 */
export default function DispatchRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/control-tower');
  }, [router]);
  return (
    <p className="text-sm text-gray-500">
      Dispatch has moved to the <Link href="/control-tower" className="underline">Control Tower</Link>.
    </p>
  );
}
