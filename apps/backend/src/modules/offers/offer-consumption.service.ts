import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { Offer } from './entities/offer.entity';
import { OfferProduct } from './entities/offer-product.entity';
import { OfferCategory } from './entities/offer-category.entity';
import { OfferConsumption } from './entities/offer-consumption.entity';
import { DiscountType } from './discount-type.enum';
import { OfferMechanism } from './offer-mechanism.enum';
import { PricingUnit } from '../products/pricing-unit.enum';
import { FinancialEventService } from '../finance/financial-event.service';
import { FinancialEventDirection, FinancialEventType } from '../finance/financial-event-type.enum';

export interface OfferCandidateItem {
  cartItemId: string;
  vendorBranchId: string;
  productId: string;
  categoryId: string;
  quantity: number;
  unitPriceMinor: number;
  pricingUnit: PricingUnit | null | undefined;
}

export interface OfferItemPlan {
  offer: Offer;
  discountedQuantity: number;
  discountPerUnitMinor: number;
  discountAmountMinor: number;
  originalUnitPriceMinor: number;
}

export interface OfferSegmentPlan {
  offer: Offer;
  eligibleSubtotalMinor: number;
  discountAmountMinor: number;
}

export interface OfferPreviewResult {
  offerId: string;
  mechanism: OfferMechanism;
  /** FLASH_SALE only — the real replacement price, unambiguous (never derived from discountType/Value). */
  specialPriceMinor: number | null;
  /** Legacy/compat fields — populated for FLASH_SALE only, kept so no existing consumer breaks. Never meaningful for SUBTOTAL_DISCOUNT. */
  discountType: DiscountType | null;
  discountValue: number | null;
  discountedQuantity: number | null;
  discountAmountMinor: number | null;
}

/**
 * Customer Offers Integration. A lightweight, non-authoritative
 * per-item SUBTOTAL_DISCOUNT signal — CONFIRMED not the same as a real
 * discount amount (that requires the full eligible-subtotal
 * calculation across the whole segment, which needs locked,
 * transactional state a read-only cart preview must never hold — see
 * planSubtotalDiscountForSegment's own comment). This only answers
 * "does an active Subtotal Discount currently target this item,"
 * for the Cart to show a concise promotional indicator — never a
 * computed discount amount, never authoritative.
 */
export interface SubtotalDiscountPreviewResult {
  offerId: string;
  discountType: DiscountType;
  discountValue: number;
}

export interface ActiveOfferSummary {
  mechanism: OfferMechanism;
  /** FLASH_SALE only — the real replacement price. Undefined/omitted for SUBTOTAL_DISCOUNT. */
  specialPriceMinor?: number;
}

/**
 * Structured error thrown when a FLASH_SALE's cumulative per-customer
 * or global allocation cannot satisfy the requested quantity —
 * CONFIRMED (approved decision 2): the checkout REJECTS outright, it
 * never silently reduces or splits the requested quantity. Carries
 * enough structured data for the Customer UI to show limit/consumed/
 * remaining/requested, per the explicit requirement.
 */
export class FlashSaleLimitExceededException extends BadRequestException {
  constructor(params: {
    offerId: string;
    productId: string;
    limitType: 'CUSTOMER' | 'GLOBAL';
    limit: number;
    alreadyConsumed: number;
    remaining: number;
    requested: number;
  }) {
    super({
      message: 'This Flash Sale quantity is no longer available at that amount.',
      details: { code: 'FLASH_SALE_LIMIT_EXCEEDED', ...params },
    });
  }
}

/**
 * Offers - Final System. ONE service, TWO clearly separated
 * calculation paths - CONFIRMED per the approved design: "do not mix
 * discounted quantity logic with eligible subtotal logic." Each
 * mechanism gets its own plan type (OfferItemPlan for FLASH_SALE,
 * OfferSegmentPlan for SUBTOTAL_DISCOUNT) and its own private
 * calculation methods below - never a shared/generic code path that
 * blurs the two.
 *
 * WEIGHT products are never eligible for EITHER mechanism (decision
 * C, unconditional) - the existing "WEIGHT products are never
 * eligible" rule already covers FLASH_SALE too; extending Flash Sale
 * to weighted products would be a genuinely new business decision
 * this chunk does not invent.
 *
 * Two-phase, because Order/OrderVendorSegment/OrderItem rows don't
 * exist yet when Offer eligibility must first be locked and decided:
 *   1. planFlashSaleForCart / planSubtotalDiscountForSegment - called
 *      BEFORE any Order/OrderVendorSegment/OrderItem row is created.
 *      Lock every distinct touched Offer row (pessimistic_write, same
 *      discipline as OrderItemWeightRecordService/OrderCreationService's
 *      own cart lock) and check all limits against that now-locked,
 *      guaranteed-consistent state.
 *   2. finalizeConsumption - called AFTER every OrderItem/
 *      OrderVendorSegment has been saved. Writes the OfferConsumption
 *      row(s) and increments/saves each touched Offer's derived cache
 *      counters exactly once.
 * Both phases run inside the SAME caller-supplied transaction/manager
 * as order creation - the row locks acquired in phase 1 are held for
 * the whole transaction, which is what makes phase 2's writes safe
 * under concurrent order-creation attempts against the same Offer.
 *
 * MUTUAL EXCLUSION (decision 6): enforced primarily at Offer
 * creation/update time (see AdminOffersService). As defense in depth,
 * planSubtotalDiscountForSegment excludes any item that already
 * received a FLASH_SALE plan from its eligible subtotal.
 */
@Injectable()
export class OfferConsumptionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly financialEventService: FinancialEventService,
  ) {}

  /**
   * BEST-EFFORT CART PREVIEW ONLY, FLASH_SALE items only. No row lock;
   * only perOrderLimit is enforced. Order creation
   * (planFlashSaleForCart) is the ONLY authoritative path and always
   * re-validates independently. SUBTOTAL_DISCOUNT preview is
   * intentionally out of scope for this method.
   */
  async previewOffersForItems(items: OfferCandidateItem[]): Promise<{
    flashSalePreviews: Map<string, OfferPreviewResult>;
    subtotalDiscountPreviews: Map<string, SubtotalDiscountPreviewResult>;
  }> {
    const flashSalePreviews = new Map<string, OfferPreviewResult>();
    const subtotalDiscountPreviews = new Map<string, SubtotalDiscountPreviewResult>();
    const now = new Date();
    const manager = this.dataSource.manager;

    for (const item of items) {
      if (item.pricingUnit === PricingUnit.WEIGHT) continue;

      const offers = await this.findMatchingActiveOffers(manager, {
        vendorBranchId: item.vendorBranchId,
        productId: item.productId,
        categoryId: item.categoryId,
        now,
        mechanism: OfferMechanism.FLASH_SALE,
      });
      if (offers.length > 0) {
        let best: { offer: Offer; discountPerUnitMinor: number } | null = null;
        for (const offer of offers) {
          const discountPerUnitMinor = this.computeFlashSaleDiscountPerUnit(offer, item.unitPriceMinor);
          if (discountPerUnitMinor <= 0) continue;
          if (!best || discountPerUnitMinor > best.discountPerUnitMinor) {
            best = { offer, discountPerUnitMinor };
          }
        }
        if (best) {
          const discountedQuantity =
            best.offer.perOrderLimit != null ? Math.min(item.quantity, best.offer.perOrderLimit) : item.quantity;
          if (discountedQuantity > 0) {
            flashSalePreviews.set(item.cartItemId, {
              offerId: best.offer.id,
              mechanism: OfferMechanism.FLASH_SALE,
              specialPriceMinor: best.offer.specialPriceMinor ?? null,
              discountType: DiscountType.FIXED,
              discountValue: best.offer.specialPriceMinor ?? 0,
              discountedQuantity,
              discountAmountMinor: discountedQuantity * best.discountPerUnitMinor,
            });
          }
        }
      }

      // Customer Offers Integration. Lightweight, non-authoritative
      // SUBTOTAL_DISCOUNT existence check — mutually exclusive with
      // FLASH_SALE by construction (creation-time validation prevents
      // both from ever matching the same product), so this never
      // needs to pick between the two.
      const subtotalOffers = await this.findMatchingActiveOffers(manager, {
        vendorBranchId: item.vendorBranchId,
        productId: item.productId,
        categoryId: item.categoryId,
        now,
        mechanism: OfferMechanism.SUBTOTAL_DISCOUNT,
      });
      if (subtotalOffers.length > 0) {
        const offer = subtotalOffers[0];
        subtotalDiscountPreviews.set(item.cartItemId, {
          offerId: offer.id,
          discountType: offer.discountType ?? DiscountType.PERCENTAGE,
          discountValue: offer.discountValue ?? 0,
        });
      }
    }

    return { flashSalePreviews, subtotalDiscountPreviews };
  }

  /**
   * Customer Product-Level Offers Display. Batch-resolves active
   * offers for MANY products in ONE pass — CONFIRMED, exactly 3
   * queries regardless of how many products are given (one for active
   * Offers in the branch, one for OfferProduct rows, one for
   * OfferCategory rows), never a per-product call to
   * `findMatchingActiveOffers`. Resolution happens entirely in memory
   * after that. Same active/targeting rules as everywhere else in
   * this service — not a second implementation.
   *
   * Every offer considered is already scoped to `vendorBranchId` by
   * the very first query — CONFIRMED branch isolation, a Vendor A
   * offer can never be resolved against a Vendor B product because
   * this method is never called with the wrong branch id for a given
   * product in the first place (the caller is responsible for that,
   * same as every other branch-scoped query in this codebase).
   */
  async resolveActiveOffersForProducts(
    params: { vendorBranchId: string; products: Array<{ productId: string; categoryId: string }> },
  ): Promise<Map<string, ActiveOfferSummary>> {
    const result = new Map<string, ActiveOfferSummary>();
    if (params.products.length === 0) return result;

    const manager = this.dataSource.manager;
    const now = new Date();
    const activeOffers = await manager.find(Offer, {
      where: { vendorBranchId: params.vendorBranchId, isActive: true },
    });
    const validOffers = activeOffers.filter((o) => o.startAt <= now && now < o.endAt);
    if (validOffers.length === 0) return result;

    const offerIds = validOffers.map((o) => o.id);
    const [offerProducts, offerCategories] = await Promise.all([
      manager.find(OfferProduct, { where: { offerId: In(offerIds) } }),
      manager.find(OfferCategory, { where: { offerId: In(offerIds) } }),
    ]);

    // Precompute, per offer id, its explicit product/category targets
    // — and separately, which offers have NO targeting rows at all
    // (branch-wide). CONFIRMED: "no targeting rows" (branch-wide) is
    // never confused with "targeting rows exist but didn't match this
    // product" — these are built from two disjoint sets below, never
    // inferred from an empty per-product match result.
    const productIdsByOfferId = new Map<string, Set<string>>();
    for (const row of offerProducts) {
      if (!productIdsByOfferId.has(row.offerId)) productIdsByOfferId.set(row.offerId, new Set());
      productIdsByOfferId.get(row.offerId)!.add(row.productId);
    }
    const categoryIdsByOfferId = new Map<string, Set<string>>();
    for (const row of offerCategories) {
      if (!categoryIdsByOfferId.has(row.offerId)) categoryIdsByOfferId.set(row.offerId, new Set());
      categoryIdsByOfferId.get(row.offerId)!.add(row.productCategoryId);
    }
    const offersWithNoTargeting = validOffers.filter(
      (o) => !productIdsByOfferId.has(o.id) && !categoryIdsByOfferId.has(o.id),
    );

    for (const product of params.products) {
      const matching = validOffers.filter((offer) => {
        if (productIdsByOfferId.get(offer.id)?.has(product.productId)) return true;
        if (categoryIdsByOfferId.get(offer.id)?.has(product.categoryId)) return true;
        return offersWithNoTargeting.some((o) => o.id === offer.id);
      });
      if (matching.length === 0) continue;

      // FLASH_SALE: "best offer wins" — same precedent as checkout
      // planning (highest per-unit discount). SUBTOTAL_DISCOUNT: any
      // one match is sufficient — the customer only ever receives a
      // presence signal, never a computed amount, so there is no
      // "best" to choose between (decision explicitly not reopened).
      const flashSaleMatches = matching.filter((o) => o.mechanism === OfferMechanism.FLASH_SALE);
      if (flashSaleMatches.length > 0) {
        // unitPriceMinor isn't known at this layer (this method never
        // needs a real customer price to answer "is there a special
        // price" — the special price itself is fixed and doesn't
        // depend on the normal price) — pick the lowest specialPriceMinor,
        // the equivalent of "best offer" without needing a unit price.
        const best = flashSaleMatches.reduce((a, b) => ((b.specialPriceMinor ?? Infinity) < (a.specialPriceMinor ?? Infinity) ? b : a));
        result.set(product.productId, { mechanism: OfferMechanism.FLASH_SALE, specialPriceMinor: best.specialPriceMinor ?? undefined });
        continue; // mutual exclusion — never also set SUBTOTAL_DISCOUNT for the same product
      }

      const subtotalMatch = matching.find((o) => o.mechanism === OfferMechanism.SUBTOTAL_DISCOUNT);
      if (subtotalMatch) {
        result.set(product.productId, { mechanism: OfferMechanism.SUBTOTAL_DISCOUNT });
      }
    }

    return result;
  }

  /**
   * FLASH_SALE planning - one plan per eligible cart item. Exceeding
   * the per-customer or global CUMULATIVE allocation now REJECTS
   * (throws FlashSaleLimitExceededException) rather than silently
   * clamping - CONFIRMED approved decision 2. perOrderLimit (a
   * per-single-order cap) still clamps rather than rejects - that
   * rule is unrelated to the approved decision, which is specifically
   * about the CUMULATIVE limits.
   */
  async planFlashSaleForCart(
    manager: EntityManager,
    params: { customerId: string; items: OfferCandidateItem[]; readOnly?: boolean },
  ): Promise<{ plans: Map<string, OfferItemPlan>; lockedOffers: Map<string, Offer> }> {
    const plans = new Map<string, OfferItemPlan>();
    const lockedOffers = new Map<string, Offer>();
    const now = new Date();

    for (const item of params.items) {
      if (item.pricingUnit === PricingUnit.WEIGHT) continue;

      const matching = await this.findMatchingActiveOffers(manager, {
        vendorBranchId: item.vendorBranchId,
        productId: item.productId,
        categoryId: item.categoryId,
        now,
        mechanism: OfferMechanism.FLASH_SALE,
      });
      if (matching.length === 0) continue;

      for (const offer of matching) {
        if (!lockedOffers.has(offer.id)) {
          // A checkout QUOTE (readOnly) must not hold offer rows; only order creation locks them.
          const locked = await manager.findOne(Offer, {
            where: { id: offer.id },
            ...(params.readOnly ? {} : { lock: { mode: 'pessimistic_write' as const } }),
          });
          if (locked) lockedOffers.set(offer.id, locked);
        }
      }

      const candidates = matching.map((o) => lockedOffers.get(o.id)).filter((o): o is Offer => !!o);
      if (candidates.length === 0) continue;

      let best: { offer: Offer; discountPerUnitMinor: number } | null = null;
      for (const offer of candidates) {
        const discountPerUnitMinor = this.computeFlashSaleDiscountPerUnit(offer, item.unitPriceMinor);
        if (discountPerUnitMinor <= 0) continue;
        if (!best || discountPerUnitMinor > best.discountPerUnitMinor) {
          best = { offer, discountPerUnitMinor };
        }
      }
      if (!best) continue;

      let allowed = item.quantity;
      if (best.offer.perOrderLimit != null) {
        allowed = Math.min(allowed, best.offer.perOrderLimit);
      }

      if (best.offer.perCustomerLifetimeLimit != null) {
        const alreadyConsumed = await this.sumCustomerConsumedQuantity(manager, best.offer.id, params.customerId);
        const remaining = Math.max(0, best.offer.perCustomerLifetimeLimit - alreadyConsumed);
        if (allowed > remaining) {
          throw new FlashSaleLimitExceededException({
            offerId: best.offer.id,
            productId: item.productId,
            limitType: 'CUSTOMER',
            limit: best.offer.perCustomerLifetimeLimit,
            alreadyConsumed,
            remaining,
            requested: allowed,
          });
        }
      }

      if (best.offer.totalAllocationLimit != null) {
        const remaining = Math.max(0, best.offer.totalAllocationLimit - best.offer.consumedUnitsCount);
        if (allowed > remaining) {
          throw new FlashSaleLimitExceededException({
            offerId: best.offer.id,
            productId: item.productId,
            limitType: 'GLOBAL',
            limit: best.offer.totalAllocationLimit,
            alreadyConsumed: best.offer.consumedUnitsCount,
            remaining,
            requested: allowed,
          });
        }
      }

      if (allowed <= 0) continue;

      plans.set(item.cartItemId, {
        offer: best.offer,
        discountedQuantity: allowed,
        discountPerUnitMinor: best.discountPerUnitMinor,
        discountAmountMinor: allowed * best.discountPerUnitMinor,
        originalUnitPriceMinor: item.unitPriceMinor,
      });
    }

    return { plans, lockedOffers };
  }

  /**
   * SUBTOTAL_DISCOUNT planning - one plan per VendorBranch segment,
   * never per item. items here must already be scoped to ONE
   * VendorBranch's segment by the caller. alreadyFlashSaledCartItemIds
   * - items that already received a FLASH_SALE plan are excluded from
   * this segment's eligible subtotal (mutual exclusion, decision 6).
   *
   * Per-customer cumulative USE-COUNT limit is checked separately via
   * checkSubtotalDiscountCustomerLimit (needs customerId) - the caller
   * must call both before accepting a plan.
   */
  async planSubtotalDiscountForSegment(
    manager: EntityManager,
    params: { vendorBranchId: string; items: OfferCandidateItem[]; alreadyFlashSaledCartItemIds: Set<string>; readOnly?: boolean },
  ): Promise<{ plan: OfferSegmentPlan | null; lockedOffer: Offer | null }> {
    const now = new Date();
    const eligibleItems = params.items.filter(
      (item) => item.pricingUnit !== PricingUnit.WEIGHT && !params.alreadyFlashSaledCartItemIds.has(item.cartItemId),
    );
    if (eligibleItems.length === 0) return { plan: null, lockedOffer: null };

    const candidateOfferIds = new Set<string>();
    for (const item of eligibleItems) {
      const matching = await this.findMatchingActiveOffers(manager, {
        vendorBranchId: params.vendorBranchId,
        productId: item.productId,
        categoryId: item.categoryId,
        now,
        mechanism: OfferMechanism.SUBTOTAL_DISCOUNT,
      });
      for (const o of matching) candidateOfferIds.add(o.id);
    }
    if (candidateOfferIds.size === 0) return { plan: null, lockedOffer: null };

    let bestPlan: OfferSegmentPlan | null = null;
    let bestLockedOffer: Offer | null = null;

    for (const offerId of candidateOfferIds) {
      const locked = await manager.findOne(Offer, {
        where: { id: offerId },
        ...(params.readOnly ? {} : { lock: { mode: 'pessimistic_write' as const } }),
      });
      if (!locked) continue;

      const targetedItems: OfferCandidateItem[] = [];
      for (const item of eligibleItems) {
        if (await this.offerTargetsProduct(manager, locked, item.vendorBranchId, item.productId, item.categoryId)) {
          targetedItems.push(item);
        }
      }
      if (targetedItems.length === 0) continue;

      const eligibleSubtotalMinor = targetedItems.reduce((sum, i) => sum + i.quantity * i.unitPriceMinor, 0);

      let discountAmountMinor = this.computeSubtotalDiscount(locked, eligibleSubtotalMinor);
      if (discountAmountMinor <= 0) continue;

      if (locked.totalAllocationLimit != null && locked.consumedUnitsCount >= locked.totalAllocationLimit) {
        continue;
      }

      if (locked.budgetCapMinor != null) {
        const remainingBudget = Math.max(0, locked.budgetCapMinor - locked.consumedDiscountMinor);
        if (remainingBudget <= 0) continue;
        discountAmountMinor = Math.min(discountAmountMinor, remainingBudget);
      }

      if (!bestPlan || discountAmountMinor > bestPlan.discountAmountMinor) {
        bestPlan = { offer: locked, eligibleSubtotalMinor, discountAmountMinor };
        bestLockedOffer = locked;
      }
    }

    return { plan: bestPlan, lockedOffer: bestLockedOffer };
  }

  /**
   * COUPON (PD-006). Validates a code the customer entered and plans its discount for the ONE vendor segment it belongs to —
   * a coupon never spreads across unrelated vendors. Everything is decided here on the server: validity window, active flag,
   * scope (vendor branch / product / category, via the offer's targeting), minimum eligible subtotal, per-customer and global
   * use limits, and the budget cap. Items already discounted by a Flash Sale and weighed items are never eligible (the same
   * rules as automatic subtotal discounts). A rejected code is reported with a machine-readable reason, never thrown, so a
   * quote can show it while an order creation can refuse it.
   */
  async planCouponForCart(
    manager: EntityManager,
    params: {
      code: string;
      customerId: string;
      segments: Array<{ groupIndex: number; vendorBranchId: string; items: OfferCandidateItem[] }>;
      alreadyFlashSaledCartItemIds: Set<string>;
      readOnly?: boolean;
    },
  ): Promise<
    | { status: 'APPLIED'; groupIndex: number; vendorBranchId: string; plan: OfferSegmentPlan; code: string }
    | { status: 'REJECTED'; reasonCode: string; message: string }
  > {
    const reject = (reasonCode: string, message: string) => ({ status: 'REJECTED' as const, reasonCode, message });
    const code = params.code.trim().toUpperCase();

    const found = await manager
      .createQueryBuilder(Offer, 'offer')
      .where('lower(offer.coupon_code) = lower(:code)', { code })
      .getOne();
    if (!found || found.mechanism !== OfferMechanism.SUBTOTAL_DISCOUNT) {
      return reject('COUPON_NOT_FOUND', 'This coupon code is not valid.');
    }
    const now = new Date();
    if (!found.isActive) return reject('COUPON_INACTIVE', 'This coupon is not active.');
    if (now < found.startAt) return reject('COUPON_NOT_STARTED', 'This coupon is not active yet.');
    if (now >= found.endAt) return reject('COUPON_EXPIRED', 'This coupon has expired.');

    const segment = params.segments.find((s) => s.vendorBranchId === found.vendorBranchId);
    if (!segment) {
      return reject('COUPON_NOT_APPLICABLE_TO_CART', 'This coupon only applies to a vendor that is not in your cart.');
    }

    const offer = await manager.findOne(Offer, {
      where: { id: found.id },
      ...(params.readOnly ? {} : { lock: { mode: 'pessimistic_write' as const } }),
    });
    if (!offer) return reject('COUPON_NOT_FOUND', 'This coupon code is not valid.');

    const eligibleItems = segment.items.filter(
      (item) => item.pricingUnit !== PricingUnit.WEIGHT && !params.alreadyFlashSaledCartItemIds.has(item.cartItemId),
    );
    const targetedItems: OfferCandidateItem[] = [];
    for (const item of eligibleItems) {
      if (await this.offerTargetsProduct(manager, offer, item.vendorBranchId, item.productId, item.categoryId)) {
        targetedItems.push(item);
      }
    }
    if (targetedItems.length === 0) {
      return reject('COUPON_NO_ELIGIBLE_ITEMS', 'None of the items in your cart are eligible for this coupon.');
    }

    const eligibleSubtotalMinor = targetedItems.reduce((sum, i) => sum + i.quantity * i.unitPriceMinor, 0);
    if (offer.minimumEligibleSubtotalMinor != null && eligibleSubtotalMinor < offer.minimumEligibleSubtotalMinor) {
      return reject('COUPON_MINIMUM_NOT_MET', 'Your eligible items do not reach the minimum for this coupon.');
    }
    if (offer.totalAllocationLimit != null && offer.consumedUnitsCount >= offer.totalAllocationLimit) {
      return reject('COUPON_USAGE_LIMIT_REACHED', 'This coupon has reached its usage limit.');
    }
    if (!(await this.checkSubtotalDiscountCustomerLimit(manager, { offer, customerId: params.customerId }))) {
      return reject('COUPON_CUSTOMER_LIMIT_REACHED', 'You have already used this coupon the maximum number of times.');
    }

    let discountAmountMinor = this.computeSubtotalDiscount(offer, eligibleSubtotalMinor);
    if (discountAmountMinor <= 0) return reject('COUPON_NO_ELIGIBLE_ITEMS', 'This coupon gives no discount on your cart.');
    if (offer.budgetCapMinor != null) {
      const remainingBudget = Math.max(0, offer.budgetCapMinor - offer.consumedDiscountMinor);
      if (remainingBudget <= 0) return reject('COUPON_BUDGET_EXHAUSTED', 'This coupon is no longer available.');
      discountAmountMinor = Math.min(discountAmountMinor, remainingBudget);
    }

    return {
      status: 'APPLIED',
      groupIndex: segment.groupIndex,
      vendorBranchId: segment.vendorBranchId,
      plan: { offer, eligibleSubtotalMinor, discountAmountMinor },
      code: offer.couponCode ?? code,
    };
  }

  async checkSubtotalDiscountCustomerLimit(
    manager: EntityManager,
    params: { offer: Offer; customerId: string },
  ): Promise<boolean> {
    if (params.offer.perCustomerLifetimeLimit == null) return true;
    const usedCount = await manager.count(OfferConsumption, {
      where: { offerId: params.offer.id, customerId: params.customerId },
    });
    return usedCount < params.offer.perCustomerLifetimeLimit;
  }

  private async sumCustomerConsumedQuantity(manager: EntityManager, offerId: string, customerId: string): Promise<number> {
    // Offers Final System — Flash Sale cancellation reversal:
    // reversed rows are excluded from the customer's cumulative
    // usage, per the FINAL approved rule.
    const { sum } = await manager
      .createQueryBuilder(OfferConsumption, 'c')
      .select('COALESCE(SUM(c.quantity_consumed), 0)', 'sum')
      .where('c.offer_id = :offerId AND c.customer_id = :customerId AND c.is_reversed = false', { offerId, customerId })
      .getRawOne();
    return Number(sum);
  }

  async finalizeConsumption(
    manager: EntityManager,
    params: {
      customerId: string;
      orderId: string;
      itemPlans: Map<string, OfferItemPlan>;
      orderItemIdByCartItemId: Map<string, string>;
      segmentPlans?: Array<{ plan: OfferSegmentPlan; orderVendorSegmentId: string }>;
    },
  ): Promise<void> {
    const touchedOffers = new Map<string, Offer>();

    for (const [cartItemId, plan] of params.itemPlans) {
      const orderItemId = params.orderItemIdByCartItemId.get(cartItemId);
      if (!orderItemId) continue;

      await manager.save(
        OfferConsumption,
        manager.create(OfferConsumption, {
          offerId: plan.offer.id,
          customerId: params.customerId,
          orderId: params.orderId,
          mechanismSnapshot: OfferMechanism.FLASH_SALE,
          orderItemId,
          quantityConsumed: plan.discountedQuantity,
          discountAppliedMinor: plan.discountAmountMinor,
          originalUnitPriceMinorSnapshot: plan.originalUnitPriceMinor,
          specialPriceMinorSnapshot: plan.offer.specialPriceMinor,
        }),
      );

      const tracked = touchedOffers.get(plan.offer.id) ?? plan.offer;
      tracked.consumedUnitsCount = (tracked.consumedUnitsCount ?? 0) + plan.discountedQuantity;
      tracked.consumedDiscountMinor = (tracked.consumedDiscountMinor ?? 0) + plan.discountAmountMinor;
      touchedOffers.set(plan.offer.id, tracked);
    }

    for (const { plan, orderVendorSegmentId } of params.segmentPlans ?? []) {
      await manager.save(
        OfferConsumption,
        manager.create(OfferConsumption, {
          offerId: plan.offer.id,
          customerId: params.customerId,
          orderId: params.orderId,
          mechanismSnapshot: OfferMechanism.SUBTOTAL_DISCOUNT,
          orderVendorSegmentId,
          quantityConsumed: 1,
          discountAppliedMinor: plan.discountAmountMinor,
          discountTypeSnapshot: plan.offer.discountType,
          discountValueSnapshot: plan.offer.discountValue,
          eligibleSubtotalMinorSnapshot: plan.eligibleSubtotalMinor,
        }),
      );

      const tracked = touchedOffers.get(plan.offer.id) ?? plan.offer;
      tracked.consumedUnitsCount = (tracked.consumedUnitsCount ?? 0) + 1;
      tracked.consumedDiscountMinor = (tracked.consumedDiscountMinor ?? 0) + plan.discountAmountMinor;
      touchedOffers.set(plan.offer.id, tracked);
    }

    for (const offer of touchedOffers.values()) {
      await manager.save(Offer, offer);
    }
  }

  /**
   * Offers Final System — Flash Sale cancellation reversal (FINAL
   * approved rule). Called from OrderStateMachineService.transition()
   * inside the SAME locked order-cancellation transaction — never a
   * second transaction. Scoped by orderId only — never touches another
   * order's or customer's consumption. SUBTOTAL_DISCOUNT consumption
   * is deliberately untouched (this rule is FLASH_SALE-only, per the
   * approved instruction) — the `mechanismSnapshot` filter below is
   * what enforces that.
   *
   * IDEMPOTENT: the `isReversed: false` filter means a second call for
   * the same (already-reversed) order finds zero rows and is a
   * complete no-op — the Offer's derived cache is never decremented
   * twice for the same consumption. `Math.max(0, ...)` additionally
   * guards against ever driving a cache column negative, even in a
   * hypothetical data-inconsistency scenario.
   *
   * Historical record is NEVER deleted or overwritten beyond the two
   * new columns — quantityConsumed, discountAppliedMinor, and every
   * snapshot field remain exactly as originally written, preserving
   * full audit history.
   */
  async reverseFlashSaleConsumptionForOrder(
    manager: EntityManager,
    orderId: string,
    /**
     * Partial vendor cancellation: when given, ONLY the consumptions of these order items are reversed (the items of
     * the cancelled segment); the other vendors' flash-sale allocations stay consumed. Omitted = the whole order, as
     * before.
     */
    onlyOrderItemIds?: string[],
  ): Promise<void> {
    if (onlyOrderItemIds && onlyOrderItemIds.length === 0) return;
    const consumptions = await manager.find(OfferConsumption, {
      where: {
        orderId,
        mechanismSnapshot: OfferMechanism.FLASH_SALE,
        isReversed: false,
        ...(onlyOrderItemIds ? { orderItemId: In(onlyOrderItemIds) } : {}),
      },
    });
    if (consumptions.length === 0) return; // nothing to reverse — already reversed, or no FLASH_SALE consumption on this order

    // Lock every distinct touched Offer row BEFORE mutating any cache
    // counter — same pessimistic_write discipline as consumption
    // itself, so a concurrent checkout against the same Offer can
    // never read a stale consumedUnitsCount mid-reversal.
    const offerIds = [...new Set(consumptions.map((c) => c.offerId))];
    const lockedOffers = new Map<string, Offer>();
    for (const offerId of offerIds) {
      const locked = await manager.findOne(Offer, { where: { id: offerId }, lock: { mode: 'pessimistic_write' } });
      if (locked) lockedOffers.set(offerId, locked);
    }

    const now = new Date();
    for (const consumption of consumptions) {
      consumption.isReversed = true;
      consumption.reversedAt = now;
      await manager.save(OfferConsumption, consumption);

      const offer = lockedOffers.get(consumption.offerId);
      if (offer) {
        offer.consumedUnitsCount = Math.max(0, offer.consumedUnitsCount - consumption.quantityConsumed);
        offer.consumedDiscountMinor = Math.max(0, offer.consumedDiscountMinor - consumption.discountAppliedMinor);
      }
    }

    for (const offer of lockedOffers.values()) {
      await manager.save(Offer, offer);
    }
  }

  async recordHatlyFundedDiscountEvent(orderId: string, totalDiscountMinor: number): Promise<void> {
    if (totalDiscountMinor <= 0) return;
    await this.financialEventService.record({
      type: FinancialEventType.HATLY_FUNDED_OFFER_DISCOUNT_RECORDED,
      direction: FinancialEventDirection.INFORMATIONAL,
      idempotencyKey: `hatly-funded-offer-discount:${orderId}`,
      amountMinor: totalDiscountMinor,
      orderId,
      reason: 'Hatly-funded promotional discount - Vendor commission basis is unaffected (see OrderFinancialEventsService).',
    });
  }

  private computeFlashSaleDiscountPerUnit(offer: Offer, unitPriceMinor: number): number {
    if (offer.specialPriceMinor == null) return 0;
    return Math.max(0, unitPriceMinor - offer.specialPriceMinor);
  }

  private computeSubtotalDiscount(offer: Offer, eligibleSubtotalMinor: number): number {
    if (offer.minimumEligibleSubtotalMinor != null && eligibleSubtotalMinor < offer.minimumEligibleSubtotalMinor) {
      return 0;
    }

    let calculated: number;
    if (offer.discountType === DiscountType.PERCENTAGE) {
      calculated = Math.round((eligibleSubtotalMinor * (offer.discountValue ?? 0)) / 10000);
    } else {
      calculated = Math.min(offer.discountValue ?? 0, eligibleSubtotalMinor);
    }

    if (offer.maximumDiscountMinor != null) {
      calculated = Math.min(calculated, offer.maximumDiscountMinor);
    }

    return Math.max(0, calculated);
  }

  private async findMatchingActiveOffers(
    manager: EntityManager,
    params: { vendorBranchId: string; productId: string; categoryId: string; now: Date; mechanism: OfferMechanism },
  ): Promise<Offer[]> {
    // Sequential on purpose: `manager` is frequently a TRANSACTION's
    // manager, i.e. ONE pg connection. Firing three queries at once on
    // a single connection is deprecated in node-postgres 8 ("Calling
    // client.query() when the client is already executing a query") and
    // becomes an error in pg 9 — flagged by the real-database
    // integration suite. Same three queries, same results.
    const byProduct = await manager.find(OfferProduct, { where: { productId: params.productId } });
    const byCategory = await manager.find(OfferCategory, { where: { productCategoryId: params.categoryId } });
    const branchOffers = await manager.find(Offer, { where: { vendorBranchId: params.vendorBranchId, mechanism: params.mechanism } });

    const targetedOfferIds = new Set([...byProduct.map((r) => r.offerId), ...byCategory.map((r) => r.offerId)]);

    const branchWideOfferIds = new Set<string>();
    for (const offer of branchOffers) {
      const hasProductTargets = await manager.count(OfferProduct, { where: { offerId: offer.id } });
      if (hasProductTargets > 0) continue;
      const hasCategoryTargets = await manager.count(OfferCategory, { where: { offerId: offer.id } });
      if (hasCategoryTargets > 0) continue;
      branchWideOfferIds.add(offer.id);
    }

    const candidateOfferIds = [...new Set([...targetedOfferIds, ...branchWideOfferIds])];
    if (candidateOfferIds.length === 0) return [];

    const offers = await manager.find(Offer, {
      where: { id: In(candidateOfferIds), vendorBranchId: params.vendorBranchId, mechanism: params.mechanism },
    });
    // A coupon offer (one with a code) is NEVER applied automatically — only when its code is entered (see planCouponForCart).
    return offers.filter((o) => !o.couponCode && o.isActive && o.startAt <= params.now && params.now < o.endAt);
  }

  private async offerTargetsProduct(
    manager: EntityManager,
    offer: Offer,
    vendorBranchId: string,
    productId: string,
    categoryId: string,
  ): Promise<boolean> {
    if (offer.vendorBranchId !== vendorBranchId) return false;
    const directCount = await manager.count(OfferProduct, { where: { offerId: offer.id, productId } });
    if (directCount > 0) return true;
    const categoryCount = await manager.count(OfferCategory, { where: { offerId: offer.id, productCategoryId: categoryId } });
    if (categoryCount > 0) return true;
    const anyProductTargets = await manager.count(OfferProduct, { where: { offerId: offer.id } });
    const anyCategoryTargets = await manager.count(OfferCategory, { where: { offerId: offer.id } });
    return anyProductTargets === 0 && anyCategoryTargets === 0;
  }
}
