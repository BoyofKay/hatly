'use client';

import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { OperationsBadge, OperationsBanner } from '../operations/OperationsBanner';
import { useOperationsFacts } from '../../lib/use-operations-facts';
import { getCurrentUser, logout } from '../../lib/auth/session';
import { useLang } from '../../lib/ui/lang';
import { usePermissions } from '../../lib/ui/permissions';
import { getEnvelope } from '../../lib/ui/api';
import { Button, Spinner } from '../ui';
import { NAV, NavGroup, NavItem, locate } from './nav';
import { StaffAlertsBell } from './StaffAlertsBell';
import { adminHref } from '../../lib/notifications/wording';
import { fetchAdminChanges } from '../../lib/api/changes';
import { OpsAlarmBar, OpsAlarmProvider } from '../alerts/OpsAlarm';
import { forgetThisDevice } from '../../lib/alerts/push-client';
import { OpsShellContext } from './ops-shell-context';
import { ChangePasswordModal } from '../account/ChangePasswordModal';

const ICONS: Record<string, ReactNode> = {
  home: <><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></>,
  clipboard: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4h6v3H9zM8.5 12l2 2 4-4M8.5 17h7" /></>,
  layers: <><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></>,
  tag: <><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8.5" r="1.5" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  cart: <><circle cx="9" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" /><path d="M2 3h3l2.5 12h11L21 7H6" /></>,
  shop: <><path d="M3 9l1.5-5h15L21 9" /><path d="M4 9v11h16V9" /><path d="M9 20v-6h6v6" /></>,
  store: <><path d="M4 21V8l8-5 8 5v13" /><path d="M9 21v-7h6v7" /></>,
  box: <><path d="M3 7l9-4 9 4v10l-9 4-9-4z" /><path d="M3 7l9 4 9-4M12 11v10" /></>,
  truck: <><path d="M2 6h12v10H2zM14 10h4l3 3v3h-7" /><circle cx="7" cy="18" r="1.8" /><circle cx="17" cy="18" r="1.8" /></>,
  users: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6" /><circle cx="17" cy="9" r="2.4" /><path d="M16 14c3 0 5 2 5 5" /></>,
  coins: <><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" /><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>,
  card: <><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M2.5 10h19M6 15h4" /></>,
  megaphone: <><path d="M3 10v4h4l9 5V5L7 10z" /><path d="M19 9c1.3.8 2 2 2 3s-.7 2.2-2 3" /></>,
  chart: <><path d="M4 20V4M4 20h16" /><rect x="7" y="12" width="3" height="6" /><rect x="12" y="8" width="3" height="10" /><rect x="17" y="5" width="3" height="13" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M3 18l6-5 4 3 3-2 5 4" /></>,
  shield: <><path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z" /><path d="M9 12l2 2 4-4" /></>,
  pulse: <><path d="M3 12h4l2-6 4 12 2-6h6" /></>,
  cog: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" /></>,
};

function Icon({ name }: { name: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name] ?? ICONS.grid}
    </svg>
  );
}

function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLang();
  const { can, role } = usePermissions();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [groups, setGroups] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pages = useMemo(() => NAV.flatMap((g) => g.items.map((i) => ({ ...i, group: g }))).filter((i) => (i.superOnly ? role === 'SUPER_ADMIN' : can(...(i.perms ?? [])))), [can, role]);
  useEffect(() => { if (open) { setQ(''); setGroups([]); setErr(null); setTimeout(() => input.current?.focus(), 0); } }, [open]);
  useEffect(() => {
    if (!open || q.trim().length < 2) { setGroups([]); return; }
    let cancelled = false;
    setBusy(true);
    const id = setTimeout(() => {
      getEnvelope('/admin/search', { q: q.trim() })
        .then((r) => !cancelled && (setGroups(r.data.groups ?? []), setErr(null)))
        .catch((e) => !cancelled && setErr(e?.response?.status === 403 ? t('No search permission.', 'لا توجد صلاحية بحث.') : t('Search failed.', 'فشل البحث.')))
        .finally(() => !cancelled && setBusy(false));
    }, 300);
    return () => { cancelled = true; clearTimeout(id); };
  }, [q, open, t]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && open && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const go = (url: string) => { onClose(); router.push(url.replace(/^\/(?:order-search|orders)\/([0-9a-fA-F-]{36})$/, '/order-management?order=$1')); };
  const matches = q.trim().length >= 1 ? pages.filter((p) => `${p.en} ${p.ar}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6) : pages.slice(0, 6);
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/40 p-4 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={t('Search', 'بحث')} className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center gap-2 border-b border-gray-100 px-4">
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search orders, customers, vendors, products… or jump to a page', 'ابحث عن طلبات أو عملاء أو موردين أو منتجات… أو انتقل إلى صفحة')} className="w-full py-3 text-sm outline-none" aria-label={t('Search', 'بحث')} />
          {busy && <Spinner />}
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-2 text-sm">
          {err && <p role="alert" className="px-3 py-2 text-red-600">{err}</p>}
          {groups.map((g) => (
            <div key={g.type} className="mb-2">
              <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{g.type}</p>
              {g.items.map((it: any) => (
                <button key={it.id} onClick={() => go(it.url)} className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-start hover:bg-gray-50">
                  <span className="truncate font-medium text-gray-900"><bdi>{it.title}</bdi></span>
                  <span className="truncate text-xs text-gray-500"><bdi>{it.subtitle}</bdi></span>
                </button>
              ))}
            </div>
          ))}
          <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{t('Pages', 'الصفحات')}</p>
          {matches.map((p) => (
            <button key={p.href} onClick={() => go(p.href)} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-start hover:bg-gray-50">
              <span className="font-medium text-gray-900">{t(p.en, p.ar)}</span>
              <span className="text-xs text-gray-500">{t(p.group.en, p.group.ar)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The permission-aware sidebar + top bar every Admin page lives in. Navigation visibility is a UX filter; the backend enforces access. */
export function AdminShell({ children }: { children: ReactNode }) {
  const { t, locale, setLocale } = useLang();
  const [pwOpen, setPwOpen] = useState(false);
  const perms = usePermissions();
  const router = useRouter();
  const pathname = usePathname();
  const operations = useOperationsFacts();
  const [boardShown, setBoardShown] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => setMoreOpen(false), [pathname]);
  const shellCtx = useMemo(() => ({ facts: operations, setBoardShown }), [operations]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(false);
  const user = typeof window !== 'undefined' ? getCurrentUser() : null;

  useEffect(() => setOpen(false), [pathname]);
  // On a narrow screen the section's tabs scroll sideways; bring the current page's tab into view.
  useEffect(() => {
    document.querySelector('[data-testid="section-tabs"] [aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearch(true); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const isSuper = perms.role === 'SUPER_ADMIN';
  const visible = (i: NavItem) => (i.superOnly ? isSuper : perms.can(...(i.perms ?? [])));
  const groups: NavGroup[] = NAV.map((g) => ({ ...g, items: g.items.filter(visible) })).filter((g) => g.items.length > 0);
  const here = locate(pathname, groups);

  // The reference sidebar: the Hatly logo on an orange block, then one icon row per section; the section holding this page is filled orange.
  const sidebar = (
    <div className="flex h-full flex-col overflow-y-auto px-3 pb-4 pt-3">
      <Link href="/home" className="mb-5 flex items-center gap-2.5 rounded-2xl bg-hatly-orange px-3 py-2.5 text-lg font-bold text-white shadow-[0_6px_16px_-6px_rgba(255,122,26,0.6)]">
        <img src="/hatly-logo.jpg" alt="" aria-hidden width={34} height={34} className="h-[34px] w-[34px] rounded-xl object-cover ring-2 ring-white/70" />
        <span>Hatly</span>
      </Link>
      <nav aria-label={t('Main navigation', 'التنقل الرئيسي')}>
        {perms.failed && <div role="alert" className="mx-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800"><p>{t('Could not load your menu.', 'تعذّر تحميل القائمة.')}</p><button className="mt-1 font-medium underline" onClick={perms.reload}>{t('Retry', 'إعادة المحاولة')}</button></div>}
        {!perms.loaded && !perms.failed && <div className="space-y-2 px-2"><div className="h-8 animate-pulse rounded-xl bg-gray-100" /><div className="h-8 animate-pulse rounded-xl bg-gray-100" /><div className="h-8 animate-pulse rounded-xl bg-gray-100" /></div>}
        <ul className="space-y-1">
          {groups.map((g) => {
            const current = here.group?.id === g.id;
            return (
              <li key={g.id} className="relative">
                <Link href={g.items[0].href} data-testid={`nav-section-${g.id}`} aria-current={current ? 'page' : undefined}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${current ? 'bg-hatly-orange text-white shadow-[0_6px_14px_-6px_rgba(255,122,26,0.7)]' : 'text-gray-700 hover:bg-orange-50 hover:text-hatly-orangeDark'}`}>
                  <Icon name={g.icon} />
                  <span className="flex-1">{t(g.en, g.ar)}</span>
                </Link>
                {/* Outside the link, so the link's name stays the section's name; the badge announces itself. */}
                {g.id === 'orders' && <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2"><OperationsBadge facts={operations} /></span>}
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );

  // Work waiting behind a tab, shown on the tab itself so nobody has to open each page to find it (counts are the backend's own).
  const tabCounts: Record<string, number | undefined> = {
    '/operations': operations?.actionRequired,
    '/stores-now': operations?.pendingAcceptanceOverdue,
    '/manual-transfer': operations?.transfersToVerify,
    '/refunds': operations?.refundsToSend,
  };

  // The pages of the current section, as tabs above the page — only when the section has more than one page this admin may open.
  // Stage 5: pages marked `more` sit in a "More" menu at the end (the page you are on is always shown as a tab, wherever it lives).
  const tabLink = (i: NavItem) => {
    const current = here.item?.href === i.href;
    return (
      <li key={i.href}>
        <Link href={i.href} aria-current={current ? 'page' : undefined}
          className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium ${current ? 'border-hatly-orange text-hatly-orangeDark' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-800'}`}>
          {t(i.en, i.ar)}
          <TabCount n={tabCounts[i.href]} />
        </Link>
      </li>
    );
  };
  const mainTabs = here.group ? here.group.items.filter((i) => !i.more || here.item?.href === i.href) : [];
  const moreTabs = here.group ? here.group.items.filter((i) => i.more && here.item?.href !== i.href) : [];
  const tabs = here.group && here.group.items.length > 1 ? (
    <nav aria-label={t('Section pages', 'صفحات القسم')} data-testid="section-tabs" className="-mx-4 mb-5 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="flex items-end border-b border-gray-200">
        <ul className="flex min-w-0 flex-1 gap-1 overflow-x-auto">{mainTabs.map(tabLink)}</ul>
        {moreTabs.length > 0 && (
          <div className="relative shrink-0">
            <button type="button" aria-expanded={moreOpen} aria-haspopup="true" onClick={() => setMoreOpen((v) => !v)} data-testid="section-tabs-more"
              className="-mb-px flex items-center gap-1 whitespace-nowrap border-b-2 border-transparent px-3 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-800">
              {t('More', 'المزيد')}
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {moreOpen && (
              <ul className="absolute end-0 z-30 mt-1 w-56 rounded-xl border border-gray-200 bg-white p-1 shadow-lg" data-testid="section-tabs-more-menu">
                {moreTabs.map((i) => (
                  <li key={i.href}>
                    <Link href={i.href} onClick={() => setMoreOpen(false)} className="flex min-h-[40px] items-center gap-1.5 rounded-lg px-3 text-sm text-gray-700 hover:bg-gray-50">
                      {t(i.en, i.ar)}
                      <TabCount n={tabCounts[i.href]} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </nav>
  ) : null;

  return (
    <OpsAlarmProvider>
    <div data-role-scope="admin" className="flex min-h-screen bg-gray-50 text-gray-900">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-e border-gray-100 bg-white shadow-[1px_0_0_rgba(16,24,40,0.02)] lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="absolute inset-0 bg-black/40" aria-hidden />
          <aside className="relative h-full w-72 max-w-[85vw] bg-white shadow-xl">{sidebar}</aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-gray-100 bg-white/95 px-3 py-2.5 backdrop-blur sm:px-6">
          <button className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 lg:hidden" aria-label={t('Open menu', 'فتح القائمة')} onClick={() => setOpen(true)}>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <button onClick={() => setSearch(true)} aria-label={t('Quick find', 'الانتقال السريع')} aria-keyshortcuts="Control+K Meta+K" className="flex flex-1 items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-4 py-2 text-start text-sm text-gray-500 hover:bg-gray-100 sm:max-w-md">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            <span className="truncate">{t('Search…', 'بحث…')}</span>
            <kbd className="ms-auto hidden rounded border border-gray-300 bg-white px-1.5 text-[10px] text-gray-500 sm:inline">Ctrl K</kbd>
          </button>
          <div className="ms-auto flex items-center gap-1 sm:gap-2">
            {perms.can('VIEW_ORDERS') && <StaffAlertsBell t={t} locale={locale} navigate={(href) => router.push(href)} hrefFor={(a) => adminHref(a, perms.can)} changes={(since) => fetchAdminChanges('orders,exceptions', since)} centerHref="/inbox" />}
            <button onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50" aria-label={t('Switch to Arabic', 'التبديل إلى الإنجليزية')}>
              {locale === 'ar' ? 'English' : 'العربية'}
            </button>
            <button type="button" onClick={() => setPwOpen(true)} className="flex items-center gap-2 rounded-lg p-0.5 hover:bg-gray-50" title={t('Change my password', 'تغيير كلمة المرور')} aria-label={t('My account — change my password', 'حسابي — تغيير كلمة المرور')}>
              <span aria-hidden className="flex h-9 w-9 items-center justify-center rounded-full bg-hatly-orange text-white shadow-sm"><svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0116 0" /></svg></span>
              <span className="hidden min-w-0 leading-tight sm:block"><span className="block max-w-[9rem] truncate text-xs font-medium text-gray-800"><bdi>{user?.fullName ?? user?.phone ?? ''}</bdi></span><span className="block text-[10px] text-gray-400">{perms.role === 'SUPER_ADMIN' ? t('Super admin', 'مدير النظام') : t('Admin', 'مشرف')}</span></span>
            </button>
            <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
            {/* Signing out also unregisters this browser from push, so a shared device stops showing this admin's alerts. */}
            <Button variant="ghost" size="sm" onClick={() => forgetThisDevice().finally(() => logout().finally(() => router.replace('/login')))}>{t('Sign out', 'تسجيل الخروج')}</Button>
          </div>
        </header>
        <OpsAlarmBar />
        {/* The Control Tower and the Orders workspace show these same facts as their own queues, so the shell banner stays out of their way. */}
        {/* Stage 5: the Operations board shows these facts itself (its "Other work" strip), so the banner steps aside wherever the board is on screen. */}
        {!boardShown && !['/control-tower', '/order-management'].some((p) => pathname === p) && <OperationsBanner facts={operations} />}
        <OpsShellContext.Provider value={shellCtx}>
          <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">{tabs}{children}</main>
        </OpsShellContext.Provider>
      </div>
      <CommandPalette open={search} onClose={() => setSearch(false)} />
    </div>
    </OpsAlarmProvider>
  );
}

/** A small count on a section tab; nothing when there is nothing waiting. */
function TabCount({ n }: { n?: number }) {
  if (!n) return null;
  return <span data-testid="tab-count" className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-semibold text-white">{n}</span>;
}
