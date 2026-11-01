import { branchIdsUnderClosure, effectiveOpenSql } from '../../common/branch-availability';
import { setStockContext } from '../orders/stock-context';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { sectorAllowsCustomRequests } from '../sectors/entities/marketplace-sector.entity';
import { ProductCategory } from './entities/product-category.entity';
import { Product } from './entities/product.entity';
import { VendorBranch } from '../vendors/entities/vendor-branch.entity';
import { PricingUnit } from './pricing-unit.enum';
import { InventoryMode } from './inventory-mode.enum';
import { resolveInventoryFieldsForUpdate as resolveInventoryFieldsForUpdateShared } from './resolve-inventory-fields';
import { HIGHEST_RATED_MINIMUM_RATING_COUNT } from '../ratings/highest-rated-threshold';
import { resolvePublicCatalogIds } from '../catalog/public-catalog-link';
import {
  ProductSortOption,
  normalizedSearchTerm,
  resolveLimit,
  resolvePage,
} from '../discovery/discovery.constants';
import { CreateProductCategoryDto } from './dto/create-product-category.dto';
import { UpdateProductCategoryDto } from './dto/update-product-category.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

/**
 * L1-B addition. Deliberately does NOT reuse/extend `MarketplaceVendorView`
 * (list-shaped, branch-only fields) — this is a single-entity detail
 * shape with a nested `vendor` object, matching the existing Customer
 * frontend's `VendorDetails`/`VendorProfile`/`VendorBranchSummary`
 * split exactly (see that domain model's own comment for why vendor
 * and branch fields are deliberately kept separate).
 */
export interface VendorBranchDetailsView {
  id: string;
  /** Whether customers may send a custom (free-text / photo) request to this branch — its sector's admin-managed setting. */
  allowsCustomRequests: boolean;
  address: string;
  latitude: number;
  longitude: number;
  isOpen: boolean;
  openingHours: Record<string, { open: string; close: string }>;
  ratingAverage: number;
  ratingCount: number;
  vendor: {
    id: string;
    name: string;
    nameAr: string | null;
    logoUrl: string | null;
  };
}

/**
 * `sort=bestSelling`'s ORDER BY key (see `getProducts`): the delivered count of the product's own unit. Exported so the Home
 * aggregation (home-products module) ranks "most ordered" with exactly the same expression instead of a copy.
 */
export const PRODUCT_BEST_SELLING_ORDER_SQL = `CASE WHEN product.pricing_unit = '${PricingUnit.WEIGHT}' THEN product.delivered_weight_grams_count ELSE product.delivered_quantity_count END`;

export interface ProductListResult {
  data: Product[];
  page: number;
  limit: number;
  total: number;
}

/** Who is changing stock, for the stock ledger (see orders/stock-context.ts). */
export interface StockActor {
  userId: string;
  role: string;
  reason?: 'MANUAL_ADJUSTMENT' | 'IMPORT';
  note?: string;
}

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(ProductCategory)
    private readonly categoriesRepository: Repository<ProductCategory>,
    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
    @InjectRepository(VendorBranch)
    private readonly branchesRepository: Repository<VendorBranch>,
  ) {}

  /**
   * L1-B addition. Public Customer Vendor Details read — resolves a
   * VendorBranch by id, joined with its Vendor, exactly the
   * VendorBranch+Vendor relation pattern already used by
   * `MarketplaceVendorsService`'s own list query (reused conceptually,
   * not copy-pasted, since this is a single-row lookup rather than a
   * filtered/paginated list). `ratingAverage` uses the EXACT SAME
   * formula as that service's own list mapping —
   * `ratingCount > 0 ? ratingSumStars / ratingCount : 0` — never a new
   * formula. CONFIRMED (L1-B design review decision): a direct-by-id
   * lookup does NOT filter on `isActive` for either the branch or the
   * vendor — an inactive entity, if directly requested by a real id,
   * is still returned; no new 404-on-inactive rule is invented here,
   * matching the design review's explicit instruction.
   */
  async getBranchDetails(id: string): Promise<VendorBranchDetailsView> {
    const branch = await this.branchesRepository.findOne({ where: { id }, relations: { vendor: true, marketplaceSector: true } });
    if (!branch) {
      throw new NotFoundException('Vendor branch not found.');
    }

    return {
      id: branch.id,
      // The server's own rule for custom requests (also enforced on the cart endpoint): the app only mirrors it.
      allowsCustomRequests: sectorAllowsCustomRequests(branch.marketplaceSector),
      address: branch.address,
      latitude: branch.latitude,
      longitude: branch.longitude,
      isOpen: branch.isOpen && !(await branchIdsUnderClosure(this.branchesRepository.manager, [branch.id])).has(branch.id),
      openingHours: branch.openingHours,
      ratingAverage: branch.ratingCount > 0 ? branch.ratingSumStars / branch.ratingCount : 0,
      ratingCount: branch.ratingCount,
      vendor: {
        id: branch.vendor.id,
        name: branch.vendor.name,
        nameAr: branch.vendor.nameAr ?? null,
        logoUrl: branch.vendor.logoUrl ?? null,
      },
    };
  }

  getCategories(vendorBranchId: string): Promise<ProductCategory[]> {
    return this.categoriesRepository.find({
      where: { vendorBranchId, isActive: true },
      order: { sortOrder: 'ASC' },
    });
  }

  /**
   * CONFIRMED business decisions (Discovery & Ranking — do not
   * reopen):
   *
   * - `categoryId` (Level 2, Vendor ProductCategory) is ALWAYS
   *   re-validated as belonging to the requested `vendorBranchId` —
   *   never trusted from the client. "A ProductCategory from Branch A
   *   must never appear inside Branch B" (already an existing
   *   guarantee elsewhere in this codebase — Offers' own
   *   `AdminOffersService.create()` does the identical check) is
   *   preserved here, not reopened.
   * - `sort=price_asc`/`price_desc` uses `Product.priceMinor` — the
   *   CURRENT, live catalog price — never `OrderItem.unitPriceMinor`/
   *   `finalAmountMinor`/`estimatedAmountMinor` (historical snapshots)
   *   and never an Offer-discounted price (Offers remains untouched).
   *   For a WEIGHT product this is the nominal per-kilogram price —
   *   the same "unit price" concept Weighted Products itself already
   *   established, never an estimated/final line total.
   * - `sort=bestSelling` reads the derived cache — `deliveredQuantityCount`
   *   for a PIECE product, `deliveredWeightGramsCount` for a WEIGHT
   *   one (see Product entity's own comment) — via a single SQL CASE
   *   expression per row (each row is always exactly one pricing
   *   unit, so this never mixes a PIECE row's count with a WEIGHT
   *   row's grams within the SAME row — it only ranks the two
   *   different measures against each other ACROSS rows, which is an
   *   unavoidable consequence of a single "Best Selling" sort column
   *   spanning a menu that can contain both product types; documented
   *   explicitly, not silently assumed).
   * - `sort=highestRated` uses `Product.ratingSumStars/ratingCount`,
   *   gated by the same `HIGHEST_RATED_MINIMUM_RATING_COUNT` (5) —
   *   never mixed with `VendorBranch` ratings (a completely separate
   *   cache on a completely separate entity).
   * - Search: `name`/`nameAr`, case-insensitive substring, 2-character
   *   minimum — identical contract to `MarketplaceVendorsService`'s
   *   own search, applied to Product instead of Vendor.
   */
  async getProducts(
    vendorBranchId: string,
    params: {
      categoryId?: string;
      sort?: ProductSortOption;
      search?: string;
      page?: number;
      limit?: number;
      /** Filters V1. Real `Product.isAvailable` — missing/false never silently becomes available. */
      availableOnly?: boolean;
      /** Filters V1. Real, currently-in-window `Offer` targeting this product/its category/branch-wide — see `hasActiveOfferForProductSql`. */
      hasOffers?: boolean;
      /** Filters V1. `Product.priceMinor` bounds — inclusive, integer minor units. */
      minPriceMinor?: number;
      maxPriceMinor?: number;
    } = {},
  ): Promise<ProductListResult> {
    if (params.minPriceMinor != null && params.maxPriceMinor != null && params.minPriceMinor > params.maxPriceMinor) {
      throw new BadRequestException({
        message: 'minPriceMinor cannot be greater than maxPriceMinor.',
        details: { code: 'INVALID_PRICE_RANGE' },
      });
    }

    if (params.categoryId) {
      const category = await this.categoriesRepository.findOne({
        where: { id: params.categoryId, vendorBranchId },
      });
      if (!category) {
        throw new BadRequestException({
          message: 'This category does not belong to the requested vendor branch.',
          details: { code: 'CATEGORY_BRANCH_MISMATCH' },
        });
      }
    }

    const page = resolvePage(params.page);
    const limit = resolveLimit(params.limit);
    const searchTerm = normalizedSearchTerm(params.search);

    let qb = this.productsRepository
      .createQueryBuilder('product')
      .where('product.vendor_branch_id = :vendorBranchId', { vendorBranchId });

    if (params.categoryId) {
      qb = qb.andWhere('product.category_id = :categoryId', { categoryId: params.categoryId });
    }

    if (searchTerm) {
      qb = qb.andWhere('(product.name ILIKE :term OR product.name_ar ILIKE :term)', { term: `%${searchTerm}%` });
    }

    // Filters V1 additions — all additive, all optional, all real data.
    if (params.availableOnly) {
      qb = qb.andWhere('product.is_available = true');
    }
    if (params.hasOffers) {
      qb = qb.andWhere(hasActiveOfferForProductSql());
    }
    if (params.minPriceMinor != null) {
      qb = qb.andWhere('product.price_minor >= :minPriceMinor', { minPriceMinor: params.minPriceMinor });
    }
    if (params.maxPriceMinor != null) {
      qb = qb.andWhere('product.price_minor <= :maxPriceMinor', { maxPriceMinor: params.maxPriceMinor });
    }

    switch (params.sort) {
      case 'price_asc':
        qb = qb.orderBy('product.price_minor', 'ASC').addOrderBy('product.id', 'ASC');
        break;
      case 'price_desc':
        qb = qb.orderBy('product.price_minor', 'DESC').addOrderBy('product.id', 'ASC');
        break;
      case 'offers':
        // Filters V1. Same "raw ORDER BY expression, no addSelect needed" reasoning as
        // MarketplaceVendorsService's own `sort=offers` — see that file's comment.
        qb = qb.orderBy(hasActiveOfferForProductSql(), 'DESC').addOrderBy('product.created_at', 'DESC').addOrderBy('product.id', 'ASC');
        break;
      case 'bestSelling':
        qb = qb
          .orderBy(
            PRODUCT_BEST_SELLING_ORDER_SQL,
            'DESC',
          )
          .addOrderBy('product.id', 'ASC');
        break;
      case 'highestRated':
        qb = qb
          .andWhere('product.rating_count >= :minRatings', { minRatings: HIGHEST_RATED_MINIMUM_RATING_COUNT })
          .orderBy('(product.rating_sum_stars::float / product.rating_count)', 'DESC')
          .addOrderBy('product.rating_count', 'DESC')
          .addOrderBy('product.created_at', 'DESC')
          .addOrderBy('product.id', 'ASC');
        break;
      default:
        qb = qb.orderBy('product.created_at', 'DESC').addOrderBy('product.id', 'ASC');
    }

    const [data, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { data, page, limit, total };
  }

  /**
   * Extra, ADDITIVE public fields for `GET /products/:id`: the marketplace product identity (only when the
   * catalog product is active — otherwise null, exactly like an unlinked listing) and a small vendor
   * summary. Two small queries; the product entity itself is returned untouched, so no relation (and none
   * of the branch's internal columns) leaks into the existing response.
   */
  async getPublicExtras(product: Product): Promise<{
    catalogProductId: string | null;
    vendor: {
      id: string;
      vendorBranchId: string;
      name: string;
      nameAr: string | null;
      logoUrl: string | null;
      branchName: string;
      isOpen: boolean;
      ratingAverage: number;
      ratingCount: number;
    } | null;
  }> {
    const manager = this.productsRepository.manager;
    const [catalogIds, rows] = await Promise.all([
      resolvePublicCatalogIds(manager, [product.id]),
      manager.query(
        `SELECT b.id AS branch_id, b.name AS branch_name, ${effectiveOpenSql('b')} AS is_open, b.rating_count, b.rating_sum_stars,
                v.id AS vendor_id, v.name AS vendor_name, v.name_ar AS vendor_name_ar, v.logo_url AS vendor_logo_url
           FROM vendor_branches b JOIN vendors v ON v.id = b.vendor_id
          WHERE b.id = $1`,
        [product.vendorBranchId],
      ),
    ]);
    const r = rows[0];
    return {
      catalogProductId: catalogIds.get(product.id) ?? null,
      vendor: r
        ? {
            id: r.vendor_id,
            vendorBranchId: r.branch_id,
            name: r.vendor_name,
            nameAr: r.vendor_name_ar ?? null,
            logoUrl: r.vendor_logo_url ?? null,
            branchName: r.branch_name,
            isOpen: r.is_open,
            ratingAverage: Number(r.rating_count) > 0 ? Number(r.rating_sum_stars) / Number(r.rating_count) : 0,
            ratingCount: Number(r.rating_count),
          }
        : null,
    };
  }

  async getProductById(productId: string): Promise<Product> {
    const product = await this.productsRepository.findOne({
      where: { id: productId },
      relations: { options: { values: true } },
    });
    if (!product) {
      throw new NotFoundException('Product not found.');
    }
    return product;
  }

  // ==========================================================
  // PHASE I-A, CHUNK 2 — Admin catalog management.
  // ==========================================================
  // CONFIRMED: `isActive`/`isAvailable` on creation deliberately use
  // each entity's own PRE-EXISTING default (both `true`) rather than
  // inventing a new "starts inactive" rule — Chunk 1's "Vendor/Branch
  // start inactive" decision was explicitly scoped to Vendor/
  // VendorBranch only and says nothing about catalog resources. Not
  // overriding the existing default is the neutral, non-deciding
  // choice; flagged as an open question in the final report, not
  // silently resolved either way.

  private async assertBranchExists(vendorBranchId: string): Promise<void> {
    const branch = await this.branchesRepository.findOne({ where: { id: vendorBranchId } });
    if (!branch) {
      throw new BadRequestException({
        message: 'The specified VendorBranch does not exist.',
        details: { code: 'VENDOR_BRANCH_NOT_FOUND' },
      });
    }
  }

  async adminCreateCategory(dto: CreateProductCategoryDto): Promise<ProductCategory> {
    await this.assertBranchExists(dto.vendorBranchId);
    return this.categoriesRepository.save(
      this.categoriesRepository.create({
        vendorBranchId: dto.vendorBranchId,
        name: dto.name,
        nameAr: dto.nameAr ?? null,
        sortOrder: dto.sortOrder ?? 0,
      }),
    );
  }

  async adminListCategories(vendorBranchId?: string): Promise<ProductCategory[]> {
    return this.categoriesRepository.find({
      where: vendorBranchId ? { vendorBranchId } : {},
      order: { sortOrder: 'ASC', createdAt: 'DESC' },
    });
  }

  async adminGetCategory(id: string): Promise<ProductCategory> {
    const category = await this.categoriesRepository.findOne({ where: { id } });
    if (!category) {
      throw new NotFoundException('Product category not found.');
    }
    return category;
  }

  async adminUpdateCategory(id: string, dto: UpdateProductCategoryDto): Promise<ProductCategory> {
    const category = await this.adminGetCategory(id);
    if (dto.name !== undefined) category.name = dto.name;
    if (dto.nameAr !== undefined) category.nameAr = dto.nameAr;
    if (dto.sortOrder !== undefined) category.sortOrder = dto.sortOrder;
    return this.categoriesRepository.save(category);
  }

  async adminActivateCategory(id: string): Promise<ProductCategory> {
    const category = await this.adminGetCategory(id);
    category.isActive = true;
    return this.categoriesRepository.save(category);
  }

  /**
   * Deactivation only — never a physical delete (would break any
   * existing Product row referencing this category via `categoryId`).
   * Deliberately does NOT cascade to Products in this category — see
   * this method's own scope: Product lifecycle is managed
   * independently, never as an automatic side effect.
   */
  async adminDeactivateCategory(id: string): Promise<ProductCategory> {
    const category = await this.adminGetCategory(id);
    category.isActive = false;
    return this.categoriesRepository.save(category);
  }

  private async assertCategoryBelongsToBranch(categoryId: string, vendorBranchId: string): Promise<void> {
    const category = await this.categoriesRepository.findOne({ where: { id: categoryId } });
    if (!category || category.vendorBranchId !== vendorBranchId) {
      throw new BadRequestException({
        message: 'This category does not belong to the requested vendor branch.',
        details: { code: 'CATEGORY_BRANCH_MISMATCH' },
      });
    }
  }

  async adminCreateProduct(dto: CreateProductDto): Promise<Product> {
    await this.assertBranchExists(dto.vendorBranchId);
    await this.assertCategoryBelongsToBranch(dto.categoryId, dto.vendorBranchId);

    const { inventoryMode, quantity } = this.resolveInventoryFieldsForCreate(dto.inventoryMode, dto.quantity);

    return this.productsRepository.save(
      this.productsRepository.create({
        vendorBranchId: dto.vendorBranchId,
        categoryId: dto.categoryId,
        name: dto.name,
        nameAr: dto.nameAr ?? null,
        description: dto.description ?? null,
        descriptionAr: dto.descriptionAr ?? null,
        imageUrl: dto.imageUrl ?? null,
        priceMinor: dto.priceMinor,
        pricingUnit: dto.pricingUnit,
        inventoryMode,
        quantity,
        ...(dto.isAvailable !== undefined ? { isAvailable: dto.isAvailable } : {}),
      }),
    );
  }

  async adminListProducts(vendorBranchId?: string, categoryId?: string): Promise<Product[]> {
    const where: Record<string, string> = {};
    if (vendorBranchId) where.vendorBranchId = vendorBranchId;
    if (categoryId) where.categoryId = categoryId;
    return this.productsRepository.find({ where, order: { createdAt: 'DESC' } });
  }

  /**
   * Excel Inventory & Price Management addition: optional `manager`
   * parameter — CONFIRMED smallest safe refactor, per the approved
   * design's own instruction. Every existing caller omits it and gets
   * byte-identical behavior (falls back to `this.productsRepository`,
   * the exact same repository these methods always used). Only the
   * new `ProductExcelImportService` passes a real transactional
   * manager, so all rows in one Excel Apply commit/rollback together.
   */
  async adminGetProduct(id: string, manager?: EntityManager): Promise<Product> {
    const repo = manager ? manager.getRepository(Product) : this.productsRepository;
    const product = await repo.findOne({ where: { id } });
    if (!product) {
      throw new NotFoundException('Product not found.');
    }
    return product;
  }

  /**
   * `categoryId` may be reassigned — but only ever validated to still
   * belong to the product's OWN, unchangeable `vendorBranchId` (read
   * from the existing row, never from the request body) — never a
   * cross-branch move. `pricingUnit` is never accepted here at all
   * (see UpdateProductDto's own comment — an open decision, not
   * decided by this implementation).
   */
  async adminUpdateProduct(id: string, dto: UpdateProductDto, manager?: EntityManager, actor?: StockActor): Promise<Product> {
    const repo = manager ? manager.getRepository(Product) : this.productsRepository;
    const product = await this.adminGetProduct(id, manager);

    if (dto.categoryId !== undefined) {
      await this.assertCategoryBelongsToBranch(dto.categoryId, product.vendorBranchId);
      product.categoryId = dto.categoryId;
    }
    if (dto.name !== undefined) product.name = dto.name;
    if (dto.nameAr !== undefined) product.nameAr = dto.nameAr;
    if (dto.description !== undefined) product.description = dto.description;
    if (dto.descriptionAr !== undefined) product.descriptionAr = dto.descriptionAr;
    if (dto.imageUrl !== undefined) product.imageUrl = dto.imageUrl;
    if (dto.priceMinor !== undefined) product.priceMinor = dto.priceMinor;

    if (dto.inventoryMode !== undefined || dto.quantity !== undefined) {
      const { inventoryMode, quantity } = this.resolveInventoryFieldsForUpdate(product, dto.inventoryMode, dto.quantity);
      product.inventoryMode = inventoryMode;
      product.quantity = quantity;
    }
    // CONFIRMED (Chunk 12A): isAvailable is never touched here, by
    // inventory changes or otherwise in this method — its own
    // dedicated activate/deactivate endpoints remain the only way to
    // change it, and a manually-disabled state is never silently
    // overwritten by an inventory update.

    if (actor && (dto.inventoryMode !== undefined || dto.quantity !== undefined)) {
      // The stock ledger (a trigger on `products`) records who changed the quantity and why — the context is set in the same transaction.
      return repo.manager.transaction(async (m) => {
        await setStockContext(m, { reason: actor.reason ?? 'MANUAL_ADJUSTMENT', actorUserId: actor.userId, actorRole: actor.role, note: actor.note });
        return m.getRepository(Product).save(product);
      });
    }
    return repo.save(product);
  }

  /**
   * CHUNK 12A (Inventory Foundation — CONFIRMED business decisions, do
   * not reopen). `undefined` inventoryMode defaults to OPEN; OPEN
   * always normalizes quantity to null regardless of what was passed
   * (create-time symmetry with the update-time OPEN normalization
   * rule); TRACKED requires an explicit, non-null quantity — DTO-level
   * `@IsInt()`/`@Min(0)` already covers type/range, this only adds the
   * "required when TRACKED" cross-field rule DTOs can't express
   * declaratively.
   */
  private resolveInventoryFieldsForCreate(
    inventoryModeInput: InventoryMode | undefined,
    quantityInput: number | undefined,
  ): { inventoryMode: InventoryMode; quantity: number | null } {
    const inventoryMode = inventoryModeInput ?? InventoryMode.OPEN;

    if (inventoryMode === InventoryMode.TRACKED) {
      if (quantityInput === undefined || quantityInput === null) {
        throw new BadRequestException({
          message: 'A TRACKED product requires a quantity.',
          details: { code: 'TRACKED_QUANTITY_REQUIRED' },
        });
      }
      return { inventoryMode, quantity: quantityInput };
    }

    return { inventoryMode: InventoryMode.OPEN, quantity: null };
  }

  /**
   * Same OPEN/TRACKED rules as create, applied as a transition against
   * the product's CURRENT state. Excel Inventory & Price Management:
   * this now delegates to the extracted, exported, pure
   * `resolveInventoryFieldsForUpdate` (resolve-inventory-fields.ts) —
   * CONFIRMED zero behavior change, same logic, just callable from
   * `ProductExcelImportService` too without a second implementation.
   */
  private resolveInventoryFieldsForUpdate(
    product: Product,
    inventoryModeInput: InventoryMode | undefined,
    quantityInput: number | undefined,
  ): { inventoryMode: InventoryMode; quantity: number | null } {
    return resolveInventoryFieldsForUpdateShared(product, inventoryModeInput, quantityInput);
  }

  async adminActivateProduct(id: string, manager?: EntityManager): Promise<Product> {
    const repo = manager ? manager.getRepository(Product) : this.productsRepository;
    const product = await this.adminGetProduct(id, manager);
    product.isAvailable = true;
    return repo.save(product);
  }

  /**
   * Deactivation (`isAvailable = false`) only — never a physical
   * delete, and never touches `VendorBranch.isActive` or the parent
   * `ProductCategory` as a side effect.
   */
  async adminDeactivateProduct(id: string, manager?: EntityManager): Promise<Product> {
    const repo = manager ? manager.getRepository(Product) : this.productsRepository;
    const product = await this.adminGetProduct(id, manager);
    product.isAvailable = false;
    return repo.save(product);
  }

  /**
   * Tracked Inventory Order-Time Enforcement — "Set Inventory to
   * Zero". Deliberately a dedicated, explicitly-named operation (not
   * routed through `adminUpdateProduct`'s generic
   * `resolveInventoryFieldsForUpdate`) — CONFIRMED per this chunk's
   * own instruction. Only ever touches `quantity`; `inventoryMode`,
   * `isAvailable`, `categoryId`, `pricingUnit`, and everything else on
   * the row are left completely untouched — CONFIRMED, no automatic
   * `isAvailable` change, matching the Inventory Foundation's own
   * closed decision not to auto-derive availability from stock.
   * Rejected outright for an OPEN product — there is no "inventory"
   * to zero out for one, and silently no-op'ing would be misleading.
   */
  async adminSetInventoryToZero(id: string, actor?: StockActor): Promise<Product> {
    const product = await this.adminGetProduct(id);
    if (product.inventoryMode !== InventoryMode.TRACKED) {
      throw new BadRequestException({
        message: 'Only a TRACKED product has inventory to set to zero.',
        details: { code: 'PRODUCT_NOT_TRACKED' },
      });
    }
    product.quantity = 0;
    if (actor) {
      return this.productsRepository.manager.transaction(async (m) => {
        await setStockContext(m, { reason: 'SET_TO_ZERO', actorUserId: actor.userId, actorRole: actor.role });
        return m.getRepository(Product).save(product);
      });
    }
    return this.productsRepository.save(product);
  }
}

/**
 * Filters V1. Mirrors `OfferConsumptionService.resolveActiveOffersForProducts`'s own targeting rule
 * exactly (branch-wide when an offer has no product/category targeting rows at all; otherwise a
 * specific-product or specific-category match), expressed as SQL instead of an in-memory Set — this
 * is a boolean presence filter/sort key, never a "which offer / best offer" resolution, so it doesn't
 * need that method's FLASH_SALE-vs-SUBTOTAL_DISCOUNT "best offer wins" logic at all. Hand-written raw
 * SQL (not TypeORM's own query builder for these tables), so soft-delete (`deleted_at IS NULL`) is
 * spelled out explicitly here rather than relying on TypeORM's automatic scoping.
 */
export function hasActiveOfferForProductSql(): string {
  return `EXISTS (
    SELECT 1 FROM offers o
    WHERE o.vendor_branch_id = product.vendor_branch_id
      AND o.is_active = true
      AND o.deleted_at IS NULL
      AND o.start_at <= now()
      AND o.end_at > now()
      AND (
        (
          NOT EXISTS (SELECT 1 FROM offer_products op WHERE op.offer_id = o.id)
          AND NOT EXISTS (SELECT 1 FROM offer_categories oc WHERE oc.offer_id = o.id)
        )
        OR EXISTS (SELECT 1 FROM offer_products op2 WHERE op2.offer_id = o.id AND op2.product_id = product.id)
        OR EXISTS (SELECT 1 FROM offer_categories oc2 WHERE oc2.offer_id = o.id AND oc2.product_category_id = product.category_id)
      )
  )`;
}
