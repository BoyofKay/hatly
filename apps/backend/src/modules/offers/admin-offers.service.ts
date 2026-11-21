import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { Offer } from './entities/offer.entity';
import { OfferProduct } from './entities/offer-product.entity';
import { OfferCategory } from './entities/offer-category.entity';
import { Product } from '../products/entities/product.entity';
import { ProductCategory } from '../products/entities/product-category.entity';
import { DiscountType } from './discount-type.enum';
import { OfferMechanism } from './offer-mechanism.enum';
import { CreateOfferDto } from './dto/create-offer.dto';

/**
 * FINAL DECISION: Admin-only (no Vendor-facing Offer endpoint or
 * permission exists anywhere - see AdminOffersController's own
 * comment). CONFIRMED: changing an Offer must never rewrite an
 * already-created Order - nothing here ever touches OrderItem's
 * offer snapshot columns or OfferConsumption rows; those are written
 * exclusively by OfferConsumptionService at order-creation time.
 *
 * Offers - Final System (mechanism split). create() now validates the
 * mechanism/field combination explicitly (SUBTOTAL_DISCOUNT requires
 * discountType/discountValue and forbids specialPriceMinor; FLASH_SALE
 * requires specialPriceMinor and forbids discountType/discountValue/
 * minimumEligibleSubtotalMinor/maximumDiscountMinor), and enforces
 * mutual exclusion (decision 6: a product must never be targeted by
 * both an active FLASH_SALE and an active SUBTOTAL_DISCOUNT at the
 * same time) by resolving the new offer's target product set and
 * checking for any overlapping active offer of the OPPOSITE mechanism.
 */
@Injectable()
export class AdminOffersService {
  constructor(private readonly dataSource: DataSource) {}

  async create(dto: CreateOfferDto): Promise<Offer> {
    if (new Date(dto.endAt) <= new Date(dto.startAt)) {
      throw new BadRequestException({
        message: 'endAt must be after startAt.',
        details: { code: 'INVALID_VALIDITY_WINDOW' },
      });
    }

    this.assertMechanismFieldsValid(dto);
    const couponCode = dto.couponCode ? dto.couponCode.trim().toUpperCase() : null;
    if (couponCode && dto.mechanism !== OfferMechanism.SUBTOTAL_DISCOUNT) {
      throw new BadRequestException({
        message: 'Only a Subtotal Discount offer can carry a coupon code.',
        details: { code: 'COUPON_REQUIRES_SUBTOTAL_DISCOUNT' },
      });
    }

    const productIds = dto.productIds ?? [];
    const categoryIds = dto.categoryIds ?? [];

    return this.dataSource.transaction(async (manager) => {
      if (productIds.length > 0) {
        const products = await manager.find(Product, { where: { id: In(productIds) } });
        if (products.length !== productIds.length || products.some((p) => p.vendorBranchId !== dto.vendorBranchId)) {
          throw new BadRequestException({
            message: 'One or more targeted Products do not belong to this Vendor Branch.',
            details: { code: 'PRODUCT_BRANCH_MISMATCH' },
          });
        }
      }
      if (categoryIds.length > 0) {
        const categories = await manager.find(ProductCategory, { where: { id: In(categoryIds) } });
        if (
          categories.length !== categoryIds.length ||
          categories.some((c) => c.vendorBranchId !== dto.vendorBranchId)
        ) {
          throw new BadRequestException({
            message: 'One or more targeted Categories do not belong to this Vendor Branch.',
            details: { code: 'CATEGORY_BRANCH_MISMATCH' },
          });
        }
      }

      // Mutual exclusion (decision 6): resolve which products THIS new
      // offer would apply to, and check for any already-active offer
      // of the OPPOSITE mechanism (overlapping validity window) that
      // targets any of the same products.
      const opposite = dto.mechanism === OfferMechanism.FLASH_SALE ? OfferMechanism.SUBTOTAL_DISCOUNT : OfferMechanism.FLASH_SALE;

      const oppositeOffers = await manager.find(Offer, {
        where: { vendorBranchId: dto.vendorBranchId, mechanism: opposite, isActive: true },
      });
      const newStart = new Date(dto.startAt);
      const newEnd = new Date(dto.endAt);
      // CONFIRMED bug fix: "branch-wide" must be determined from
      // whether targeting rows were EXPLICITLY omitted, never inferred
      // from a resolved product list happening to be empty (an empty
      // category with zero real products would otherwise be
      // misread as "branch-wide" and wrongly conflict with
      // everything).
      const newOfferIsBranchWide = productIds.length === 0 && categoryIds.length === 0;
      for (const existing of oppositeOffers) {
        const overlaps = existing.startAt < newEnd && newStart < existing.endAt;
        if (!overlaps) continue;
        const existingTargeting = await this.getOfferTargetingRowCounts(manager, existing.id);
        const existingIsBranchWide = existingTargeting.productCount === 0 && existingTargeting.categoryCount === 0;
        let conflict = newOfferIsBranchWide || existingIsBranchWide;
        if (!conflict) {
          const newOfferProductIds = await this.resolveTargetedProductIds(manager, {
            vendorBranchId: dto.vendorBranchId,
            productIds,
            categoryIds,
          });
          const existingProductIds = await this.resolveOfferTargetedProductIds(manager, existing);
          conflict = newOfferProductIds.some((id) => existingProductIds.includes(id));
        }
        if (conflict) {
          throw new BadRequestException({
            message: 'This product is already covered by an active offer of the other mechanism during an overlapping period. Flash Sale and Subtotal Discount cannot apply to the same product at the same time.',
            details: { code: 'OFFER_MECHANISM_CONFLICT', conflictingOfferId: existing.id },
          });
        }
      }

      if (couponCode) {
        const taken = await manager
          .createQueryBuilder(Offer, 'o')
          .where('lower(o.coupon_code) = lower(:couponCode)', { couponCode })
          .getCount();
        if (taken > 0) {
          throw new BadRequestException({
            message: 'This coupon code is already in use.',
            details: { code: 'COUPON_CODE_ALREADY_EXISTS' },
          });
        }
      }

      const offer = await manager.save(
        Offer,
        manager.create(Offer, {
          couponCode,
          vendorBranchId: dto.vendorBranchId,
          name: dto.name,
          nameAr: dto.nameAr?.trim() || null,
          mechanism: dto.mechanism,
          discountType: dto.mechanism === OfferMechanism.SUBTOTAL_DISCOUNT ? dto.discountType : null,
          discountValue: dto.mechanism === OfferMechanism.SUBTOTAL_DISCOUNT ? dto.discountValue : null,
          minimumEligibleSubtotalMinor: dto.mechanism === OfferMechanism.SUBTOTAL_DISCOUNT ? dto.minimumEligibleSubtotalMinor ?? null : null,
          maximumDiscountMinor: dto.mechanism === OfferMechanism.SUBTOTAL_DISCOUNT ? dto.maximumDiscountMinor ?? null : null,
          specialPriceMinor: dto.mechanism === OfferMechanism.FLASH_SALE ? dto.specialPriceMinor : null,
          startAt: newStart,
          endAt: newEnd,
          isActive: true,
          perOrderLimit: dto.perOrderLimit ?? null,
          perCustomerLifetimeLimit: dto.perCustomerLifetimeLimit ?? null,
          totalAllocationLimit: dto.totalAllocationLimit ?? null,
          budgetCapMinor: dto.budgetCapMinor ?? null,
        }),
      );

      for (const productId of productIds) {
        await manager.save(OfferProduct, manager.create(OfferProduct, { offerId: offer.id, productId }));
      }
      for (const categoryId of categoryIds) {
        await manager.save(OfferCategory, manager.create(OfferCategory, { offerId: offer.id, productCategoryId: categoryId }));
      }

      return offer;
    });
  }

  /**
   * Validates that the DTO's field combination matches its declared
   * mechanism - CONFIRMED "validate that fields incompatible with a
   * mechanism are not accepted... do not leave ambiguous combinations
   * without validation."
   */
  private assertMechanismFieldsValid(dto: CreateOfferDto): void {
    if (dto.mechanism === OfferMechanism.SUBTOTAL_DISCOUNT) {
      if (dto.discountType === undefined || dto.discountValue === undefined) {
        throw new BadRequestException({
          message: 'A Subtotal Discount offer requires discountType and discountValue.',
          details: { code: 'MISSING_SUBTOTAL_DISCOUNT_FIELDS' },
        });
      }
      if (dto.discountType === DiscountType.PERCENTAGE && dto.discountValue > 10000) {
        throw new BadRequestException({
          message: 'A percentage discount cannot exceed 100% (10000 basis points).',
          details: { code: 'INVALID_DISCOUNT_VALUE' },
        });
      }
      if (dto.specialPriceMinor !== undefined) {
        throw new BadRequestException({
          message: 'A Subtotal Discount offer must not set specialPriceMinor.',
          details: { code: 'UNEXPECTED_FLASH_SALE_FIELD' },
        });
      }
    } else if (dto.mechanism === OfferMechanism.FLASH_SALE) {
      if (dto.specialPriceMinor === undefined) {
        throw new BadRequestException({
          message: 'A Flash Sale offer requires specialPriceMinor.',
          details: { code: 'MISSING_FLASH_SALE_FIELDS' },
        });
      }
      if (
        dto.discountType !== undefined ||
        dto.discountValue !== undefined ||
        dto.minimumEligibleSubtotalMinor !== undefined ||
        dto.maximumDiscountMinor !== undefined
      ) {
        throw new BadRequestException({
          message: 'A Flash Sale offer must not set discountType, discountValue, minimumEligibleSubtotalMinor, or maximumDiscountMinor.',
          details: { code: 'UNEXPECTED_SUBTOTAL_DISCOUNT_FIELD' },
        });
      }
    }
  }

  /** Raw targeting-row presence for an existing offer — used to determine "branch-wide" unambiguously, never inferred from a resolved product list's length. */
  private async getOfferTargetingRowCounts(manager: any, offerId: string): Promise<{ productCount: number; categoryCount: number }> {
    const productCount = await manager.count(OfferProduct, { where: { offerId } });
    const categoryCount = await manager.count(OfferCategory, { where: { offerId } });
    return { productCount, categoryCount };
  }

  /** Resolves which product ids a NEW (not-yet-created) offer would target. Empty array means branch-wide (matches every product in the branch). */
  private async resolveTargetedProductIds(
    manager: any,
    params: { vendorBranchId: string; productIds: string[]; categoryIds: string[] },
  ): Promise<string[]> {
    if (params.productIds.length === 0 && params.categoryIds.length === 0) {
      return []; // branch-wide
    }
    const ids = new Set<string>(params.productIds);
    if (params.categoryIds.length > 0) {
      const products = await manager.find(Product, { where: { categoryId: In(params.categoryIds) } });
      for (const p of products) ids.add(p.id);
    }
    return [...ids];
  }

  /** Resolves which product ids an EXISTING offer targets. Empty array means branch-wide. */
  private async resolveOfferTargetedProductIds(manager: any, offer: Offer): Promise<string[]> {
    const offerProducts = await manager.find(OfferProduct, { where: { offerId: offer.id } });
    const offerCategories = await manager.find(OfferCategory, { where: { offerId: offer.id } });
    if (offerProducts.length === 0 && offerCategories.length === 0) {
      return []; // branch-wide
    }
    const ids = new Set<string>(offerProducts.map((op: OfferProduct) => op.productId));
    if (offerCategories.length > 0) {
      const categoryIds = offerCategories.map((oc: OfferCategory) => oc.productCategoryId);
      const products = await manager.find(Product, { where: { categoryId: In(categoryIds) } });
      for (const p of products) ids.add(p.id);
    }
    return [...ids];
  }

  /**
   * Admin Offers Management UI. Small, additive enrichment — the list
   * view needs to show Admin whether an offer is branch-wide/product/
   * category targeted, which the raw Offer entity alone doesn't carry.
   * Never a new business rule, just resolving the existing
   * OfferProduct/OfferCategory join rows into plain id arrays for
   * display.
   */
  async listForBranch(vendorBranchId?: string): Promise<Array<Offer & { productIds: string[]; categoryIds: string[] }>> {
    const offers = await this.dataSource.getRepository(Offer).find({
      where: vendorBranchId ? { vendorBranchId } : {},
      order: { createdAt: 'DESC' },
    });
    return Promise.all(offers.map((offer) => this.withTargeting(offer)));
  }

  async getOne(id: string): Promise<Offer & { productIds: string[]; categoryIds: string[] }> {
    const offer = await this.dataSource.getRepository(Offer).findOne({ where: { id } });
    if (!offer) {
      throw new NotFoundException('Offer not found.');
    }
    return this.withTargeting(offer);
  }

  private async withTargeting(offer: Offer): Promise<Offer & { productIds: string[]; categoryIds: string[] }> {
    const [products, categories] = await Promise.all([
      this.dataSource.getRepository(OfferProduct).find({ where: { offerId: offer.id } }),
      this.dataSource.getRepository(OfferCategory).find({ where: { offerId: offer.id } }),
    ]);
    return {
      ...offer,
      productIds: products.map((p) => p.productId),
      categoryIds: categories.map((c) => c.productCategoryId),
    };
  }

  /**
   * Admin Offers Management UI. Mirrors `deactivate` exactly —
   * CONFIRMED symmetric, minimal backend adjustment (the UI's explicit
   * requirement to support both actions), no new business rule: same
   * one-field flip, same lack of any other side effect. Uses the raw
   * entity fetch (never `getOne`, which now returns the enriched
   * productIds/categoryIds shape) so `save()` only ever operates on
   * real Offer columns.
   */
  async activate(id: string): Promise<Offer> {
    const offer = await this.getRawOne(id);
    offer.isActive = true;
    return this.dataSource.getRepository(Offer).save(offer);
  }

  async deactivate(id: string): Promise<Offer> {
    const offer = await this.getRawOne(id);
    offer.isActive = false;
    return this.dataSource.getRepository(Offer).save(offer);
  }

  private async getRawOne(id: string): Promise<Offer> {
    const offer = await this.dataSource.getRepository(Offer).findOne({ where: { id } });
    if (!offer) {
      throw new NotFoundException('Offer not found.');
    }
    return offer;
  }
}
