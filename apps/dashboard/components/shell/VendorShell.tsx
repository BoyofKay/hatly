'use client';

import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getCurrentUser } from '../../lib/auth/session';
import { useApi } from '../../lib/ui/api';
import { useLang } from '../../lib/ui/lang';
import { useVendorOrdersFeed } from '../../lib/vendor/orders-feed';
import type { VendorOverview } from '../../lib/api/vendor-business';
import { StaffAlertsBell } from './StaffAlertsBell';
import { ChangePasswordModal } from '../account/ChangePasswordModal';
import { vendorHref } from '../../lib/notifications/wording';
import { fetchVendorChanges } from '../../lib/api/changes';

interface Page {
  href: string;
  en: string;
  ar: string;
  badge?: boolean;
}
interface Section {
  id: string;
  en: string;
  ar: string;
  icon: string;
  pages: Page[];
}
const ICONS: Record<string, string> = {
  home: 'M3 11l9-8 9 8v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z',
  orders: 'M6 6h15l-1.5 9H8L6 3H3M9 20a1 1 0 100-2 1 1 0 000 2zm9 0a1 1 0 100-2 1 1 0 000 2z',
  box: 'M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  stock: 'M3 7l9-4 9 4-9 4zM3 12l9 4 9-4M3 17l9 4 9-4',
  chart: 'M4 20V10m6 10V4m6 16v-8m4 8H2',
  wallet: 'M3 7h16a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7zm0 0V6a2 2 0 012-2h11M16 13.5h.01',
  cog: 'M12 15a3 3 0 100-6 3 3 0 000 6zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2',
};
/**
 * The reference's flat vendor menu (`docs/transformation/reference/admin-vendor-reference.jpg`): Home, Orders, Products, Inventory, Reports,
 * Payments, Settings; the pages of a section are tabs above the page. The reference's "Offers" entry is not shown: there is no vendor-side
 * offers feature, and who funds a vendor's discount is an open owner decision.
 */
const SECTIONS: Section[] = [
  { id: 'home', en: 'Home', ar: 'الرئيسية', icon: 'home', pages: [{ href: '/overview', en: 'Overview', ar: 'نظرة عامة' }] },
  { id: 'orders', en: 'Orders', ar: 'الطلبات', icon: 'orders', pages: [{ href: '/orders', en: 'Orders', ar: 'الطلبات', badge: true }, { href: '/order-history', en: 'Order history', ar: 'سجل الطلبات' }] },
  { id: 'products', en: 'Products', ar: 'المنتجات', icon: 'box', pages: [{ href: '/products', en: 'Products', ar: 'المنتجات' }] },
  { id: 'inventory', en: 'Inventory', ar: 'المخزون', icon: 'stock', pages: [{ href: '/stock', en: 'Stock', ar: 'المخزون' }, { href: '/stock-history', en: 'Stock history', ar: 'سجل المخزون' }] },
  { id: 'reports', en: 'Reports', ar: 'التقارير', icon: 'chart', pages: [{ href: '/insights', en: 'Insights', ar: 'التحليلات' }] },
  { id: 'payments', en: 'Payments', ar: 'المدفوعات', icon: 'wallet', pages: [{ href: '/finance', en: 'Financial centre', ar: 'المركز المالي' }, { href: '/earnings', en: 'Earnings', ar: 'المستحقات' }] },
  { id: 'settings', en: 'Settings', ar: 'الإعدادات', icon: 'cog', pages: [{ href: '/my-branches', en: 'My branches', ar: 'فروعي' }, { href: '/team', en: 'Team', ar: 'الفريق' }, { href: '/notifications', en: 'Notifications', ar: 'الإشعارات' }] },
];

const startsAt = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

function Svg({ name, className = 'h-5 w-5' }: { name: string; className?: string }) {
  return <svg viewBox="0 0 24 24" className={`${className} shrink-0`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={ICONS[name]} /></svg>;
}

/**
 * The Vendor Business Hub shell: Arabic-first (the Vendor area defaults to Arabic until the person chooses a language), right-to-left aware,
 * responsive (the menu becomes a drawer below the `lg` breakpoint), with the single language control, the alerts bell and the awaiting-orders
 * badge. The shell never decides what a vendor may do — every page reads and writes only through endpoints that scope to the vendor's own branches.
 */
export function VendorShell({ children, onSignOut }: { children: ReactNode; onSignOut: () => void }) {
  const { t, locale, setLocale } = useLang();
  const [pwOpen, setPwOpen] = useState(false);
  const pathname = usePathname();
  const { awaitingAcceptance } = useVendorOrdersFeed();
  const overview = useApi<VendorOverview>('/vendor/overview');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  useEffect(() => setName(getCurrentUser()?.fullName ?? ''), []);
  useEffect(() => setOpen(false), [pathname]);
  // On a narrow screen the section's tabs scroll sideways; bring the current page's tab into view.
  useEffect(() => {
    document.querySelector('[data-testid="section-tabs"] [aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  const section = SECTIONS.find((s) => s.pages.some((p) => startsAt(pathname, p.href))) ?? null;
  const store = overview.data?.vendorName ?? null;

  const badge = awaitingAcceptance > 0 && (
    <span
      data-testid="vendor-awaiting-badge"
      aria-label={locale === 'ar' ? `${awaitingAcceptance} طلبات بانتظارك` : `${awaitingAcceptance} orders waiting for you`}
      className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-semibold text-white"
    >
      {awaitingAcceptance}
    </span>
  );

  const menu = (
    <div className="flex h-full flex-col overflow-y-auto px-3 pb-4 pt-3">
      <Link href="/overview" className="mb-5 flex items-center gap-2.5 rounded-2xl bg-hatly-orange px-3 py-2.5 text-lg font-bold text-white shadow-[0_6px_16px_-6px_rgba(255,122,26,0.6)]">
        <img src="/hatly-logo.jpg" alt="" aria-hidden width={34} height={34} className="h-[34px] w-[34px] rounded-xl object-cover ring-2 ring-white/70" />
        <span>Hatly</span>
      </Link>
      <nav aria-label={t('Main navigation', 'التنقل الرئيسي')}>
        <ul className="space-y-1">
          {SECTIONS.map((s) => {
            const current = section?.id === s.id;
            return (
              <li key={s.id} className="relative">
                <Link href={s.pages[0].href} data-testid={`vendor-section-${s.id}`} aria-current={current ? 'page' : undefined}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${current ? 'bg-hatly-orange text-white shadow-[0_6px_14px_-6px_rgba(255,122,26,0.7)]' : 'text-gray-700 hover:bg-orange-50 hover:text-hatly-orangeDark'}`}>
                  <Svg name={s.icon} />
                  <span className="flex-1">{t(s.en, s.ar)}</span>
                </Link>
                {s.id === 'orders' && badge && <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2">{badge}</span>}
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );

  const tabs = section && section.pages.length > 1 ? (
    <nav aria-label={t('Section pages', 'صفحات القسم')} data-testid="section-tabs" className="-mx-4 mb-5 overflow-x-auto px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <ul className="flex min-w-max gap-1 border-b border-gray-200">
        {section.pages.map((p) => {
          const current = startsAt(pathname, p.href);
          return (
            <li key={p.href}>
              <Link href={p.href} aria-current={current ? 'page' : undefined}
                className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium ${current ? 'border-hatly-orange text-hatly-orangeDark' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-800'}`}>
                {t(p.en, p.ar)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  ) : null;

  return (
    <div data-role-scope="vendor" className="flex min-h-screen bg-gray-50">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-e border-gray-100 bg-white lg:block">{menu}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="absolute inset-0 bg-black/40" aria-hidden />
          <aside className="relative h-full w-72 max-w-[85vw] bg-white shadow-xl">{menu}</aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-gray-100 bg-white/95 px-3 py-2.5 backdrop-blur sm:px-6">
          <button className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 lg:hidden" aria-label={t('Open menu', 'فتح القائمة')} onClick={() => setOpen(true)}>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          {/* The reference's store chip: the store's name with an orange store badge, and who is signed in. */}
          <span className="flex min-w-0 items-center gap-2" data-testid="vendor-store-chip">
            <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-hatly-orange text-white shadow-sm"><Svg name="home" className="h-[18px] w-[18px]" /></span>
            <span className="min-w-0 leading-tight">
              <bdi dir="auto" className="block max-w-[11rem] truncate text-sm font-semibold text-gray-900">{store ?? name}</bdi>
              {store && name ? <bdi dir="auto" className="block max-w-[11rem] truncate text-xs text-gray-500">{name}</bdi> : <span className="block text-xs text-gray-500">{t('Store', 'متجر')}</span>}
            </span>
          </span>
          <div className="ms-auto flex items-center gap-1 sm:gap-2">
            <StaffAlertsBell t={t} locale={locale} hrefFor={vendorHref} changes={fetchVendorChanges} centerHref="/notifications" />
            <button onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50" aria-label={t('Switch to Arabic', 'التبديل إلى الإنجليزية')}>
              {locale === 'ar' ? 'English' : 'العربية'}
            </button>
            <button onClick={() => setPwOpen(true)} className="rounded-lg px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-100">{t('Password', 'كلمة المرور')}</button>
            <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
            <button onClick={onSignOut} className="rounded-lg px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-100">{t('Sign out', 'تسجيل الخروج')}</button>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">{tabs}{children}</main>
      </div>
    </div>
  );
}
