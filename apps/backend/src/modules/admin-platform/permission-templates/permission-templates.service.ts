import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Permission } from '../../permissions/permission.enum';
import { returned } from '../common/platform-sql';
import { PermissionsService } from '../../permissions/permissions.service';

export interface TemplateDef {
  key: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  permissions: Permission[];
}

const P = Permission;

/**
 * System templates (docs/admin-revamp MS §9.3). A template is a PRESET: applying it COPIES its permissions onto an admin; the admin's
 * individual grants stay editable afterwards and nothing ever links back to the template. Approver and dangerous permissions
 * (CAMPAIGN_APPROVE, BROADCAST_APPROVE, WALLET_ADJUST_APPROVE, APPROVE_SETTLEMENT_OVERPAYMENT, MEDIA_DELETE, AUDIT_EXPORT, VIEW_AUDIT_LOG,
 * MANAGE_BUSINESS_CONFIG, MANAGE_VENDORS, the commission permissions, MANAGE_HATLY_SERVICE_PRICING) are in NO system template — they are
 * granted individually and deliberately.
 */
export const SYSTEM_TEMPLATES: TemplateDef[] = [
  {
    key: 'FINANCE',
    nameEn: 'Finance',
    nameAr: 'المالية',
    descriptionEn: 'Ledger, settlements, payments and refunds, financial reports and exports.',
    descriptionAr: 'دفتر الأستاذ والتسويات والمدفوعات والمستردات والتقارير المالية والتصدير.',
    permissions: [P.VIEW_ORDERS, P.VIEW_CUSTOMERS, P.VIEW_REPORTS, P.VIEW_FINANCIALS, P.VIEW_VENDOR_FINANCIAL_REPORTS, P.VIEW_DRIVER_SETTLEMENTS, P.CLOSE_VENDOR_SETTLEMENTS, P.CLOSE_DRIVER_SETTLEMENTS, P.MANAGE_SETTLEMENT_PAYMENTS, P.VERIFY_MANUAL_PAYMENTS, P.MANAGE_CUSTOMER_WALLET, P.MANAGE_EMPLOYEE_LOANS, P.FINANCE_EXPORT, P.ORDERS_EXPORT, P.REPORTS_EXPORT],
  },
  {
    key: 'OPERATIONS',
    nameEn: 'Operations',
    nameAr: 'العمليات',
    descriptionEn: 'Orders, dispatch, drivers, vendor availability and operational monitoring.',
    descriptionAr: 'الطلبات والتوزيع والسائقون وتوفر الموردين ومراقبة التشغيل.',
    permissions: [P.VIEW_ORDERS, P.MANAGE_ORDER_FULFILMENT, P.MANAGE_ORDER_ISSUES, P.ASSIGN_REASSIGN_ORDERS, P.OVERRIDE_DISPATCH, P.MANAGE_DRIVERS, P.CHANGE_DRIVER_ONLINE_STATUS, P.OPEN_CLOSE_VENDOR_BRANCHES, P.VENDORS_VIEW, P.FLEET_VIEW, P.VIEW_CUSTOMERS, P.VIEW_REPORTS, P.VIEW_SYSTEM_HEALTH, P.ORDERS_EXPORT, P.FLEET_EXPORT],
  },
  {
    key: 'SUPPORT',
    nameEn: 'Support',
    nameAr: 'الدعم',
    descriptionEn: 'Customer 360, order issues, customer notes, review moderation and wallet adjustment requests.',
    descriptionAr: 'ملف العميل ومشكلات الطلبات وملاحظات العملاء ومراجعة التقييمات وطلبات تعديل المحفظة.',
    permissions: [P.VIEW_ORDERS, P.MANAGE_ORDER_ISSUES, P.VIEW_CUSTOMERS, P.VIEW_CUSTOMER_PII, P.MANAGE_CUSTOMERS, P.MODERATE_REVIEWS, P.MANAGE_CUSTOMER_WALLET],
  },
  {
    key: 'CATALOG',
    nameEn: 'Catalog',
    nameAr: 'الكتالوج',
    descriptionEn: 'Products, categories, sectors, banners and the media library.',
    descriptionAr: 'المنتجات والفئات والقطاعات واللافتات ومكتبة الوسائط.',
    permissions: [P.MANAGE_CATALOG, P.CATALOG_VIEW, P.CATALOG_EXPORT, P.MANAGE_MARKETPLACE_SECTORS, P.MANAGE_HOME_BANNERS, P.MANAGE_MEDIA, P.MEDIA_VIEW, P.VENDORS_VIEW],
  },
  {
    key: 'MARKETING',
    nameEn: 'Marketing',
    nameAr: 'التسويق',
    descriptionEn: 'Offers, coupons, campaigns, broadcasts, loyalty and banners.',
    descriptionAr: 'العروض والقسائم والحملات والبث والولاء واللافتات.',
    permissions: [P.MANAGE_OFFERS, P.MANAGE_HOME_BANNERS, P.MANAGE_CAMPAIGNS, P.MANAGE_BROADCASTS, P.MANAGE_LOYALTY_CONFIG, P.MARKETING_VIEW, P.MARKETING_EXPORT, P.MANAGE_MEDIA, P.MEDIA_VIEW, P.VIEW_REPORTS, P.VIEW_CUSTOMERS],
  },
  // ---- Staff hierarchy presets (owner decision 2026-11-22). Each level includes the one below it.
  //  Team: watch and run orders. Supervisor: + the day-to-day critical decisions. Admin: + edit, delete, store settlement, period closing.
  //  Super admin keeps commissions, business settings, approvals and the audit trail. Copied on creation, editable per person.
  {
    key: 'OPS_TEAM',
    nameEn: 'Operations team',
    nameAr: 'فريق التشغيل',
    descriptionEn: 'Watch orders and act on them: accept/prepare/ready on a store’s behalf, handle unavailable items, assign drivers; watch drivers (live fleet) and stores. No cancelling, refunds, money, editing or deleting.',
    descriptionAr: 'متابعة الطلبات وتنفيذها: القبول/التحضير/الجاهزية نيابة عن المتجر، الأصناف غير المتاحة، إسناد السائقين؛ متابعة السائقين والمتاجر. بدون إلغاء أو استرداد أو أموال أو تعديل أو حذف.',
    permissions: [P.VIEW_ORDERS, P.MANAGE_ORDER_FULFILMENT, P.ASSIGN_REASSIGN_ORDERS, P.FLEET_VIEW, P.VENDORS_VIEW, P.CATALOG_VIEW, P.VIEW_CUSTOMERS],
  },
  {
    key: 'OPS_SUPERVISOR',
    nameEn: 'Operations supervisor',
    nameAr: 'مشرف التشغيل',
    descriptionEn: 'Everything the team does, plus the daily critical decisions: cancel orders and order issues, refunds, transfer checks, driver shift closing, driver cash in hand, open/close stores, take drivers offline, dispatch overrides, customer contact details, reports, and the team’s accounts (no deleting).',
    descriptionAr: 'كل ما يفعله فريق التشغيل، بالإضافة إلى القرارات اليومية الحرجة: إلغاء الطلبات ومشكلاتها، الاسترداد، مراجعة التحويلات، تقفيل ورديات السائقين، النقدية مع السائق، فتح/غلق المتاجر، إيقاف السائقين، تجاوز الإسناد، بيانات تواصل العملاء، التقارير، وحسابات الفريق (بدون حذف).',
    permissions: [
      P.VIEW_ORDERS, P.MANAGE_ORDER_FULFILMENT, P.ASSIGN_REASSIGN_ORDERS, P.FLEET_VIEW, P.VENDORS_VIEW, P.CATALOG_VIEW, P.VIEW_CUSTOMERS,
      P.MANAGE_ORDER_ISSUES, P.VERIFY_MANUAL_PAYMENTS, P.CLOSE_DRIVER_SETTLEMENTS, P.VIEW_DRIVER_SETTLEMENTS, P.MANAGE_CUSTOMER_WALLET,
      P.OPEN_CLOSE_VENDOR_BRANCHES, P.CHANGE_DRIVER_ONLINE_STATUS, P.OVERRIDE_DISPATCH, P.VIEW_CUSTOMER_PII, P.VIEW_REPORTS,
      P.ORDERS_EXPORT, P.FLEET_EXPORT, P.MANAGE_STAFF_ACCOUNTS,
    ],
  },
  {
    key: 'ADMIN_GENERAL',
    nameEn: 'Admin (general)',
    nameAr: 'مدير (عام)',
    descriptionEn: 'Everything the supervisor does, plus: create, edit and delete stores, menus, zones, offers, drivers and store staff; store settlements and monthly period closing; financial views. Commissions, settings, approvals and the audit trail stay with the super admin.',
    descriptionAr: 'كل ما يفعله المشرف، بالإضافة إلى: إنشاء وتعديل وحذف المتاجر والفروع والمنيو والأقسام والمناطق والعروض والبنرات والسائقين وموظفي المتاجر؛ دفعات تسوية المتاجر وتقفيل الفترة (الشهري)؛ العملاء؛ العرض المالي. العمولات وإعدادات العمل والاعتمادات وسجل التدقيق تبقى مع المدير العام.',
    permissions: [
      P.VIEW_ORDERS, P.MANAGE_ORDER_FULFILMENT, P.ASSIGN_REASSIGN_ORDERS, P.FLEET_VIEW, P.VENDORS_VIEW, P.CATALOG_VIEW, P.VIEW_CUSTOMERS,
      P.MANAGE_ORDER_ISSUES, P.VERIFY_MANUAL_PAYMENTS, P.CLOSE_DRIVER_SETTLEMENTS, P.VIEW_DRIVER_SETTLEMENTS, P.MANAGE_CUSTOMER_WALLET,
      P.OPEN_CLOSE_VENDOR_BRANCHES, P.CHANGE_DRIVER_ONLINE_STATUS, P.OVERRIDE_DISPATCH, P.VIEW_CUSTOMER_PII, P.VIEW_REPORTS,
      P.ORDERS_EXPORT, P.FLEET_EXPORT, P.MANAGE_STAFF_ACCOUNTS,
      P.DELETE_RECORDS, P.MANAGE_VENDORS, P.MANAGE_VENDOR_STAFF, P.MANAGE_CATALOG, P.MANAGE_MARKETPLACE_SECTORS, P.MANAGE_SERVICE_AREAS,
      P.MANAGE_VEHICLE_TYPES, P.MANAGE_DRIVERS, P.MANAGE_DRIVER_VENDOR_PREFERENCES, P.MANAGE_OFFERS, P.MANAGE_HOME_BANNERS, P.MARKETING_VIEW,
      P.MANAGE_MEDIA, P.MEDIA_VIEW, P.CONFIG_VIEW, P.MANAGE_CUSTOMERS, P.MODERATE_REVIEWS,
      P.CLOSE_VENDOR_SETTLEMENTS, P.MANAGE_SETTLEMENT_PAYMENTS, P.VIEW_VENDOR_FINANCIAL_REPORTS, P.VIEW_FINANCIALS,
      P.VIEW_SYSTEM_HEALTH, P.CATALOG_EXPORT, P.REPORTS_EXPORT, P.FINANCE_EXPORT,
    ],
  },
  {
    key: 'READ_ONLY',
    nameEn: 'Read-only',
    nameAr: 'للقراءة فقط',
    descriptionEn: 'View operational pages. No money, no personal data, no exports, no changes.',
    descriptionAr: 'عرض الصفحات التشغيلية. بدون بيانات مالية أو شخصية أو تصدير أو تعديل.',
    permissions: [P.VIEW_ORDERS, P.VIEW_CUSTOMERS, P.VIEW_REPORTS, P.CATALOG_VIEW, P.VENDORS_VIEW, P.FLEET_VIEW, P.MARKETING_VIEW, P.CONFIG_VIEW, P.MEDIA_VIEW, P.VIEW_SYSTEM_HEALTH],
  },
];

const ALL = new Set<string>(Object.values(Permission));

@Injectable()
export class PermissionTemplatesService implements OnModuleInit {
  private readonly logger = new Logger(PermissionTemplatesService.name);

  constructor(
    private readonly ds: DataSource,
    private readonly permissions: PermissionsService,
  ) {}

  /** System templates are code-defined: re-synced on start (idempotent upsert). Users are never touched. */
  async onModuleInit(): Promise<void> {
    try {
      for (const t of SYSTEM_TEMPLATES) {
        if (t.descriptionEn.length > 300 || t.descriptionAr.length > 300) this.logger.warn(`System template ${t.key}: description longer than 300 characters.`);
        await this.ds.query(
          `INSERT INTO permission_templates (key, name_en, name_ar, description_en, description_ar, is_system, permissions)
           VALUES ($1, $2, $3, $4, $5, true, $6)
           ON CONFLICT (key) DO UPDATE SET name_en = EXCLUDED.name_en, name_ar = EXCLUDED.name_ar, description_en = EXCLUDED.description_en,
             description_ar = EXCLUDED.description_ar, permissions = EXCLUDED.permissions, updated_at = now()
           WHERE permission_templates.is_system`,
          [t.key, t.nameEn, t.nameAr, t.descriptionEn, t.descriptionAr, t.permissions],
        );
      }
    } catch (error) {
      // Never block application start (e.g. the migration has not run yet on a fresh database that is mid-setup).
      this.logger.warn(`Could not sync system permission templates: ${(error as Error).message}`);
    }
  }

  async list() {
    const rows = await this.ds.query(`SELECT * FROM permission_templates ORDER BY is_system DESC, name_en`);
    return rows.map((r: any) => this.view(r));
  }

  private view(r: any) {
    return { id: r.id, key: r.key, nameEn: r.name_en, nameAr: r.name_ar, descriptionEn: r.description_en, descriptionAr: r.description_ar, isSystem: r.is_system, permissions: r.permissions, updatedAt: r.updated_at };
  }

  private assertCatalogue(permissions: string[]): void {
    const unknown = permissions.filter((p) => !ALL.has(p));
    if (unknown.length > 0) throw new BadRequestException({ message: `Unknown permission(s): ${unknown.join(', ')}.`, details: { code: 'UNKNOWN_PERMISSION' } });
  }

  async create(input: { key: string; nameEn: string; nameAr: string; permissions: string[] }, actorId: string) {
    if (!/^[A-Z][A-Z0-9_]{1,38}$/.test(input.key)) throw new BadRequestException({ message: 'key must be UPPER_SNAKE_CASE (2–39 characters).', details: { code: 'VALIDATION_FAILED' } });
    this.assertCatalogue(input.permissions);
    try {
      const [row] = await this.ds.query(
        `INSERT INTO permission_templates (key, name_en, name_ar, is_system, permissions, created_by_user_id) VALUES ($1,$2,$3,false,$4,$5) RETURNING *`,
        [input.key, input.nameEn, input.nameAr, [...new Set(input.permissions)], actorId],
      );
      return this.view(row);
    } catch (error: any) {
      if (error?.code === '23505') throw new ConflictException({ message: 'A template with this key already exists.', details: { code: 'TEMPLATE_KEY_EXISTS' } });
      throw error;
    }
  }

  async update(id: string, input: { nameEn?: string; nameAr?: string; permissions?: string[] }) {
    const [existing] = await this.ds.query(`SELECT * FROM permission_templates WHERE id = $1`, [id]);
    if (!existing) throw new NotFoundException('Template not found.');
    if (existing.is_system) throw new ConflictException({ message: 'System templates are defined by the platform and cannot be edited.', details: { code: 'SYSTEM_TEMPLATE_IMMUTABLE' } });
    if (input.permissions) this.assertCatalogue(input.permissions);
    const [row] = returned(
      await this.ds.query(
        `UPDATE permission_templates SET name_en = coalesce($2, name_en), name_ar = coalesce($3, name_ar), permissions = coalesce($4, permissions), updated_at = now() WHERE id = $1 RETURNING *`,
        [id, input.nameEn ?? null, input.nameAr ?? null, input.permissions ? [...new Set(input.permissions)] : null],
      ),
    );
    return this.view(row);
  }

  async remove(id: string): Promise<void> {
    const [existing] = await this.ds.query(`SELECT is_system FROM permission_templates WHERE id = $1`, [id]);
    if (!existing) throw new NotFoundException('Template not found.');
    if (existing.is_system) throw new ConflictException({ message: 'System templates cannot be deleted.', details: { code: 'SYSTEM_TEMPLATE_IMMUTABLE' } });
    await this.ds.query(`DELETE FROM permission_templates WHERE id = $1`, [id]);
  }

  /** ADD grants the template's permissions on top of the user's; REPLACE makes the user's grants exactly the template's. Returns the diff. */
  async apply(userId: string, templateId: string, mode: 'ADD' | 'REPLACE', actorId: string) {
    const [template] = await this.ds.query(`SELECT * FROM permission_templates WHERE id = $1`, [templateId]);
    if (!template) throw new NotFoundException('Template not found.');
    const current = new Set<string>(await this.permissions.listPermissions(userId));
    const target = new Set<string>(template.permissions);
    const added: string[] = [];
    const removed: string[] = [];
    for (const p of target) {
      if (!current.has(p)) {
        await this.permissions.grant(userId, p as Permission, actorId);
        added.push(p);
      }
    }
    if (mode === 'REPLACE') {
      for (const p of current) {
        if (!target.has(p)) {
          await this.permissions.revoke(userId, p as Permission);
          removed.push(p);
        }
      }
    }
    return { template: template.key, mode, added, removed };
  }
}
