import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { QueryFailedError } from 'typeorm';
import { Favorite } from './entities/favorite.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { VendorBranch } from '../vendors/entities/vendor-branch.entity';

export interface FavoriteVendorView {
  vendorId: string;
  /** Resolvable branch route for opening a favorited vendor; null when no active branch exists. */
  branchId: string | null;
  name: string;
  nameAr: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  isActive: boolean;
  favoritedAt: Date;
}

/**
 * Favorites Chunk 1 — Vendor-based only. Every method here is scoped
 * to the calling customerId; there is no method that can read or
 * mutate another customer's Favorite by construction (customerId is
 * always part of the WHERE clause, never trusted from elsewhere).
 */
@Injectable()
export class FavoritesService {
  constructor(
    @InjectRepository(Favorite) private readonly favoritesRepository: Repository<Favorite>,
    @InjectRepository(Vendor) private readonly vendorRepository: Repository<Vendor>,
    @InjectRepository(VendorBranch) private readonly branchesRepository: Repository<VendorBranch>,
  ) {}

  /**
   * Idempotent by construction: a duplicate POST for an already-
   * favorited Vendor must not create a second row and must not
   * surface a server error. The composite UNIQUE constraint
   * (customer_id, vendor_id) — not a `findOne()` pre-check — is the
   * actual protection against a race between two simultaneous
   * requests; the pre-check below is only a fast path for the common
   * non-racing case, and the catch block is what makes a genuine race
   * safe.
   */
  async create(customerId: string, vendorId: string): Promise<void> {
    // Repository's established Vendor lookup semantics: TypeORM's
    // default `findOne` already excludes soft-deleted rows (the
    // `@DeleteDateColumn` on BaseEntity), so this naturally rejects a
    // soft-deleted Vendor the same way every other Vendor lookup in
    // this codebase already does — no new status system invented.
    const vendor = await this.vendorRepository.findOne({ where: { id: vendorId } });
    if (!vendor) {
      throw new NotFoundException('Vendor not found.');
    }

    const existing = await this.favoritesRepository.findOne({ where: { customerId, vendorId } });
    if (existing) {
      return;
    }

    try {
      await this.favoritesRepository.insert({ customerId, vendorId });
    } catch (error) {
      // A genuine race: two concurrent POSTs both passed the
      // existence pre-check above before either committed. The
      // database's own UNIQUE constraint is what actually prevents
      // the duplicate row here — this catch turns that constraint
      // violation into the same idempotent success the non-racing
      // path already returns, never a raw database error surfaced to
      // the customer.
      if (error instanceof QueryFailedError && (error as any).code === '23505') {
        return;
      }
      throw error;
    }
  }

  /**
   * Idempotent by construction: deleting a Favorite that doesn't
   * exist (already removed, or never existed) is a safe no-op — never
   * a 404. Scoped to (customerId, vendorId) together, so a customer
   * can never delete another customer's Favorite even if they somehow
   * knew its vendorId.
   *
   * HARD DELETE — CONFIRMED deliberate deviation from this project's
   * usual soft-delete convention (see Favorite entity's own doc
   * comment): `.delete()`, never `.softDelete()`/`.softRemove()`, so
   * re-favoriting the same Vendor afterward inserts a genuinely fresh
   * row, not a restore of a soft-deleted one.
   */
  async remove(customerId: string, vendorId: string): Promise<void> {
    await this.favoritesRepository.delete({ customerId, vendorId });
  }

  /**
   * Vendor availability/active state is read live via the join below
   * — never denormalized/snapshotted onto the Favorite row itself
   * (per the approved design). No pagination in V1, matching Saved
   * Addresses' own precedent for a small, personal list. Single
   * query with a join — no N+1 per favorited Vendor.
   */
  async listForCustomer(customerId: string): Promise<FavoriteVendorView[]> {
    const favorites = await this.favoritesRepository
      .createQueryBuilder('favorite')
      .innerJoinAndSelect('favorite.vendor', 'vendor')
      .where('favorite.customerId = :customerId', { customerId })
      .orderBy('favorite.createdAt', 'DESC')
      .getMany();

    if (favorites.length === 0) return [];
    // Favorites are vendor-level, but the store details route is branch-level.
    // Resolve a deterministic active branch in one batched query (no N+1).
    const branches = await this.branchesRepository.find({
      where: { vendorId: In(favorites.map((f) => f.vendorId)), isActive: true },
      select: { id: true, vendorId: true },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    const firstBranch = new Map<string, string>();
    for (const b of branches) if (!firstBranch.has(b.vendorId)) firstBranch.set(b.vendorId, b.id);
    return favorites.map((favorite) => ({
      vendorId: favorite.vendorId,
      branchId: firstBranch.get(favorite.vendorId) ?? null,
      name: favorite.vendor.name,
      nameAr: favorite.vendor.nameAr ?? null,
      logoUrl: favorite.vendor.logoUrl ?? null,
      coverImageUrl: favorite.vendor.coverImageUrl ?? null,
      isActive: favorite.vendor.isActive,
      favoritedAt: favorite.createdAt,
    }));
  }
}
