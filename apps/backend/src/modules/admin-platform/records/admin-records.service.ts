import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { DataSource, EntityManager } from 'typeorm';
import { RefreshTokenStore } from '../../auth/refresh-token.store';
import { returned } from '../common/platform-sql';

/** An order still being worked on (not delivered, collected, cancelled or failed). Same list as VendorBusinessService. */
const TERMINAL_ORDER = `('CANCELLED','DELIVERED','COLLECTED','FAILED_DELIVERY')`;

export type DeletableKind =
  | 'vendor'
  | 'branch'
  | 'product'
  | 'product-category'
  | 'sector'
  | 'subcategory'
  | 'offer'
  | 'service-area'
  | 'vehicle-type'
  | 'driver'
  | 'vendor-staff';

export interface DeleteResult {
  kind: DeletableKind;
  id: string;
  /** What else was switched off with it (e.g. a store's branches and products). */
  alsoRemoved: Record<string, number>;
}

function blocked(message: string, code: string, details: Record<string, unknown> = {}): never {
  throw new ConflictException({ message, details: { code, ...details } });
}

/**
 * Safe delete for the admin panel (owner request 2026-11-21: "delete and edit are more important" than activate/deactivate).
 *
 * Every delete here is a SOFT delete: the row gets `deleted_at` AND is switched off (`is_active = false` / unavailable / closed), so
 *  - it disappears from every admin list (TypeORM repositories skip `deleted_at` rows) and from every customer screen (all customer
 *    queries already require the active flags);
 *  - history is untouched: old orders, settlements, ratings and the audit log still point at the same row, and every money figure
 *    stays exactly as recorded;
 *  - a delete that would break something live is REFUSED with a plain reason instead (e.g. a store with orders still in progress, a
 *    category that still holds products, a service area that still has stores). The admin fixes that first, then deletes.
 * All deletes run in one transaction each.
 */
@Injectable()
export class AdminRecordsService {
  constructor(
    private readonly ds: DataSource,
    private readonly sessions: RefreshTokenStore,
  ) {}

  async remove(kind: DeletableKind, id: string): Promise<DeleteResult> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new BadRequestException('Invalid id.');
    const usersToSignOut: string[] = [];
    const alsoRemoved = await this.ds.transaction(async (m) => {
      switch (kind) {
        case 'vendor':
          return this.removeVendor(m, id, usersToSignOut);
        case 'branch':
          return this.removeBranch(m, id, usersToSignOut);
        case 'product':
          return this.removeProduct(m, id);
        case 'product-category':
          return this.removeProductCategory(m, id);
        case 'sector':
          return this.removeSector(m, id);
        case 'subcategory':
          return this.removeSubcategory(m, id);
        case 'offer':
          return this.removeOffer(m, id);
        case 'service-area':
          return this.removeServiceArea(m, id);
        case 'vehicle-type':
          return this.removeVehicleType(m, id);
        case 'driver':
          return this.removeDriver(m, id, usersToSignOut);
        case 'vendor-staff':
          return this.removeVendorStaff(m, id, usersToSignOut);
      }
    });
    for (const userId of usersToSignOut) await this.sessions.revoke(userId);
    return { kind, id, alsoRemoved };
  }

  // ------------------------------------------------------------------ stores

  private async removeVendor(m: EntityManager, id: string, signOut: string[]): Promise<Record<string, number>> {
    await this.mustExist(m, 'vendors', id, 'Store not found.');
    const branches: Array<{ id: string }> = await m.query(`SELECT id FROM vendor_branches WHERE vendor_id = $1 AND deleted_at IS NULL`, [id]);
    await this.assertNoLiveOrders(m, branches.map((b) => b.id));
    const totals: Record<string, number> = { branches: 0, products: 0, categories: 0, offers: 0, staff: 0 };
    for (const b of branches) {
      const r = await this.cascadeBranch(m, b.id, signOut);
      totals.branches += 1;
      for (const k of ['products', 'categories', 'offers', 'staff']) totals[k] += r[k];
    }
    await m.query(`UPDATE vendors SET is_active = false, deleted_at = now(), updated_at = now() WHERE id = $1`, [id]);
    await m.query(`DELETE FROM favorites WHERE vendor_id = $1`, [id]);
    return totals;
  }

  private async removeBranch(m: EntityManager, id: string, signOut: string[]): Promise<Record<string, number>> {
    await this.mustExist(m, 'vendor_branches', id, 'Branch not found.');
    await this.assertNoLiveOrders(m, [id]);
    return this.cascadeBranch(m, id, signOut);
  }

  /** Switches a branch off with everything that only exists for it: its menu, categories, offers and the staff who work only there. */
  private async cascadeBranch(m: EntityManager, branchId: string, signOut: string[]): Promise<Record<string, number>> {
    const products = returned(await m.query(`UPDATE products SET is_available = false, deleted_at = now(), updated_at = now() WHERE vendor_branch_id = $1 AND deleted_at IS NULL RETURNING id`, [branchId]));
    const productIds = products.map((p: { id: string }) => p.id);
    if (productIds.length > 0) await this.removeFromCarts(m, productIds);
    const categories = returned(await m.query(`UPDATE product_categories SET is_active = false, deleted_at = now(), updated_at = now() WHERE vendor_branch_id = $1 AND deleted_at IS NULL RETURNING id`, [branchId]));
    const offers = returned(await m.query(`UPDATE offers SET is_active = false, deleted_at = now(), updated_at = now() WHERE vendor_branch_id = $1 AND deleted_at IS NULL RETURNING id`, [branchId]));
    const staff: Array<{ user_id: string }> = returned(await m.query(`UPDATE vendor_staff SET deleted_at = now(), updated_at = now() WHERE vendor_branch_id = $1 AND deleted_at IS NULL RETURNING user_id`, [branchId]));
    let staffOff = 0;
    for (const s of staff) {
      // Only switch the person off when this was their last branch.
      const [other] = await m.query(`SELECT 1 FROM vendor_staff WHERE user_id = $1 AND deleted_at IS NULL LIMIT 1`, [s.user_id]);
      if (!other) {
        await m.query(`UPDATE users SET is_active = false, updated_at = now() WHERE id = $1`, [s.user_id]);
        signOut.push(s.user_id);
        staffOff += 1;
      }
    }
    // Open carts lose this store (its cart lines go with it — ON DELETE CASCADE); placed orders are untouched.
    await m.query(`DELETE FROM cart_vendor_groups WHERE vendor_branch_id = $1`, [branchId]);
    await m.query(`UPDATE vendor_branches SET is_active = false, is_open = false, deleted_at = now(), updated_at = now() WHERE id = $1`, [branchId]);
    return { products: productIds.length, categories: categories.length, offers: offers.length, staff: staffOff };
  }

  private async assertNoLiveOrders(m: EntityManager, branchIds: string[]): Promise<void> {
    if (branchIds.length === 0) return;
    const [row] = await m.query(
      `SELECT count(DISTINCT o.id)::int AS n FROM order_vendor_segments s JOIN orders o ON o.id = s.order_id
        WHERE s.vendor_branch_id = ANY($1::uuid[]) AND s.status <> 'CANCELLED' AND o.status NOT IN ${TERMINAL_ORDER} AND o.deleted_at IS NULL`,
      [branchIds],
    );
    if (row.n > 0) {
      blocked(`This store has ${row.n} order(s) still in progress. Finish or cancel them first, then delete.`, 'HAS_LIVE_ORDERS', { liveOrders: row.n });
    }
  }

  // ------------------------------------------------------------------ catalogue

  private async removeProduct(m: EntityManager, id: string): Promise<Record<string, number>> {
    await this.mustExist(m, 'products', id, 'Product not found.');
    await m.query(`UPDATE products SET is_available = false, deleted_at = now(), updated_at = now() WHERE id = $1`, [id]);
    await m.query(`UPDATE product_options SET deleted_at = now(), updated_at = now() WHERE product_id = $1 AND deleted_at IS NULL`, [id]);
    const removed = await this.removeFromCarts(m, [id]);
    return { cartLines: removed };
  }

  private async removeProductCategory(m: EntityManager, id: string): Promise<Record<string, number>> {
    await this.mustExist(m, 'product_categories', id, 'Category not found.');
    const [row] = await m.query(`SELECT count(*)::int AS n FROM products WHERE category_id = $1 AND deleted_at IS NULL`, [id]);
    if (row.n > 0) blocked(`This category still has ${row.n} product(s). Move them to another category or delete them first.`, 'CATEGORY_HAS_PRODUCTS', { products: row.n });
    await m.query(`UPDATE product_categories SET is_active = false, deleted_at = now(), updated_at = now() WHERE id = $1`, [id]);
    return {};
  }

  private async removeFromCarts(m: EntityManager, productIds: string[]): Promise<number> {
    const rows: Array<{ id: string; cart_vendor_group_id: string }> = returned(await m.query(`DELETE FROM cart_items WHERE product_id = ANY($1::uuid[]) RETURNING id, cart_vendor_group_id`, [productIds]));
    const groups = [...new Set(rows.map((r) => r.cart_vendor_group_id).filter(Boolean))];
    // A store group left with no lines would show as an empty store in the customer's cart: remove it.
    if (groups.length > 0) {
      await m.query(`DELETE FROM cart_vendor_groups g WHERE g.id = ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM cart_items i WHERE i.cart_vendor_group_id = g.id)`, [groups]);
    }
    return rows.length;
  }

  private async removeSector(m: EntityManager, id: string): Promise<Record<string, number>> {
    await this.mustExist(m, 'marketplace_sectors', id, 'Sector not found.');
    const [b] = await m.query(`SELECT count(*)::int AS n FROM vendor_branches WHERE marketplace_sector_id = $1 AND deleted_at IS NULL`, [id]);
    if (b.n > 0) blocked(`${b.n} store branch(es) are in this section. Move them to another section first.`, 'SECTOR_HAS_BRANCHES', { branches: b.n });
    const subs = returned(await m.query(`UPDATE marketplace_subcategories SET is_active = false, deleted_at = now(), updated_at = now() WHERE sector_id = $1 AND deleted_at IS NULL RETURNING id`, [id]));
    if (subs.length > 0) await m.query(`DELETE FROM vendor_branch_subcategories WHERE subcategory_id = ANY($1::uuid[])`, [subs.map((s: { id: string }) => s.id)]);
    await m.query(`UPDATE marketplace_sectors SET is_active = false, deleted_at = now(), updated_at = now() WHERE id = $1`, [id]);
    return { subcategories: subs.length };
  }

  private async removeSubcategory(m: EntityManager, id: string): Promise<Record<string, number>> {
    await this.mustExist(m, 'marketplace_subcategories', id, 'Subcategory not found.');
    const links = returned(await m.query(`DELETE FROM vendor_branch_subcategories WHERE subcategory_id = $1 RETURNING subcategory_id`, [id]));
    await m.query(`UPDATE marketplace_subcategories SET is_active = false, deleted_at = now(), updated_at = now() WHERE id = $1`, [id]);
    return { branchLinks: links.length };
  }

  private async removeOffer(m: EntityManager, id: string): Promise<Record<string, number>> {
    await this.mustExist(m, 'offers', id, 'Offer not found.');
    // Orders that already used the offer keep their recorded discount (offer_consumptions and order totals are history).
    await m.query(`UPDATE offers SET is_active = false, deleted_at = now(), updated_at = now() WHERE id = $1`, [id]);
    return {};
  }

  // ------------------------------------------------------------------ delivery

  private async removeServiceArea(m: EntityManager, id: string): Promise<Record<string, number>> {
    await this.mustExist(m, 'service_areas', id, 'Service area not found.');
    const [b] = await m.query(`SELECT count(*)::int AS n FROM vendor_branches WHERE service_area_id = $1 AND deleted_at IS NULL`, [id]);
    if (b.n > 0) blocked(`${b.n} store branch(es) are in this service area. Move or delete them first.`, 'SERVICE_AREA_HAS_BRANCHES', { branches: b.n });
    const [z] = await m.query(`SELECT count(*)::int AS n FROM delivery_zones WHERE service_area_id = $1 AND deleted_at IS NULL`, [id]);
    if (z.n > 0) blocked(`This service area still has ${z.n} delivery zone(s). Delete them first.`, 'SERVICE_AREA_HAS_ZONES', { zones: z.n });
    await m.query(`UPDATE service_areas SET is_active = false, deleted_at = now(), updated_at = now() WHERE id = $1`, [id]);
    return {};
  }

  private async removeVehicleType(m: EntityManager, id: string): Promise<Record<string, number>> {
    await this.mustExist(m, 'vehicle_types', id, 'Vehicle type not found.');
    const [d] = await m.query(`SELECT count(*)::int AS n FROM drivers WHERE vehicle_type_id = $1 AND deleted_at IS NULL`, [id]);
    if (d.n > 0) blocked(`${d.n} driver(s) use this vehicle type. Change their vehicle type first.`, 'VEHICLE_TYPE_IN_USE', { drivers: d.n });
    await m.query(`UPDATE vehicle_types SET is_active = false, deleted_at = now(), updated_at = now() WHERE id = $1`, [id]);
    return {};
  }

  private async removeDriver(m: EntityManager, id: string, signOut: string[]): Promise<Record<string, number>> {
    const [driver] = await m.query(`SELECT id, user_id FROM drivers WHERE id = $1 AND deleted_at IS NULL`, [id]);
    if (!driver) throw new NotFoundException('Driver not found.');
    const [live] = await m.query(
      `SELECT count(*)::int AS n FROM deliveries d JOIN orders o ON o.id = d.order_id
        WHERE d.driver_id = $1 AND d.deleted_at IS NULL AND o.status NOT IN ${TERMINAL_ORDER}`,
      [id],
    );
    if (live.n > 0) blocked(`This driver has ${live.n} delivery(ies) in progress. Reassign them first.`, 'DRIVER_HAS_LIVE_DELIVERIES', { deliveries: live.n });
    await m.query(`UPDATE drivers SET is_available = false, deleted_at = now(), updated_at = now() WHERE id = $1`, [id]);
    await this.releaseUser(m, driver.user_id);
    signOut.push(driver.user_id);
    return {};
  }

  /** `id` is the vendor_staff row id (what the Vendor Staff list shows). The person is removed from ALL branches and signed out. */
  private async removeVendorStaff(m: EntityManager, id: string, signOut: string[]): Promise<Record<string, number>> {
    const [row] = await m.query(`SELECT user_id FROM vendor_staff WHERE id = $1 AND deleted_at IS NULL`, [id]);
    if (!row) throw new NotFoundException('Vendor staff member not found.');
    const rows = returned(await m.query(`UPDATE vendor_staff SET deleted_at = now(), updated_at = now() WHERE user_id = $1 AND deleted_at IS NULL RETURNING id`, [row.user_id]));
    await this.releaseUser(m, row.user_id);
    signOut.push(row.user_id);
    return { branches: rows.length };
  }

  // ------------------------------------------------------------------ edit people (drivers, store staff)

  /** Edit a driver's name / sign-in phone. A phone change ends the driver's session (they sign in again with the new number). */
  async editDriver(id: string, input: { fullName?: string; phone?: string }): Promise<{ id: string; fullName: string; phone: string }> {
    const [driver] = await this.ds.query(`SELECT user_id FROM drivers WHERE id = $1 AND deleted_at IS NULL`, [id]);
    if (!driver) throw new NotFoundException('Driver not found.');
    return this.editPerson(driver.user_id, input, id);
  }

  /**
   * Sets a new sign-in password for a driver (by drivers row id) or a store staff member (by vendor_staff row id) — for someone who
   * forgot theirs (there is no SMS reset yet). Every open session ends, so only the new password works from now on. 8–128 characters,
   * like the password the account was created with.
   */
  async resetPersonPassword(kind: 'driver' | 'vendor-staff', id: string, newPassword: string): Promise<void> {
    if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128) {
      throw new BadRequestException({ message: 'The new password must be 8–128 characters.', details: { code: 'WEAK_PASSWORD' } });
    }
    const table = kind === 'driver' ? 'drivers' : 'vendor_staff';
    const [row] = await this.ds.query(`SELECT user_id FROM ${table} WHERE id = $1 AND deleted_at IS NULL`, [id]);
    if (!row) throw new NotFoundException(kind === 'driver' ? 'Driver not found.' : 'Vendor staff member not found.');
    await this.ds.query(`UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`, [row.user_id, await bcrypt.hash(newPassword, 10)]);
    await this.sessions.revoke(row.user_id);
  }

  /** Edit a store staff member (by vendor_staff row id): name, sign-in phone, and manager/operator role. */
  async editVendorStaff(id: string, input: { fullName?: string; phone?: string; role?: 'VENDOR' | 'VENDOR_MANAGER' }): Promise<{ id: string; fullName: string; phone: string }> {
    const [row] = await this.ds.query(`SELECT user_id FROM vendor_staff WHERE id = $1 AND deleted_at IS NULL`, [id]);
    if (!row) throw new NotFoundException('Vendor staff member not found.');
    if (input.role) {
      await this.ds.query(`UPDATE users SET role = $2, updated_at = now() WHERE id = $1 AND role IN ('VENDOR','VENDOR_MANAGER')`, [row.user_id, input.role]);
      await this.sessions.revoke(row.user_id); // the role is in the token: sign in again to pick it up
    }
    return this.editPerson(row.user_id, input, id);
  }

  private async editPerson(userId: string, input: { fullName?: string; phone?: string }, viewId: string) {
    if (input.phone) {
      const [taken] = await this.ds.query(`SELECT 1 FROM users WHERE phone = $1 AND id <> $2 LIMIT 1`, [input.phone, userId]);
      if (taken) blocked('An account with this phone number already exists.', 'PHONE_IN_USE');
    }
    const [user] = returned(
      await this.ds.query(
        `UPDATE users SET full_name = coalesce($2, full_name), phone = coalesce($3, phone), updated_at = now() WHERE id = $1 RETURNING full_name, phone`,
        [userId, input.fullName?.trim() || null, input.phone || null],
      ),
    );
    if (input.phone) await this.sessions.revoke(userId);
    return { id: viewId, fullName: user.full_name, phone: user.phone };
  }

  /** Deactivates and soft-deletes a sign-in account and frees its phone number (unique, max 20 characters) for a new account. */
  private async releaseUser(m: EntityManager, userId: string): Promise<void> {
    const releasedPhone = `del-${userId.replace(/-/g, '').slice(0, 16)}`;
    await m.query(`UPDATE users SET is_active = false, phone = $2, deleted_at = now(), updated_at = now() WHERE id = $1`, [userId, releasedPhone]);
  }

  private async mustExist(m: EntityManager, table: string, id: string, message: string): Promise<void> {
    const [row] = await m.query(`SELECT 1 FROM ${table} WHERE id = $1 AND deleted_at IS NULL`, [id]);
    if (!row) throw new NotFoundException(message);
  }
}
