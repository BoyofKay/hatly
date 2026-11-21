'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../../lib/api/client';
import { useLang } from '../../lib/ui/lang';
import { Badge, Button } from '../ui';

interface Check { key: string; ok: boolean; level: 'BLOCKER' | 'WARNING'; en: string; ar: string; fix: string }
interface Readiness { ready: boolean; blockers: number; warnings: number; checks: Check[] }

/** The branch's go-live checklist (backend `GET admin/vendor-branches/:id/readiness`). `refreshKey` re-reads it after a change on the page. */
export function BranchReadinessCard({ branchId, vendorId, refreshKey }: { branchId: string; vendorId?: string; refreshKey?: unknown }) {
  const { t } = useLang();
  const [data, setData] = useState<Readiness | null>(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(async () => {
    try {
      setData((await apiClient.get(`/admin/vendor-branches/${branchId}/readiness`)).data.data);
    } catch {
      setData(null);
    }
  }, [branchId]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  if (!data) return null;

  const fixLink = (c: Check) => {
    if (c.fix === 'vendor' && vendorId) return { href: `/vendors/${vendorId}`, label: t('Open store', 'فتح المتجر') };
    if (c.fix === 'vendor-staff') return { href: '/vendor-staff', label: t('Store staff', 'موظفو المتاجر') };
    if (c.fix === 'delivery-zones') return { href: '/delivery-zones', label: t('Delivery zones', 'مناطق التوصيل') };
    return { href: `#${c.fix}`, label: t('Fix below', 'أصلح بالأسفل') };
  };
  const shown = open ? data.checks : data.checks.filter((c) => !c.ok);

  return (
    <section data-testid="branch-readiness" className={`mb-4 rounded-2xl border p-4 shadow-sm ${data.ready ? 'border-green-200 bg-green-50/60' : 'border-amber-200 bg-amber-50/70'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold text-gray-900">{t('Go-live checklist', 'قائمة الجاهزية للتشغيل')}</h2>
          {data.ready ? <Badge tone="green">{t('Ready for customers', 'جاهز للعملاء')}</Badge> : <Badge tone="orange">{t(`${data.blockers} must be fixed`, `${data.blockers} يجب إصلاحها`)}</Badge>}
          {data.warnings > 0 && <Badge tone="gray">{t(`${data.warnings} recommended`, `${data.warnings} موصى بها`)}</Badge>}
        </div>
        <span className="flex gap-2">
          <Button size="sm" onClick={() => void load()}>{t('Re-check', 'إعادة الفحص')}</Button>
          <Button size="sm" onClick={() => setOpen((v) => !v)}>{open ? t('Only open items', 'غير المكتمل فقط') : t('Show all checks', 'كل البنود')}</Button>
        </span>
      </div>
      {shown.length === 0 ? (
        <p className="mt-2 text-sm text-green-800">{t('Everything is in place.', 'كل شيء مكتمل.')}</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {shown.map((c) => {
            const link = fixLink(c);
            return (
              <li key={c.key} className="flex items-start gap-2 text-sm">
                <span aria-hidden className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${c.ok ? 'bg-green-600' : c.level === 'BLOCKER' ? 'bg-red-600' : 'bg-amber-500'}`}>{c.ok ? '✓' : c.level === 'BLOCKER' ? '!' : '•'}</span>
                <span className="min-w-0 flex-1 text-gray-800">{t(c.en, c.ar)}</span>
                {!c.ok && (link.href.startsWith('#') ? <a href={link.href} className="shrink-0 text-xs font-medium text-hatly-orangeDark underline">{link.label}</a> : <Link href={link.href} className="shrink-0 text-xs font-medium text-hatly-orangeDark underline">{link.label}</Link>)}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
