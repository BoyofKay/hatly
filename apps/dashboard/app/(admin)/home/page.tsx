'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { startPageFor } from '../../../lib/ui/start-page';
import { NAV } from '../../../components/shell/nav';
import { AdminOverview } from '../../../components/dashboard/AdminOverview';
import { OperationsBoard } from '../../../components/operations/OperationsBoard';
import { PushSetupPrompt } from '../../../components/alerts/PushSetupPrompt';
import { PageHeader } from '../../../components/ui';
import { useLang } from '../../../lib/ui/lang';
import { usePermissions } from '../../../lib/ui/permissions';

const MODE_KEY = 'hatly_home_mode';

/**
 * The Admin Home ("الرئيسية") — where every admin lands after signing in. Operations staff (orders + fulfilment or dispatch) land on the
 * Operations board: what needs doing now, with the next step on each row. Everyone keeps the analytics overview one tap away; the choice
 * is remembered in this browser only.
 */
export default function AdminHomePage() {
  const { t } = useLang();
  const { can, loaded, role } = usePermissions();
  const router = useRouter();
  const start = loaded ? startPageFor({ role, can }, NAV) : null;
  const ops = start === 'ops';
  const elsewhere = start !== null && start.startsWith('/');
  useEffect(() => { if (elsewhere) router.replace(start!); }, [elsewhere, start, router]);
  const [mode, setMode] = useState<'ops' | 'overview' | null>(null);
  useEffect(() => {
    try { const m = localStorage.getItem(MODE_KEY); if (m === 'ops' || m === 'overview') setMode(m); } catch { /* per-browser convenience only */ }
  }, []);
  const choose = (m: 'ops' | 'overview') => { setMode(m); try { localStorage.setItem(MODE_KEY, m); } catch { /* ignore */ } };
  if (!loaded || elsewhere) return <div data-testid="home-page" />;
  const effective = ops ? mode ?? 'ops' : 'overview';

  return (
    <div data-testid="home-page">
      {ops && (
        <div role="tablist" aria-label={t('Home view', 'عرض الرئيسية')} className="mb-4 inline-flex rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
          {(['ops', 'overview'] as const).map((m) => (
            <button key={m} role="tab" aria-selected={effective === m} onClick={() => choose(m)} data-testid={`home-mode-${m}`}
              className={`min-h-[40px] rounded-lg px-4 text-sm font-semibold ${effective === m ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'}`}>
              {m === 'ops' ? t('Operations', 'التشغيل') : t('Overview', 'نظرة عامة')}
            </button>
          ))}
        </div>
      )}
      {effective === 'ops' ? (
        <div className="space-y-4">
          <PageHeader title={t('Operations board', 'لوحة التشغيل')} subtitle={t('What needs doing now, most urgent first. The next step is on each order.', 'ما يحتاج إجراء الآن، الأهم أولًا. الخطوة التالية على كل طلب.')} />
          <PushSetupPrompt />
          <OperationsBoard />
        </div>
      ) : (
        <AdminOverview />
      )}
    </div>
  );
}
