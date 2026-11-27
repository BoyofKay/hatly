/**
 * The Admin navigation, as in the approved reference (`docs/transformation/reference/admin-vendor-reference.jpg`): flat sections in the
 * sidebar (owner order 2026-11-22: Home, Orders, Delivery, Customers, Settlements, Stores, Products, Offers, Reports, Settings); each section's pages are tabs at the top
 * of the page, so every existing page stays one click away. `perms` = the admin needs ANY of them to SEE the link (a UX filter only — the backend
 * enforces every route); a section shows when at least one of its pages does, and opens its first visible page. `match` adds address prefixes
 * that belong to the section without being a tab (detail pages). Labels are English/Arabic pairs; existing page link names are kept.
 */
export interface NavItem {
  href: string;
  en: string;
  ar: string;
  perms?: string[];
  /** SUPER_ADMIN only. */
  superOnly?: boolean;
  /** Stage 5: a page kept one click away under the section's "More" menu instead of a tab of its own (less-used / overlapping views). */
  more?: boolean;
  /**
   * Owner request 2026-11-22: pages that belong together share ONE tab (e.g. "Settlements") and appear as a second row of tabs
   * when you are on any of them. Items with the same `sub.id` must be next to each other.
   */
  sub?: { id: string; en: string; ar: string };
}
export interface NavGroup {
  id: string;
  en: string;
  ar: string;
  icon: string;
  items: NavItem[];
  match?: string[];
}

const P = {
  orders: ['VIEW_ORDERS'],
  fin: ['VIEW_FINANCIALS'],
  vendors: ['VENDORS_VIEW', 'MANAGE_VENDORS'],
  catalog: ['CATALOG_VIEW', 'MANAGE_CATALOG'],
  fleet: ['FLEET_VIEW', 'MANAGE_DRIVERS', 'ASSIGN_REASSIGN_ORDERS'],
  marketing: ['MARKETING_VIEW', 'MANAGE_OFFERS', 'MANAGE_CAMPAIGNS', 'MANAGE_BROADCASTS'],
  media: ['MEDIA_VIEW', 'MANAGE_MEDIA', 'MANAGE_CATALOG', 'MANAGE_VENDORS', 'MANAGE_MARKETPLACE_SECTORS', 'MANAGE_HOME_BANNERS'],
};

const USERS = { id: 'users', en: 'Users', ar: 'المستخدمون' };

export const NAV: NavGroup[] = [
  {
    id: 'home', en: 'Home', ar: 'الرئيسية', icon: 'home',
    items: [{ href: '/home', en: 'Home', ar: 'الرئيسية', perms: [] }],
  },
  {
    id: 'orders', en: 'Orders', ar: 'الطلبات', icon: 'clipboard', match: ['/order-search', '/dispatch'],
    // Stage 5: the section opens on the Operations board (the daily work); views it already covers sit under "More".
    items: [
      { href: '/operations', en: 'Operations board', ar: 'لوحة التشغيل', perms: P.orders },
      { href: '/stores-now', en: 'Stores now', ar: 'المتاجر الآن', perms: P.orders },
      { href: '/order-management', en: 'Orders', ar: 'الطلبات', perms: P.orders },
      { href: '/exceptions', en: 'Exceptions', ar: 'الاستثناءات', perms: P.orders },
      { href: '/failed-deliveries', en: 'Failed Deliveries', ar: 'التوصيلات الفاشلة', perms: ['MANAGE_ORDER_ISSUES'] },
      { href: '/manual-transfer', en: 'Manual Transfer', ar: 'التحويل اليدوي', perms: ['VERIFY_MANUAL_PAYMENTS'] },
      { href: '/refunds', en: 'Refunds', ar: 'المستردات', perms: ['VERIFY_MANUAL_PAYMENTS', 'VIEW_FINANCIALS'] },
      { href: '/payments', en: 'Payments', ar: 'المدفوعات', perms: ['VERIFY_MANUAL_PAYMENTS', 'VIEW_FINANCIALS'] },
      { href: '/control-tower', en: 'Control Tower', ar: 'برج التحكم', perms: P.orders, more: true },
      { href: '/alerts', en: 'Alerts', ar: 'التنبيهات', perms: P.orders, more: true },
      { href: '/inbox', en: 'Notifications', ar: 'الإشعارات', perms: P.orders, more: true },
      { href: '/notification-setup', en: 'Notification setup', ar: 'إعداد الإشعارات', perms: P.orders, more: true },
    ],
  },
  {
    id: 'delivery', en: 'Delivery', ar: 'التوصيل', icon: 'truck',
    items: [
      { href: '/fleet', en: 'Live fleet', ar: 'الأسطول المباشر', perms: P.fleet },
      { href: '/drivers-today', en: 'Drivers today', ar: 'المندوبون اليوم', perms: ['CLOSE_DRIVER_SETTLEMENTS'] },
      { href: '/cash-remainders', en: 'Cash Remainders', ar: 'باقي النقد', perms: ['MANAGE_CUSTOMER_WALLET'] },
      { href: '/employee-loans', en: 'Employee Loans', ar: 'سلف الموظفين', perms: ['MANAGE_EMPLOYEE_LOANS'] },
    ],
  },
  {
    id: 'customers', en: 'Customers', ar: 'العملاء', icon: 'users',
    items: [
      { href: '/customers', en: 'Customers', ar: 'العملاء', perms: ['VIEW_CUSTOMERS'] },
      { href: '/reviews', en: 'Reviews', ar: 'التقييمات', perms: ['MODERATE_REVIEWS'] },
      { href: '/wallet-adjustments', en: 'Wallet adjustments', ar: 'تعديلات المحفظة', perms: P.fin },
      { href: '/account-deletion-requests', en: 'Deletion requests', ar: 'طلبات الحذف', perms: [] },
    ],
  },
  {
    // Owner request 2026-11-22: settlements are their own sidebar section, right after Customers.
    id: 'settlements', en: 'Settlements', ar: 'التسويات', icon: 'coins',
    items: [
      { href: '/settlement', en: 'Closing', ar: 'التقفيل', perms: ['CLOSE_VENDOR_SETTLEMENTS', 'CLOSE_DRIVER_SETTLEMENTS'] },
      { href: '/settlement-statements', en: 'Statements by period', ar: 'الكشوف حسب الفترة', perms: ['VIEW_VENDOR_FINANCIAL_REPORTS', 'VIEW_DRIVER_SETTLEMENTS'] },
      { href: '/settlements', en: 'Settlement history', ar: 'سجل التسويات', perms: ['VIEW_VENDOR_FINANCIAL_REPORTS', 'VIEW_DRIVER_SETTLEMENTS'] },
    ],
  },
  {
    id: 'stores', en: 'Stores', ar: 'المتاجر', icon: 'shop',
    items: [
      { href: '/vendors', en: 'Vendors', ar: 'المتاجر', perms: P.vendors },
      { href: '/branches', en: 'Branches', ar: 'الفروع', perms: P.vendors },
      { href: '/branch-requests', en: 'Store Requests', ar: 'طلبات المتاجر', perms: ['MANAGE_VENDORS'] },
      { href: '/vendor-staff', en: 'Vendor Staff', ar: 'موظفو المتاجر', perms: ['MANAGE_VENDOR_STAFF'] },
    ],
  },
  {
    id: 'products', en: 'Products', ar: 'المنتجات', icon: 'box',
    items: [
      { href: '/catalog', en: 'Products', ar: 'المنتجات', perms: P.catalog },
      { href: '/product-requests', en: 'Product Requests', ar: 'طلبات المنتجات', perms: P.catalog },
      { href: '/inventory', en: 'Inventory', ar: 'المخزون', perms: P.catalog },
      { href: '/media', en: 'Media library', ar: 'مكتبة الوسائط', perms: P.media },
    ],
  },
  {
    id: 'offers', en: 'Offers', ar: 'العروض', icon: 'tag',
    items: [
      { href: '/offers', en: 'Offers', ar: 'العروض', perms: ['MANAGE_OFFERS'] },
      // Owner decision 2026-11-27: Hatly-wide / per-store promo codes and delivery-fee campaigns.
      { href: '/promotions', en: 'Promotions', ar: 'العروض الترويجية', perms: ['MANAGE_OFFERS'] },
      { href: '/banners', en: 'Banners', ar: 'البنرات', perms: ['MANAGE_HOME_BANNERS'] },
      { href: '/campaigns', en: 'Campaigns', ar: 'الحملات', perms: P.marketing },
      { href: '/broadcasts', en: 'Broadcasts', ar: 'الرسائل الجماعية', perms: P.marketing },
      { href: '/audiences', en: 'Audiences', ar: 'الجمهور', perms: P.marketing },
      { href: '/growth', en: 'Growth', ar: 'النمو', perms: P.marketing },
    ],
  },
  {
    id: 'reports', en: 'Reports', ar: 'التقارير', icon: 'chart',
    items: [
      { href: '/reports', en: 'Reports', ar: 'التقارير', perms: ['VIEW_REPORTS'] },
      { href: '/executive', en: 'Executive overview', ar: 'النظرة التنفيذية', perms: ['VIEW_REPORTS'] },
      { href: '/exports', en: 'Exports', ar: 'التصدير', perms: ['VIEW_REPORTS'] },
      { href: '/finance/ledger', en: 'Ledger', ar: 'دفتر الأستاذ', perms: P.fin },
      { href: '/finance/revenue', en: 'Revenue', ar: 'الإيرادات', perms: P.fin },
      { href: '/finance/receivables', en: 'Vendor receivables', ar: 'مستحقات المتاجر', perms: P.fin },
      { href: '/finance/liabilities', en: 'Liabilities', ar: 'الالتزامات', perms: P.fin },
      { href: '/finance/reconciliation', en: 'Reconciliation', ar: 'المطابقة', perms: P.fin },
    ],
  },
  {
    id: 'settings', en: 'Settings', ar: 'الإعدادات', icon: 'cog',
    items: [
      { href: '/settings', en: 'Settings', ar: 'الإعدادات', perms: ['MANAGE_BUSINESS_CONFIG', 'CONFIG_VIEW'] },
      // Owner request 2026-11-22: people who sign in — staff and drivers — under one "Users" tab.
      { href: '/users', en: 'Staff & permissions', ar: 'الموظفون والصلاحيات', perms: ['MANAGE_STAFF_ACCOUNTS'], sub: USERS },
      { href: '/drivers', en: 'Drivers', ar: 'السائقون', perms: ['MANAGE_DRIVERS'], sub: USERS },
      // Owner decision 2026-11-23: "Forgot password?" requests from every app — answered here by someone above the person.
      { href: '/password-requests', en: 'Password requests', ar: 'طلبات كلمة المرور', perms: ['MANAGE_CUSTOMERS', 'MANAGE_DRIVERS', 'CHANGE_DRIVER_ONLINE_STATUS', 'MANAGE_VENDOR_STAFF', 'MANAGE_STAFF_ACCOUNTS'], sub: USERS },
      // Owner request 2026-11-22: the critical setup lives in Settings.
      { href: '/sectors', en: 'Sectors', ar: 'الأقسام', perms: ['MANAGE_MARKETPLACE_SECTORS'] },
      { href: '/service-areas', en: 'Service Areas', ar: 'مناطق الخدمة', perms: ['MANAGE_SERVICE_AREAS'] },
      { href: '/delivery-zones', en: 'Delivery Zones', ar: 'مناطق التوصيل', perms: ['MANAGE_SERVICE_AREAS'] },
      { href: '/vehicle-types', en: 'Vehicle Types', ar: 'أنواع المركبات', perms: ['MANAGE_VEHICLE_TYPES'] },
      { href: '/audit-log', en: 'Audit log', ar: 'سجل التدقيق', perms: ['VIEW_AUDIT_LOG'] },
      { href: '/security', en: 'Security', ar: 'الأمان', perms: [] },
      { href: '/config', en: 'Configuration overview', ar: 'نظرة عامة على الإعدادات', perms: ['MANAGE_BUSINESS_CONFIG', 'CONFIG_VIEW'], more: true },
      { href: '/access/templates', en: 'Role templates', ar: 'قوالب الأدوار', superOnly: true, more: true },
      { href: '/system', en: 'System health', ar: 'صحة النظام', perms: ['VIEW_SYSTEM_HEALTH'], more: true },
      { href: '/system/metrics', en: 'Metrics', ar: 'المقاييس', perms: ['VIEW_SYSTEM_HEALTH'], more: true },
      { href: '/system/jobs', en: 'Jobs', ar: 'المهام', perms: ['VIEW_SYSTEM_HEALTH'], more: true },
    ],
  },
];

const startsAt = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** The section and the page (tab) the address belongs to: the longest matching address wins, so `/system/jobs` is Jobs, not System health. */
export function locate(pathname: string, groups: NavGroup[] = NAV): { group: NavGroup | null; item: NavItem | null } {
  let best: { group: NavGroup; item: NavItem | null; len: number } | null = null;
  for (const g of groups) {
    for (const i of g.items) if (startsAt(pathname, i.href) && (!best || i.href.length > best.len)) best = { group: g, item: i, len: i.href.length };
    for (const m of g.match ?? []) if (startsAt(pathname, m) && (!best || m.length > best.len)) best = { group: g, item: null, len: m.length };
  }
  return best ? { group: best.group, item: best.item } : { group: null, item: null };
}
