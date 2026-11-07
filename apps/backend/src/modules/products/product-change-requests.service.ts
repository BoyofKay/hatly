import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AdminAuditAction, AdminAuditService } from '../audit/admin-audit.service';
import { StaffAlertsService } from '../notifications/staff-alerts.service';
import { Permission } from '../permissions/permission.enum';
import { VendorStaffAuthorizationService } from '../vendors/vendor-staff-authorization.service';
import { Product } from './entities/product.entity';
import { ProductsService } from './products.service';
import { ProductOptionsService } from './product-options.service';

/**
 * R7 (decision register 2026-11-06) — vendor product governance.
 *
 * - A price REDUCTION applies directly.
 * - A price INCREASE, a NEW product and a change of product details (name, description, category, image, options) need Hatly's approval;
 *   the approved version stays live until then.
 * - Excel and other bulk paths follow the same rule per change and never bypass it.
 * - Inventory, quantity and availability of an approved product stay with the vendor (operational, not a product detail).
 * - Admin's own product paths are Hatly acting, so they apply directly.
 *
 * A NEW product is saved PENDING and unavailable; every customer path already requires `is_available = true`, so it is invisible until
 * Hatly approves it. Detail changes of a live product are merged into ONE pending UPDATE request per product. Option changes of a live
 * product are recorded one per request (OPTIONS) and replayed through the ordinary option service on approval.
 */
export const GATED_PRODUCT_FIELDS = ['name', 'nameAr', 'description', 'descriptionAr', 'categoryId', 'imageUrl'] as const;
const UPDATE_KEYS = [...GATED_PRODUCT_FIELDS, 'priceMinor'] as const;
export const OPTION_OPS = ['CREATE_OPTION', 'UPDATE_OPTION', 'ADD_VALUE', 'UPDATE_VALUE'] as const;
export type OptionOp = (typeof OPTION_OPS)[number];
export type ChangeSource = 'DASHBOARD' | 'EXCEL';
type Actor = { id: string; role: string };
type Current = Pick<Product, 'priceMinor' | 'name' | 'nameAr' | 'description' | 'descriptionAr' | 'categoryId' | 'imageUrl'>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const blankToNull = (v: unknown) => (v === undefined || v === null || v === '' ? null : v);

/**
 * Splits a vendor's product patch: `direct` applies now (price reductions, inventory, anything that is not a gated detail), `gated` waits for
 * Hatly (price increases and changed details). Unchanged values are dropped from both.
 */
export function splitVendorProductPatch(current: Current, patch: Record<string, unknown>): { direct: Record<string, unknown>; gated: Record<string, unknown> } {
  const direct: Record<string, unknown> = {};
  const gated: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (key === 'priceMinor') {
      const next = Number(value);
      const now = Number(current.priceMinor);
      if (next > now) gated.priceMinor = next;
      else if (next !== now) direct.priceMinor = next;
    } else if ((GATED_PRODUCT_FIELDS as readonly string[]).includes(key)) {
      if (blankToNull(value) !== blankToNull((current as Record<string, unknown>)[key])) gated[key] = value;
    } else {
      direct[key] = value;
    }
  }
  return { direct, gated };
}

/** An option-value change that only LOWERS the price modifier (no rename) applies directly; anything else on a live product is reviewed. */
export function isDirectValueChange(currentDeltaMinor: number, dto: { name?: unknown; nameAr?: unknown; priceDeltaMinor?: unknown }): boolean {
  if (dto.name !== undefined || dto.nameAr !== undefined) return false;
  return dto.priceDeltaMinor !== undefined && Number(dto.priceDeltaMinor) <= Number(currentDeltaMinor);
}

@Injectable()
export class ProductChangeRequestsService {
  constructor(
    private readonly ds: DataSource,
    private readonly products: ProductsService,
    private readonly options: ProductOptionsService,
    private readonly vendorAuth: VendorStaffAuthorizationService,
    private readonly audit: AdminAuditService,
    @Optional() private readonly staffAlerts?: StaffAlertsService,
  ) {}

  // ------------------------------------------------------------------------------------------------------------------- submitting (vendor)

  /** A vendor's new product: Hatly reviews it; `isAvailable` is what the vendor wants once approved. */
  async submitNew(m: EntityManager, product: Product, actor: Actor, source: ChangeSource, isAvailable = true): Promise<string> {
    const [row] = await m.query(
      `INSERT INTO product_change_requests (product_id, vendor_branch_id, kind, payload, source, requested_by_user_id)
       VALUES ($1, $2, 'NEW_PRODUCT', $3::jsonb, $4, $5)
       ON CONFLICT ("product_id", "kind") WHERE "status" = 'PENDING' AND "kind" IN ('NEW_PRODUCT','UPDATE') DO UPDATE SET updated_at = now()
       RETURNING id, (xmax = 0) AS inserted`,
      [product.id, product.vendorBranchId, JSON.stringify({ isAvailable }), source, actor.id],
    );
    if (row.inserted) await this.requested(m, row.id, product, 'NEW_PRODUCT', actor);
    return row.id;
  }

  /** Price increases / detail changes of a live product, merged into the product's single pending UPDATE request. */
  async submitUpdate(m: EntityManager, product: Product, gated: Record<string, unknown>, actor: Actor, source: ChangeSource): Promise<string> {
    const clean: Record<string, unknown> = {};
    for (const k of UPDATE_KEYS) if (gated[k] !== undefined) clean[k] = gated[k];
    if (clean.categoryId !== undefined) {
      const [c] = await m.query(`SELECT 1 FROM product_categories WHERE id = $1 AND vendor_branch_id = $2 AND deleted_at IS NULL`, [String(clean.categoryId), product.vendorBranchId]);
      if (!c) throw new BadRequestException({ message: 'This category does not belong to the requested vendor branch.', details: { code: 'CATEGORY_BRANCH_MISMATCH' } });
    }
    const [row] = await m.query(
      `INSERT INTO product_change_requests (product_id, vendor_branch_id, kind, payload, source, requested_by_user_id)
       VALUES ($1, $2, 'UPDATE', $3::jsonb, $4, $5)
       ON CONFLICT ("product_id", "kind") WHERE "status" = 'PENDING' AND "kind" IN ('NEW_PRODUCT','UPDATE')
       DO UPDATE SET payload = product_change_requests.payload || EXCLUDED.payload, source = EXCLUDED.source, requested_by_user_id = EXCLUDED.requested_by_user_id, updated_at = now()
       RETURNING id, (xmax = 0) AS inserted`,
      [product.id, product.vendorBranchId, JSON.stringify(clean), source, actor.id],
    );
    if (row.inserted) await this.requested(m, row.id, product, 'UPDATE', actor);
    return row.id;
  }

  /** One option change of a live product. `ref` is the product (CREATE_OPTION), option (UPDATE_OPTION / ADD_VALUE) or value (UPDATE_VALUE) id. */
  async submitOption(product: Product, op: OptionOp, ref: string, body: Record<string, unknown>, actor: Actor): Promise<string> {
    // Validate now, not at approval: apply the change inside a transaction and roll it back — the vendor sees the same refusal (bad limits,
    // duplicate names, a price below zero) the direct path would give, and Hatly only ever reviews changes that can be applied.
    const DRY_RUN = Symbol('dry-run');
    await this.ds
      .transaction(async (m) => {
        await this.replayOption({ op, ref, body }, m);
        throw DRY_RUN;
      })
      .catch((e) => {
        if (e !== DRY_RUN) throw e;
      });
    return this.ds.transaction(async (m) => {
      const [row] = await m.query(
        `INSERT INTO product_change_requests (product_id, vendor_branch_id, kind, payload, requested_by_user_id) VALUES ($1, $2, 'OPTIONS', $3::jsonb, $4) RETURNING id`,
        [product.id, product.vendorBranchId, JSON.stringify({ op, ref, body }), actor.id],
      );
      await this.requested(m, row.id, product, 'OPTIONS', actor);
      return row.id as string;
    });
  }

  /** While a new product waits, (de)activating it records what the vendor wants once it is approved. */
  async setPendingAvailability(m: EntityManager, productId: string, isAvailable: boolean): Promise<void> {
    await m.query(
      `UPDATE product_change_requests SET payload = payload || $2::jsonb, updated_at = now() WHERE product_id = $1 AND kind = 'NEW_PRODUCT' AND status = 'PENDING'`,
      [productId, JSON.stringify({ isAvailable })],
    );
  }

  async productForOptions(productId: string): Promise<Product> {
    if (!UUID_RE.test(productId ?? '')) throw new NotFoundException('Product not found.');
    return this.products.adminGetProduct(productId);
  }

  /** The product an option / value belongs to (for ownership and approval checks), or 404. */
  async productOfOption(optionId: string): Promise<Product> {
    if (!UUID_RE.test(optionId ?? '')) throw new NotFoundException('Option not found.');
    const [r] = await this.ds.query(`SELECT product_id FROM product_options WHERE id = $1 AND deleted_at IS NULL`, [optionId]);
    if (!r) throw new NotFoundException('Option not found.');
    return this.products.adminGetProduct(r.product_id);
  }

  async valueContext(valueId: string): Promise<{ product: Product; priceDeltaMinor: number }> {
    if (!UUID_RE.test(valueId ?? '')) throw new NotFoundException('Option value not found.');
    const [r] = await this.ds.query(
      `SELECT o.product_id, v.price_delta_minor FROM product_option_values v JOIN product_options o ON o.id = v.option_id WHERE v.id = $1 AND v.deleted_at IS NULL AND o.deleted_at IS NULL`,
      [valueId],
    );
    if (!r) throw new NotFoundException('Option value not found.');
    return { product: await this.products.adminGetProduct(r.product_id), priceDeltaMinor: Number(r.price_delta_minor) };
  }

  // ------------------------------------------------------------------------------------------------------------------------ vendor side
  async vendorList(user: Actor, branchId?: string) {
    const owned = await this.vendorAuth.getOwnedBranchIds(user.id);
    const branches = branchId ? owned.filter((b) => b === branchId) : owned;
    if (branches.length === 0) return [];
    return (await this.rows(`r.vendor_branch_id = ANY($1)`, [branches], 100)).map((r) => this.view(r));
  }

  async view1(id: string) {
    const [r] = await this.rows(`r.id = $1`, [id]);
    return r ? this.view(r) : null;
  }

  async withdraw(user: Actor, requestId: string) {
    if (!UUID_RE.test(requestId ?? '')) throw new NotFoundException('Request not found.');
    const owned = await this.vendorAuth.getOwnedBranchIds(user.id);
    const [r] = await this.ds.query(`SELECT id, kind, status FROM product_change_requests WHERE id = $1 AND vendor_branch_id = ANY($2)`, [requestId, owned]);
    if (!r) throw new NotFoundException('Request not found.');
    if (r.kind === 'NEW_PRODUCT') throw new ConflictException({ message: 'A new product stays waiting for Hatly; deactivate it instead if you no longer want it live.', details: { code: 'CANNOT_WITHDRAW_NEW_PRODUCT' } });
    const done = await this.ds.query(`UPDATE product_change_requests SET status = 'WITHDRAWN', updated_at = now() WHERE id = $1 AND status = 'PENDING' RETURNING id`, [requestId]);
    if (!this.affected(done)) throw new ConflictException({ message: `This request is already ${r.status}.`, details: { code: 'REQUEST_NOT_PENDING', status: r.status } });
    return { id: requestId, status: 'WITHDRAWN' };
  }

  // ------------------------------------------------------------------------------------------------------------------------- admin side
  async adminList(status?: string) {
    const s = status && ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'].includes(status) ? status : 'PENDING';
    return (await this.rows(`r.status = $1`, [s], 200)).map((r) => this.view(r));
  }

  async approve(admin: Actor, requestId: string, note?: string) {
    await this.ds.transaction(async (m) => {
      const r = await this.lockPending(m, requestId);
      const payload = r.payload ?? {};
      if (r.kind === 'NEW_PRODUCT') {
        await m.query(`UPDATE products SET approval_status = 'APPROVED', is_available = $2, updated_at = now() WHERE id = $1`, [r.product_id, payload.isAvailable !== false]);
      } else if (r.kind === 'UPDATE') {
        const patch: Record<string, unknown> = {};
        for (const k of UPDATE_KEYS) if (payload[k] !== undefined) patch[k] = payload[k];
        await this.products.adminUpdateProduct(r.product_id, patch as never, m);
      } else {
        await this.replayOption(payload as { op: OptionOp; ref: string; body: Record<string, unknown> }, m);
      }
      await this.decide(m, admin, r, 'APPROVED', note);
    });
    return this.view1(requestId);
  }

  async reject(admin: Actor, requestId: string, note?: string) {
    await this.ds.transaction(async (m) => {
      const r = await this.lockPending(m, requestId);
      if (r.kind === 'NEW_PRODUCT') {
        await m.query(`UPDATE products SET approval_status = 'REJECTED', is_available = false, updated_at = now() WHERE id = $1 AND approval_status = 'PENDING'`, [r.product_id]);
      }
      await this.decide(m, admin, r, 'REJECTED', note);
    });
    return this.view1(requestId);
  }

  // -------------------------------------------------------------------------------------------------------------------------- internals
  private async replayOption(p: { op: OptionOp; ref: string; body: Record<string, unknown> }, m?: EntityManager) {
    const any = async () => undefined;
    switch (p.op) {
      case 'CREATE_OPTION': return this.options.createOption(p.ref, p.body as never, any, m);
      case 'UPDATE_OPTION': return this.options.updateOption(p.ref, p.body as never, any, m);
      case 'ADD_VALUE': return this.options.addValue(p.ref, p.body as never, any, m);
      case 'UPDATE_VALUE': return this.options.updateValue(p.ref, p.body as never, any, m);
      default: throw new BadRequestException('Unknown option change.');
    }
  }

  private async lockPending(m: EntityManager, requestId: string) {
    if (!UUID_RE.test(requestId ?? '')) throw new NotFoundException('Request not found.');
    const [r] = await m.query(`SELECT * FROM product_change_requests WHERE id = $1 FOR UPDATE`, [requestId]);
    if (!r) throw new NotFoundException('Request not found.');
    if (r.status !== 'PENDING') throw new ConflictException({ message: `This request is already ${r.status}.`, details: { code: 'REQUEST_NOT_PENDING', status: r.status } });
    return r;
  }

  private async requested(m: EntityManager, id: string, product: Product, kind: string, actor: Actor) {
    await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.PRODUCT_CHANGE_REQUESTED, targetType: 'product', targetId: product.id, metadata: { request: id, kind } } as never);
    if (this.staffAlerts) {
      await this.staffAlerts.alert(m, {
        eventKey: `product-change:${id}:requested`, category: 'OPS_PRODUCT_REVIEW', requiredAction: 'REVIEW_PRODUCT_REQUEST', note: kind,
        recipients: await this.staffAlerts.recipientsHolding(m, [Permission.MANAGE_CATALOG]),
        vendorBranchId: product.vendorBranchId,
      } as Parameters<StaffAlertsService['alert']>[1]);
    }
  }

  private async decide(m: EntityManager, admin: Actor, r: any, status: 'APPROVED' | 'REJECTED', note?: string) {
    const clean = typeof note === 'string' && note.trim() ? note.trim().slice(0, 300) : null;
    await m.query(
      `UPDATE product_change_requests SET status = $2, decided_by_user_id = $3, decided_at = now(), decision_note = $4, updated_at = now() WHERE id = $1`,
      [r.id, status, admin.id, clean],
    );
    await this.audit.record({ actorUserId: admin.id, actorRole: admin.role, action: AdminAuditAction.PRODUCT_CHANGE_DECIDED, targetType: 'product', targetId: r.product_id, metadata: { request: r.id, kind: r.kind, status } } as never);
    if (this.staffAlerts) {
      await this.staffAlerts.alert(m, {
        eventKey: `product-change:${r.id}:${status.toLowerCase()}`, category: 'VENDOR_PRODUCT_REVIEW_DECIDED', note: `${r.kind}:${status}`,
        recipients: await this.staffAlerts.vendorRecipients(m, r.vendor_branch_id),
        vendorBranchId: r.vendor_branch_id,
      } as Parameters<StaffAlertsService['alert']>[1]);
    }
  }

  private affected(result: unknown): boolean {
    return Array.isArray(result) && result.length > 0 && !(Array.isArray(result[0]) && result[0].length === 0);
  }

  private rows(where: string, params: unknown[], limit = 1): Promise<any[]> {
    return this.ds.query(
      `SELECT r.*, p.name AS p_name, p.name_ar AS p_name_ar, p.description AS p_description, p.description_ar AS p_description_ar,
              p.category_id AS p_category_id, p.image_url AS p_image_url, p.price_minor AS p_price_minor, p.approval_status AS p_approval_status,
              p.is_available AS p_is_available, pc.name AS p_category_name,
              (SELECT c.name FROM product_categories c WHERE c.id::text = r.payload->>'categoryId') AS requested_category_name,
              b.name AS branch_name, v.name AS vendor_name, ru.full_name AS requested_by, du.full_name AS decided_by
         FROM product_change_requests r
         JOIN products p ON p.id = r.product_id
         LEFT JOIN product_categories pc ON pc.id = p.category_id
         JOIN vendor_branches b ON b.id = r.vendor_branch_id JOIN vendors v ON v.id = b.vendor_id
         JOIN users ru ON ru.id = r.requested_by_user_id LEFT JOIN users du ON du.id = r.decided_by_user_id
        WHERE ${where} ORDER BY r.created_at DESC LIMIT ${Number(limit)}`,
      params,
    );
  }

  private view(r: any) {
    const current = {
      name: r.p_name, nameAr: r.p_name_ar, description: r.p_description, descriptionAr: r.p_description_ar, categoryId: r.p_category_id,
      categoryName: r.p_category_name, imageUrl: r.p_image_url, priceMinor: Number(r.p_price_minor),
    };
    return {
      id: r.id, productId: r.product_id, productName: r.p_name, approvalStatus: r.p_approval_status, isAvailable: r.p_is_available,
      branchId: r.vendor_branch_id, branchName: r.branch_name, vendorName: r.vendor_name, kind: r.kind, source: r.source,
      payload: { ...(r.payload ?? {}), ...(r.requested_category_name ? { categoryName: r.requested_category_name } : {}) },
      current, status: r.status, requestedBy: r.requested_by, createdAt: r.created_at, updatedAt: r.updated_at,
      decidedBy: r.decided_by ?? null, decidedAt: r.decided_at ?? null, decisionNote: r.decision_note ?? null,
    };
  }
}
