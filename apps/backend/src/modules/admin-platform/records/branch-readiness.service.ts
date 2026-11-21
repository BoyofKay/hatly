import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { effectiveOpenSql } from '../../../common/branch-availability';

export type ReadinessLevel = 'BLOCKER' | 'WARNING';

export interface ReadinessCheck {
  key: string;
  ok: boolean;
  /** BLOCKER = customers cannot order, orders get stuck, or Hatly loses money. WARNING = works, but looks or runs worse. */
  level: ReadinessLevel;
  en: string;
  ar: string;
  /** Where on the branch page this is fixed (an element id), or a separate admin page. */
  fix: string;
}

export interface BranchReadiness {
  branchId: string;
  ready: boolean;
  blockers: number;
  warnings: number;
  checks: ReadinessCheck[];
}

/**
 * The go-live checklist of a store branch (owner request 2026-11-21: review the full "add a new restaurant" cycle for gaps, broken steps
 * and missing dependencies). Read-only: it reports, it changes nothing. Each check is a fact read from the database, never a guess.
 */
@Injectable()
export class BranchReadinessService {
  constructor(private readonly ds: DataSource) {}

  async check(branchId: string): Promise<BranchReadiness> {
    if (!/^[0-9a-f-]{36}$/i.test(branchId)) throw new NotFoundException('Branch not found.');
    const [b] = await this.ds.query(
      `SELECT b.id, b.is_active, b.is_open, ${effectiveOpenSql('b')} AS open_now, b.service_area_id, b.marketplace_sector_id, b.commission_rate_basis_points,
              b.acceptance_mode, b.opening_hours, b.delivery_enabled, b.pickup_enabled, b.preparation_time_minutes,
              v.is_active AS vendor_active, v.logo_url, v.name_ar AS vendor_name_ar, b.name_ar AS branch_name_ar,
              sa.is_active AS area_active, ms.is_active AS sector_active
         FROM vendor_branches b
         JOIN vendors v ON v.id = b.vendor_id
         LEFT JOIN service_areas sa ON sa.id = b.service_area_id AND sa.deleted_at IS NULL
         LEFT JOIN marketplace_sectors ms ON ms.id = b.marketplace_sector_id AND ms.deleted_at IS NULL
        WHERE b.id = $1 AND b.deleted_at IS NULL`,
      [branchId],
    );
    if (!b) throw new NotFoundException('Branch not found.');
    const [n] = await this.ds.query(
      `SELECT
         (SELECT count(*)::int FROM products p WHERE p.vendor_branch_id = $1 AND p.deleted_at IS NULL AND p.is_available) AS available_products,
         (SELECT count(*)::int FROM products p WHERE p.vendor_branch_id = $1 AND p.deleted_at IS NULL AND p.is_available AND p.image_url IS NULL AND p.media_asset_id IS NULL) AS products_without_photo,
         (SELECT count(*)::int FROM products p WHERE p.vendor_branch_id = $1 AND p.deleted_at IS NULL AND p.is_available AND (p.name_ar IS NULL OR p.name_ar = '')) AS products_without_arabic,
         (SELECT count(*)::int FROM product_categories c WHERE c.vendor_branch_id = $1 AND c.deleted_at IS NULL AND c.is_active) AS categories,
         (SELECT count(*)::int FROM vendor_staff s JOIN users u ON u.id = s.user_id WHERE s.vendor_branch_id = $1 AND s.deleted_at IS NULL AND u.is_active) AS staff,
         (SELECT count(*)::int FROM delivery_zones z WHERE z.service_area_id = $2 AND z.deleted_at IS NULL AND z.is_active) AS zones`,
      [branchId, b.service_area_id],
    );
    const hours = b.opening_hours && typeof b.opening_hours === 'object' ? Object.keys(b.opening_hours).length : 0;
    const checks: ReadinessCheck[] = [
      { key: 'VENDOR_ACTIVE', ok: b.vendor_active, level: 'BLOCKER', en: 'The store (vendor) is active.', ar: 'المتجر مفعّل.', fix: 'vendor' },
      { key: 'BRANCH_ACTIVE', ok: b.is_active, level: 'BLOCKER', en: 'The branch is active.', ar: 'الفرع مفعّل.', fix: 'sec-details' },
      { key: 'SERVICE_AREA', ok: !!b.service_area_id && b.area_active === true, level: 'BLOCKER', en: 'The branch is in an active service area (customers only see stores in their area).', ar: 'الفرع داخل منطقة خدمة مفعّلة (العملاء يرون متاجر منطقتهم فقط).', fix: 'sec-area' },
      { key: 'SECTOR', ok: !!b.marketplace_sector_id && b.sector_active === true, level: 'BLOCKER', en: 'The branch is in an active section (Restaurants, Groceries, …) so it appears on Home.', ar: 'الفرع داخل قسم مفعّل (مطاعم، بقالة…) ليظهر في الرئيسية.', fix: 'sec-sector' },
      { key: 'COMMISSION', ok: b.commission_rate_basis_points !== null, level: 'BLOCKER', en: 'A commission rate is set. Without it, delivered orders record NO Hatly commission (it is never added later).', ar: 'نسبة العمولة محددة. بدونها لا تُسجَّل عمولة هاتلي على الطلبات المسلّمة (ولا تُضاف لاحقًا).', fix: 'sec-details' },
      { key: 'MENU', ok: n.available_products > 0 && n.categories > 0, level: 'BLOCKER', en: `The menu has available products (${n.available_products}) in categories (${n.categories}).`, ar: `المنيو به منتجات متاحة (${n.available_products}) في أقسام (${n.categories}).`, fix: 'sec-products' },
      {
        key: 'WHO_ACCEPTS',
        ok: b.acceptance_mode !== 'VENDOR' || n.staff > 0,
        level: 'BLOCKER',
        en: b.acceptance_mode === 'VENDOR' ? `The store accepts its own orders, so it needs at least one active store staff account (now ${n.staff}).` : `Orders are accepted by ${b.acceptance_mode === 'AUTO' ? 'the system (automatic)' : 'Hatly operations'}.`,
        ar: b.acceptance_mode === 'VENDOR' ? `المتجر يقبل طلباته بنفسه، لذا يحتاج حساب موظف متجر نشط واحدًا على الأقل (حاليًا ${n.staff}).` : `الطلبات يقبلها ${b.acceptance_mode === 'AUTO' ? 'النظام تلقائيًا' : 'فريق تشغيل هاتلي'}.`,
        fix: 'vendor-staff',
      },
      { key: 'FULFILMENT', ok: b.delivery_enabled || b.pickup_enabled, level: 'BLOCKER', en: 'Delivery and/or pickup is enabled.', ar: 'التوصيل و/أو الاستلام من الفرع مفعّل.', fix: 'sec-details' },
      { key: 'DELIVERY_ZONES', ok: !b.delivery_enabled || n.zones > 0, level: 'BLOCKER', en: `The service area has active delivery zones for customers to choose (${n.zones ?? 0}).`, ar: `منطقة الخدمة بها مناطق توصيل مفعّلة يختار منها العملاء (${n.zones ?? 0}).`, fix: 'delivery-zones' },
      { key: 'OPEN', ok: b.open_now === true, level: 'WARNING', en: b.is_open ? 'The branch is open now.' : 'The branch is switched CLOSED. Press "Open" when it should take orders (a new branch starts closed).', ar: b.is_open ? 'الفرع مفتوح الآن.' : 'الفرع مغلق. اضغط "فتح" عندما يبدأ في استقبال الطلبات (الفرع الجديد يبدأ مغلقًا).', fix: 'sec-details' },
      { key: 'HOURS', ok: hours > 0, level: 'WARNING', en: 'Opening hours are set (without them the branch is open whenever its switch is on).', ar: 'مواعيد العمل محددة (بدونها يكون الفرع مفتوحًا طالما المفتاح مفعّل).', fix: 'sec-hours' },
      { key: 'PREP_TIME', ok: b.preparation_time_minutes !== null, level: 'WARNING', en: 'A preparation time is set (used for customer estimates and dispatch).', ar: 'وقت التحضير محدد (يُستخدم في تقدير الوقت للعميل والإسناد).', fix: 'sec-hours' },
      { key: 'LOGO', ok: !!b.logo_url, level: 'WARNING', en: 'The store has a logo.', ar: 'للمتجر شعار.', fix: 'vendor' },
      { key: 'ARABIC', ok: !!b.vendor_name_ar && !!b.branch_name_ar && n.products_without_arabic === 0, level: 'WARNING', en: `Arabic names are filled (store${b.vendor_name_ar ? ' ✓' : ' ✗'}, branch${b.branch_name_ar ? ' ✓' : ' ✗'}, ${n.products_without_arabic} product(s) missing one).`, ar: `الأسماء العربية مكتملة (المتجر${b.vendor_name_ar ? ' ✓' : ' ✗'}، الفرع${b.branch_name_ar ? ' ✓' : ' ✗'}، ${n.products_without_arabic} منتج ينقصه الاسم العربي).`, fix: 'sec-products' },
      { key: 'PHOTOS', ok: n.products_without_photo === 0, level: 'WARNING', en: `Every available product has a photo (${n.products_without_photo} without).`, ar: `لكل منتج متاح صورة (${n.products_without_photo} بدون صورة).`, fix: 'sec-products' },
    ];
    const blockers = checks.filter((c) => !c.ok && c.level === 'BLOCKER').length;
    return { branchId, ready: blockers === 0, blockers, warnings: checks.filter((c) => !c.ok && c.level === 'WARNING').length, checks };
  }
}
