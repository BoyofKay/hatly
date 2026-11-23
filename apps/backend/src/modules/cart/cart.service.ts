import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { assertNonNegativeUnitPrice, validateOptionSelection } from '../products/option-selection';
import { sectorAllowsCustomRequests } from '../sectors/entities/marketplace-sector.entity';
import { Cart, CartStatus } from './entities/cart.entity';
import { CartVendorGroup } from './entities/cart-vendor-group.entity';
import { CartItem } from './entities/cart-item.entity';
import { CartItemOptionValue } from './entities/cart-item-option-value.entity';
import { CartGroupType } from './cart-group-type.enum';
import { FulfillmentType } from './fulfillment-type.enum';
import { AdHocServiceType } from './ad-hoc-service-type.enum';
import { Product } from '../products/entities/product.entity';
import { VendorBranch } from '../vendors/entities/vendor-branch.entity';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { AddAdHocCartItemDto } from './dto/add-adhoc-cart-item.dto';
import { UpdateAdHocRouteDto } from './dto/update-adhoc-route.dto';
import { AddVendorCustomItemDto } from './dto/add-vendor-custom-item.dto';
import { CartPricingService } from './cart-pricing.service';
import { CartView } from './cart-view.interface';
import { UploadsService } from '../uploads/uploads.service';
import { DeliveryFeeCalculationService } from '../delivery-fee/delivery-fee-calculation.service';
import { PricingUnit } from '../products/pricing-unit.enum';
import { OfferConsumptionService, OfferCandidateItem } from '../offers/offer-consumption.service';

const MAX_GROUPS_PER_CART = 3;
const MAX_AD_HOC_GROUPS_PER_CART = 1; // Hatly Service: single location only, confirmed business rule
const MAX_IMAGES_PER_AD_HOC_ITEM = 2;

const CART_RELATIONS = {
  groups: { items: { product: true, selectedOptionValues: { optionValue: true } } },
} as const;

/** A short display label: trimmed, capped at the column length, empty → null. */
function cleanLabel(label: string | null | undefined): string | null {
  const trimmed = (label ?? '').trim().slice(0, 120);
  return trimmed.length > 0 ? trimmed : null;
}

@Injectable()
export class CartService {
  constructor(
    @InjectRepository(Cart) private readonly cartsRepository: Repository<Cart>,
    @InjectRepository(VendorBranch) private readonly branchesRepository: Repository<VendorBranch>,
    private readonly dataSource: DataSource,
    private readonly pricingService: CartPricingService,
    private readonly uploadsService: UploadsService,
    private readonly deliveryFeeCalculationService: DeliveryFeeCalculationService,
    private readonly offerConsumptionService: OfferConsumptionService,
  ) {}

  async getCartView(customerId: string): Promise<CartView> {
    const cart = await this.getOrCreateActiveCart(customerId);
    return this.buildView(cart);
  }

  /**
   * Read-only preview — computes what the delivery fee WOULD be for
   * the customer's current cart against a supplied delivery location,
   * without persisting anything. Reuses the exact same
   * DeliveryFeeCalculationService that OrderCreationService calls at
   * actual confirmation, so a quote and the fee eventually frozen on
   * the real order can never structurally diverge — only a
   * BusinessConfig change between the two moments could change the
   * number, which is expected and not a bug (see the delivery-fee
   * report's edge-case notes).
   */
  async quoteDeliveryFee(
    customerId: string,
    customerLocation: { latitude: number; longitude: number },
  ): Promise<{
    applicable: boolean;
    reason?: 'AD_HOC_SERVICE_NOT_APPLICABLE' | 'EMPTY_CART';
    deliveryFeeMinor?: number;
  }> {
    const cart = await this.getOrCreateActiveCart(customerId);

    if (cart.groups.length === 0) {
      return { applicable: false, reason: 'EMPTY_CART' };
    }
    if (cart.groups[0].groupType === CartGroupType.AD_HOC_SERVICE) {
      // Hatly Service never uses this formula — see HatlyServicePricingConfig.
      return { applicable: false, reason: 'AD_HOC_SERVICE_NOT_APPLICABLE' };
    }
    if (cart.fulfillmentType === FulfillmentType.PICKUP) {
      // No delivery is being rendered under pickup — see the report's
      // reasoning for why this is 0, not an invented price.
      return { applicable: true, deliveryFeeMinor: 0 };
    }

    const branchIds = [...new Set(cart.groups.map((g) => g.vendorBranchId!))];
    const branches = await this.branchesRepository.find({ where: branchIds.map((id) => ({ id })) });

    const breakdown = await this.deliveryFeeCalculationService.calculate(branches, customerLocation);
    return { applicable: true, deliveryFeeMinor: breakdown.deliveryFeeMinor };
  }

  /**
   * Adds a catalog item, enforcing (in order): product exists &
   * available & belongs to an active branch -> resolve or create the
   * matching CATALOG group (rejecting a 4th distinct vendor, and
   * rejecting entirely under a PICKUP cart that already has a group)
   * -> option validation (unchanged from Phase 2D).
   */
  async addItem(customerId: string, dto: AddCartItemDto): Promise<CartView> {
    const fullCart = await this.dataSource.transaction(async (manager) => {
      const cart = await this.getOrCreateActiveCartLocked(manager, customerId);

      const product = await manager.findOne(Product, {
        where: { id: dto.productId },
        relations: { options: { values: true }, vendorBranch: { vendor: true } },
      });

      if (!product || product.deletedAt) {
        throw new NotFoundException('Product not found.');
      }
      if (!product.isAvailable) {
        throw new BadRequestException({
          message: 'This product is currently unavailable.',
          details: { code: 'PRODUCT_UNAVAILABLE' },
        });
      }
      // A deactivated VENDOR must block ordering exactly like a deactivated branch (the marketplace
      // and search already hide it); vendor.isActive used to be ignored here (Group 8 finding).
      if (!product.vendorBranch || !product.vendorBranch.isActive || !product.vendorBranch.vendor?.isActive) {
        throw new BadRequestException({
          message: 'This vendor branch is currently unavailable.',
          details: { code: 'BRANCH_UNAVAILABLE' },
        });
      }

      if (!product.vendorBranch.isOpen) {
        throw new BadRequestException({
          message: 'This store is currently closed. You can browse its menu, but cannot add items to the cart.',
          details: { code: 'STORE_CLOSED' },
        });
      }

      const groups = await manager.find(CartVendorGroup, { where: { cartId: cart.id } });
      let group = groups.find(
        (g) => g.groupType === CartGroupType.CATALOG && g.vendorBranchId === product.vendorBranchId,
      );

      if (!group) {
        this.assertCanAddNewGroup(cart, groups, CartGroupType.CATALOG);
        group = await manager.save(
          CartVendorGroup,
          manager.create(CartVendorGroup, {
            cartId: cart.id,
            groupType: CartGroupType.CATALOG,
            vendorBranchId: product.vendorBranchId,
          }),
        );
      }

      const selectedOptionValueIds = dto.selectedOptionValueIds ?? [];
      this.validateSelectedOptions(product, selectedOptionValueIds);

      // PHASE G addition (Weighted Products). CONFIRMED: never overload
      // `quantity` to mean grams — a WEIGHT product requires a positive
      // `requestedWeightGrams` and always stores `quantity: 1` (one
      // weight-line = one request); a PIECE product must not supply
      // `requestedWeightGrams` at all.
      const isWeighted = product.pricingUnit === PricingUnit.WEIGHT;
      if (isWeighted && (!dto.requestedWeightGrams || dto.requestedWeightGrams <= 0)) {
        throw new BadRequestException({
          message: 'This product is sold by weight — requestedWeightGrams is required.',
          details: { code: 'REQUESTED_WEIGHT_GRAMS_REQUIRED' },
        });
      }
      if (!isWeighted && dto.requestedWeightGrams !== undefined) {
        throw new BadRequestException({
          message: 'This product is not sold by weight.',
          details: { code: 'WEIGHT_NOT_APPLICABLE' },
        });
      }

      const item = await manager.save(
        CartItem,
        manager.create(CartItem, {
          cartVendorGroupId: group.id,
          productId: product.id,
          quantity: isWeighted ? 1 : dto.quantity,
          requestedWeightGrams: isWeighted ? dto.requestedWeightGrams : null,
          notes: dto.notes ?? null,
        }),
      );

      if (selectedOptionValueIds.length > 0) {
        const optionValueRows = selectedOptionValueIds.map((id) =>
          manager.create(CartItemOptionValue, { cartItemId: item.id, productOptionValueId: id }),
        );
        await manager.save(CartItemOptionValue, optionValueRows);
      }

      const fullCart = await this.loadCartWithRelations(manager, cart.id);
      return fullCart;
    });
    // Rendered AFTER the transaction has committed and released its connection: buildView reads other tables through the
    // pool, and doing that while still holding a pooled connection starves the pool under concurrent load (M5 Batch 3).
    return this.buildView(fullCart);
  }

  /**
   * Adds an AD_HOC_SERVICE ("Hatly Service") item — either to an
   * existing ad-hoc group already in this cart, or creating a new one
   * (subject to the same 3-group cap and pickup restriction as
   * catalog items). Every submitted image URL must be a real,
   * customer-owned Hatly upload (see uploads module) — an arbitrary
   * external URL is rejected, never silently accepted.
   */
  async addAdHocItem(customerId: string, dto: AddAdHocCartItemDto): Promise<CartView> {
    const fullCart = await this.dataSource.transaction(async (manager) => {
      const cart = await this.getOrCreateActiveCartLocked(manager, customerId);
      const groups = await manager.find(CartVendorGroup, { where: { cartId: cart.id } });

      let group: CartVendorGroup;
      if (dto.cartVendorGroupId) {
        const existing = groups.find((g) => g.id === dto.cartVendorGroupId);
        if (!existing || existing.groupType !== CartGroupType.AD_HOC_SERVICE) {
          throw new NotFoundException('Ad-hoc cart group not found.');
        }
        group = existing;
      } else {
        if (!dto.adHocPlaceName) {
          throw new BadRequestException({
            message: 'A place name is required to start a new Hatly Service item.',
            details: { code: 'AD_HOC_PLACE_NAME_REQUIRED' },
          });
        }
        if (!dto.adHocServiceType) {
          throw new BadRequestException({
            message: 'A Hatly Service type ("buy from a place" or "deliver to a place") is required.',
            details: { code: 'AD_HOC_SERVICE_TYPE_REQUIRED' },
          });
        }
        this.assertCanAddNewGroup(cart, groups, CartGroupType.AD_HOC_SERVICE);

        // Route endpoints (PD-012): both service types may carry an origin and/or a destination; each coordinate pair must be
        // supplied together, never just one half of it.
        const hasPickupPair = dto.pickupLatitude !== undefined || dto.pickupLongitude !== undefined;
        const hasDestinationPair =
          dto.destinationLatitude !== undefined || dto.destinationLongitude !== undefined;
        if (hasPickupPair && (dto.pickupLatitude === undefined || dto.pickupLongitude === undefined)) {
          throw new BadRequestException({
            message: 'Both pickup latitude and longitude are required together.',
            details: { code: 'INCOMPLETE_COORDINATE' },
          });
        }
        if (
          hasDestinationPair &&
          (dto.destinationLatitude === undefined || dto.destinationLongitude === undefined)
        ) {
          throw new BadRequestException({
            message: 'Both destination latitude and longitude are required together.',
            details: { code: 'INCOMPLETE_COORDINATE' },
          });
        }
        group = await manager.save(
          CartVendorGroup,
          manager.create(CartVendorGroup, {
            cartId: cart.id,
            groupType: CartGroupType.AD_HOC_SERVICE,
            adHocPlaceName: dto.adHocPlaceName,
            adHocServiceType: dto.adHocServiceType,
            adHocPickupLatitude: dto.pickupLatitude ?? null,
            adHocPickupLongitude: dto.pickupLongitude ?? null,
            adHocDestinationLatitude: dto.destinationLatitude ?? null,
            adHocDestinationLongitude: dto.destinationLongitude ?? null,
            adHocPickupLabel: dto.pickupLatitude !== undefined ? cleanLabel(dto.pickupLabel) : null,
            adHocDestinationLabel: dto.destinationLatitude !== undefined ? cleanLabel(dto.destinationLabel) : null,
          }),
        );
      }

      const imageUrls = dto.imageUrls ?? [];
      if (imageUrls.length > MAX_IMAGES_PER_AD_HOC_ITEM) {
        throw new BadRequestException({
          message: `A Hatly Service item may have at most ${MAX_IMAGES_PER_AD_HOC_ITEM} images.`,
          details: { code: 'TOO_MANY_IMAGES' },
        });
      }
      if (imageUrls.length > 0) {
        const ownedUrls = await this.uploadsService.findOwnedUrls(imageUrls, customerId);
        const invalid = imageUrls.filter((url) => !ownedUrls.has(url));
        if (invalid.length > 0) {
          throw new BadRequestException({
            message: 'One or more images are not valid Hatly uploads.',
            details: { code: 'INVALID_IMAGE_REFERENCE' },
          });
        }
      }

      await manager.save(
        CartItem,
        manager.create(CartItem, {
          cartVendorGroupId: group.id,
          productId: null,
          quantity: dto.quantity,
          freeTextDescription: dto.freeTextDescription,
          imageUrls: imageUrls.length > 0 ? imageUrls : null,
        }),
      );

      const fullCart = await this.loadCartWithRelations(manager, cart.id);
      return fullCart;
    });
    // Rendered AFTER the transaction has committed and released its connection: buildView reads other tables through the
    // pool, and doing that while still holding a pooled connection starves the pool under concurrent load (M5 Batch 3).
    return this.buildView(fullCart);
  }

  /**
   * PD-012. Changes the route endpoints of the cart's Hatly / Wasally group, each independently:
   *   - an endpoint object sets it; `null` clears it back to the service's configured default; an omitted end is left unchanged.
   * Only stores what the customer chose — the server resolves and prices the route at quote and order time, so nothing here can
   * change a price, and a changed endpoint makes any earlier quote stale (it is part of the quote fingerprint).
   */
  async updateAdHocRoute(customerId: string, dto: UpdateAdHocRouteDto): Promise<CartView> {
    const fullCart = await this.dataSource.transaction(async (manager) => {
      const cart = await this.getOrCreateActiveCartLocked(manager, customerId);
      const group = await manager.findOne(CartVendorGroup, { where: { cartId: cart.id, groupType: CartGroupType.AD_HOC_SERVICE } });
      if (!group) throw new NotFoundException('There is no Hatly Service request in the cart.');
      if (dto.origin !== undefined) {
        group.adHocPickupLatitude = dto.origin?.latitude ?? null;
        group.adHocPickupLongitude = dto.origin?.longitude ?? null;
        group.adHocPickupLabel = dto.origin ? cleanLabel(dto.origin.label) : null;
      }
      if (dto.destination !== undefined) {
        group.adHocDestinationLatitude = dto.destination?.latitude ?? null;
        group.adHocDestinationLongitude = dto.destination?.longitude ?? null;
        group.adHocDestinationLabel = dto.destination ? cleanLabel(dto.destination.label) : null;
      }
      await manager.save(CartVendorGroup, group);
      return this.loadCartWithRelations(manager, cart.id);
    });
    return this.buildView(fullCart);
  }

  /**
   * Vendor/Pharmacy Custom Item. CONFIRMED per the approved design:
   * this can ONLY attach to an EXISTING CATALOG group — it never
   * creates a group of its own (unlike addAdHocItem, which can start a
   * new AD_HOC_SERVICE group). No AD_HOC_SERVICE group is ever
   * touched or created by this method — the External Hatly Service
   * flow remains entirely untouched.
   *
   * Ownership: the group must belong to THIS customer's own active
   * cart and must already be `CATALOG` — never a different customer's
   * group, never an AD_HOC_SERVICE group (mirrors the exact same
   * "not found, don't leak which case" pattern `addAdHocItem` already
   * uses for its own group-type check).
   *
   * `vendorBranchId` is preserved automatically — this method never
   * writes to it, it simply reuses the group exactly as it already
   * is, so the existing product items and the new custom item share
   * the same, unchanged branch.
   *
   * `productId` stays `null` and `unitPriceMinor` is never set here —
   * CartPricingService's existing `!item.product` branch already
   * treats this exactly like a Hatly Service item for pricing
   * purposes (lineTotalMinor: null, contributing 0 to the group
   * subtotal) — no change needed there, reused as-is.
   */
  async addVendorCustomItem(customerId: string, dto: AddVendorCustomItemDto): Promise<CartView> {
    const fullCart = await this.dataSource.transaction(async (manager) => {
      const cart = await this.getOrCreateActiveCartLocked(manager, customerId);
      const groups = await manager.find(CartVendorGroup, { where: { cartId: cart.id } });

      let group: CartVendorGroup;
      if (dto.cartVendorGroupId) {
        const existing = groups.find((g) => g.id === dto.cartVendorGroupId);
        if (!existing || existing.groupType !== CartGroupType.CATALOG) {
          throw new NotFoundException('Cart group not found.');
        }
        group = existing;
      } else {
        // Empty CATALOG group fix. Starts a brand-new CATALOG group
        // for this branch — CONFIRMED, mirrors addItem's own
        // group-creation path exactly (same branch-existence/active
        // check, same assertCanAddNewGroup call, same 3-group cap,
        // same multi-vendor segmentation rules) — never an
        // AD_HOC_SERVICE group.
        if (!dto.vendorBranchId) {
          throw new BadRequestException({
            message: 'Either an existing cart group or a vendorBranchId is required.',
            details: { code: 'VENDOR_BRANCH_OR_GROUP_REQUIRED' },
          });
        }
        const branch = await this.branchesRepository.findOne({ where: { id: dto.vendorBranchId }, relations: { vendor: true } });
        if (!branch || !branch.isActive || !branch.vendor?.isActive) {
          throw new BadRequestException({
            message: 'This vendor branch is currently unavailable.',
            details: { code: 'BRANCH_UNAVAILABLE' },
          });
        }
        const reusableExisting = groups.find(
          (g) => g.groupType === CartGroupType.CATALOG && g.vendorBranchId === dto.vendorBranchId,
        );
        if (reusableExisting) {
          group = reusableExisting;
        } else {
          this.assertCanAddNewGroup(cart, groups, CartGroupType.CATALOG);
          group = await manager.save(
            CartVendorGroup,
            manager.create(CartVendorGroup, {
              cartId: cart.id,
              groupType: CartGroupType.CATALOG,
              vendorBranchId: dto.vendorBranchId,
            }),
          );
        }
      }

      // The sector's admin setting is the rule, enforced here for EVERY route into this method (a new group or an existing one):
      // hiding the entry point in the app is not a control. A branch without an active, enabled sector cannot take custom requests.
      await this.assertCustomRequestsAllowed(manager, group.vendorBranchId);

      // Free Text OR Image fix. CONFIRMED: valid with free text, OR at
      // least one image, OR both — never required together. A
      // single-field validator can't express this, so it's enforced
      // here, the same way this DTO's own group-targeting cross-field
      // rule is enforced here rather than in the DTO.
      const imageUrls = dto.imageUrls ?? [];
      if (!dto.freeTextDescription && imageUrls.length === 0) {
        throw new BadRequestException({
          message: 'A custom item requires a description or at least one image.',
          details: { code: 'CUSTOM_ITEM_CONTENT_REQUIRED' },
        });
      }

      if (imageUrls.length > MAX_IMAGES_PER_AD_HOC_ITEM) {
        throw new BadRequestException({
          message: `A custom item may have at most ${MAX_IMAGES_PER_AD_HOC_ITEM} images.`,
          details: { code: 'TOO_MANY_IMAGES' },
        });
      }
      if (imageUrls.length > 0) {
        const ownedUrls = await this.uploadsService.findOwnedUrls(imageUrls, customerId);
        const invalid = imageUrls.filter((url) => !ownedUrls.has(url));
        if (invalid.length > 0) {
          throw new BadRequestException({
            message: 'One or more images are not valid Hatly uploads.',
            details: { code: 'INVALID_IMAGE_REFERENCE' },
          });
        }
      }

      await manager.save(
        CartItem,
        manager.create(CartItem, {
          cartVendorGroupId: group.id,
          productId: null,
          quantity: 1,
          freeTextDescription: dto.freeTextDescription ?? null,
          imageUrls: imageUrls.length > 0 ? imageUrls : null,
        }),
      );

      const fullCart = await this.loadCartWithRelations(manager, cart.id);
      return fullCart;
    });
    // Rendered AFTER the transaction has committed and released its connection: buildView reads other tables through the
    // pool, and doing that while still holding a pooled connection starves the pool under concurrent load (M5 Batch 3).
    return this.buildView(fullCart);
  }

  private async assertCustomRequestsAllowed(manager: EntityManager, vendorBranchId: string | null | undefined): Promise<void> {
    const branch = vendorBranchId
      ? await manager.findOne(VendorBranch, { where: { id: vendorBranchId }, relations: { marketplaceSector: true } })
      : null;
    if (!sectorAllowsCustomRequests(branch?.marketplaceSector)) {
      throw new ForbiddenException({
        message: 'Custom requests are not available for this vendor.',
        details: { code: 'CUSTOM_REQUESTS_NOT_AVAILABLE' },
      });
    }
  }

  async setFulfillmentType(customerId: string, fulfillmentType: FulfillmentType): Promise<CartView> {
    const cart = await this.getOrCreateActiveCart(customerId);

    if (fulfillmentType === FulfillmentType.PICKUP) {
      if (cart.groups.length > 1) {
        throw new ConflictException({
          message: 'Pickup is only available for a single-vendor cart.',
          details: { code: 'PICKUP_SINGLE_VENDOR_ONLY' },
        });
      }
      const [onlyGroup] = cart.groups;
      if (onlyGroup) {
        if (onlyGroup.groupType !== CartGroupType.CATALOG) {
          throw new ConflictException({
            message: 'Pickup is only available for a registered vendor.',
            details: { code: 'PICKUP_REGISTERED_VENDOR_ONLY' },
          });
        }
        const branch = await this.branchesRepository.findOne({ where: { id: onlyGroup.vendorBranchId! } });
        if (!branch?.pickupEnabled) {
          throw new ConflictException({
            message: 'This vendor does not offer pickup.',
            details: { code: 'BRANCH_PICKUP_DISABLED' },
          });
        }
      }
    }

    cart.fulfillmentType = fulfillmentType;
    await this.cartsRepository.save(cart);
    return this.buildView(cart);
  }

  async updateItemQuantity(customerId: string, itemId: string, quantity: number): Promise<CartView> {
    const cart = await this.getOwnedCartForItem(customerId, itemId);
    // PHASE G addition (Weighted Products). A WEIGHT item's amount is
    // never expressed via `quantity` — see updateItemWeight() instead.
    await this.assertNotWeightedItem(itemId);
    await this.dataSource.getRepository(CartItem).update({ id: itemId }, { quantity });
    const fullCart = await this.loadCartWithRelations(this.dataSource.manager, cart.id);
    return this.buildView(fullCart);
  }

  /**
   * PHASE G addition (Weighted Products). The WEIGHT-item counterpart
   * to updateItemQuantity() — updates `requestedWeightGrams` instead
   * of `quantity`, which stays fixed at 1 for a WEIGHT item (see
   * addItem's own comment).
   */
  async updateItemWeight(customerId: string, itemId: string, requestedWeightGrams: number): Promise<CartView> {
    const cart = await this.getOwnedCartForItem(customerId, itemId);
    const item = await this.dataSource.getRepository(CartItem).findOne({
      where: { id: itemId },
      relations: { product: true },
    });
    if (!item?.product || item.product.pricingUnit !== PricingUnit.WEIGHT) {
      throw new BadRequestException({
        message: 'This item is not sold by weight.',
        details: { code: 'WEIGHT_NOT_APPLICABLE' },
      });
    }
    await this.dataSource.getRepository(CartItem).update({ id: itemId }, { requestedWeightGrams });
    const fullCart = await this.loadCartWithRelations(this.dataSource.manager, cart.id);
    return this.buildView(fullCart);
  }

  private async assertNotWeightedItem(itemId: string): Promise<void> {
    const item = await this.dataSource.getRepository(CartItem).findOne({
      where: { id: itemId },
      relations: { product: true },
    });
    if (item?.product?.pricingUnit === PricingUnit.WEIGHT) {
      throw new BadRequestException({
        message: 'This item is sold by weight — update requestedWeightGrams instead of quantity.',
        details: { code: 'QUANTITY_NOT_APPLICABLE' },
      });
    }
  }

  async removeItem(customerId: string, itemId: string): Promise<CartView> {
    const cart = await this.getOwnedCartForItem(customerId, itemId);
    const item = await this.dataSource
      .getRepository(CartItem)
      .findOne({ where: { id: itemId } });
    await this.dataSource.getRepository(CartItem).delete({ id: itemId });

    // If that was the last item in its group, remove the now-empty
    // group too — releases that vendor slot, same principle as Phase
    // 2D's single-branch release-on-empty behavior.
    if (item) {
      const remaining = await this.dataSource
        .getRepository(CartItem)
        .count({ where: { cartVendorGroupId: item.cartVendorGroupId } });
      if (remaining === 0) {
        await this.dataSource.getRepository(CartVendorGroup).delete({ id: item.cartVendorGroupId });
      }
    }

    const fullCart = await this.loadCartWithRelations(this.dataSource.manager, cart.id);
    return this.buildView(fullCart);
  }

  async clearCart(customerId: string): Promise<CartView> {
    const cart = await this.getOrCreateActiveCart(customerId);
    // Deleting the groups cascades to their items/option-values at the
    // DB level (ON DELETE CASCADE — see the migration).
    await this.dataSource.getRepository(CartVendorGroup).delete({ cartId: cart.id });
    const fullCart = await this.loadCartWithRelations(this.dataSource.manager, cart.id);
    return this.buildView(fullCart);
  }

  // ---- internals ----

  /** The same group rules `addItem` applies — public so the read-only compatibility check shares them instead of copying them. */
  assertNewGroupAllowed(cart: Cart, existingGroups: CartVendorGroup[], newGroupType: CartGroupType): void {
    this.assertCanAddNewGroup(cart, existingGroups, newGroupType);
  }

  private assertCanAddNewGroup(
    cart: Cart,
    existingGroups: CartVendorGroup[],
    newGroupType: CartGroupType,
  ): void {
    // CONFIRMED BUSINESS RULE (post-Step-3 correction): a Cart/Order
    // must never contain both CATALOG and AD_HOC_SERVICE groups — a
    // registered-vendor order and a Hatly Service order are two
    // distinct order types, not one mixed order. Checked first,
    // before the 3-group cap and pickup rules below, since it's the
    // more fundamental of the two constraints.
    if (existingGroups.length > 0 && existingGroups[0].groupType !== newGroupType) {
      throw new ConflictException({
        message:
          'A cart cannot contain both registered-vendor items and Hatly Service items. Clear your cart to switch.',
        details: { code: 'CATALOG_AD_HOC_MIX_NOT_ALLOWED' },
      });
    }

    if (cart.fulfillmentType === FulfillmentType.PICKUP) {
      if (existingGroups.length >= 1) {
        throw new ConflictException({
          message: 'Pickup is only available for a single-vendor cart. Switch to delivery to add another vendor.',
          details: { code: 'PICKUP_SINGLE_VENDOR_ONLY' },
        });
      }
      if (newGroupType === CartGroupType.AD_HOC_SERVICE) {
        throw new ConflictException({
          message: 'Pickup is only available for a registered vendor.',
          details: { code: 'PICKUP_REGISTERED_VENDOR_ONLY' },
        });
      }
    }

    if (existingGroups.length >= MAX_GROUPS_PER_CART) {
      throw new ConflictException({
        message: `A cart may contain items from at most ${MAX_GROUPS_PER_CART} vendors.`,
        details: { code: 'MAX_VENDOR_GROUPS_EXCEEDED' },
      });
    }

    // CONFIRMED BUSINESS RULE: Hatly Service ("هاتلي من"/"وصلي") never
    // supports multiple locations in one cart, regardless of the
    // general 3-group cap above — a Hatly Service cart is capped at
    // exactly one group.
    if (newGroupType === CartGroupType.AD_HOC_SERVICE && existingGroups.length >= MAX_AD_HOC_GROUPS_PER_CART) {
      throw new ConflictException({
        message: 'A Hatly Service order can only include one location.',
        details: { code: 'AD_HOC_SERVICE_SINGLE_LOCATION_ONLY' },
      });
    }
  }

  private async getOrCreateActiveCart(customerId: string): Promise<Cart> {
    let cart = await this.cartsRepository.findOne({ where: { customerId, status: CartStatus.ACTIVE } });
    if (!cart) {
      cart = await this.cartsRepository.save(
        this.cartsRepository.create({ customerId, status: CartStatus.ACTIVE }),
      );
    }
    return this.loadCartWithRelations(this.dataSource.manager, cart.id);
  }

  private async getOrCreateActiveCartLocked(
    manager: DataSource['manager'],
    customerId: string,
  ): Promise<Cart> {
    let cart = await manager.findOne(Cart, {
      where: { customerId, status: CartStatus.ACTIVE },
      lock: { mode: 'pessimistic_write' },
    });
    if (!cart) {
      cart = await manager.save(Cart, manager.create(Cart, { customerId, status: CartStatus.ACTIVE }));
    }
    return cart;
  }

  private async getOwnedCartForItem(customerId: string, itemId: string): Promise<Cart> {
    const cart = await this.cartsRepository.findOne({ where: { customerId, status: CartStatus.ACTIVE } });
    if (!cart) {
      throw new NotFoundException('Cart item not found.');
    }
    const item = await this.dataSource
      .getRepository(CartItem)
      .findOne({ where: { id: itemId }, relations: { cartVendorGroup: true } });
    if (!item || item.cartVendorGroup.cartId !== cart.id) {
      // Deliberately the same "not found" whether the item never
      // existed or belongs to someone else's cart — no reason to leak
      // which.
      throw new NotFoundException('Cart item not found.');
    }
    return cart;
  }

  private loadCartWithRelations(manager: DataSource['manager'], cartId: string): Promise<Cart> {
    return manager
      .findOne(Cart, { where: { id: cartId }, relations: CART_RELATIONS })
      .then((cart) => cart!); // safe: caller always just created/confirmed this row exists in the same flow
  }

  private async buildView(cart: Cart): Promise<CartView> {
    const catalogBranchIds = cart.groups
      .filter((g) => g.groupType === CartGroupType.CATALOG && g.vendorBranchId)
      .map((g) => g.vendorBranchId!);

    const vendorNameByBranchId = new Map<string, string>();

    if (catalogBranchIds.length > 0) {
      const branches = await this.branchesRepository.find({
        where: catalogBranchIds.map((id) => ({ id })),
        relations: { vendor: true },
      });
      for (const branch of branches) {
        vendorNameByBranchId.set(branch.id, branch.vendor?.name ?? branch.name);
      }
    }

    return this.applyOfferPreview(this.pricingService.buildCartView(cart, vendorNameByBranchId), cart);
  }

  /**
   * PHASE G addition (Offers & Promotions). Kept OUT of
   * CartPricingService.buildCartView itself — that function stays a
   * pure, DB-free computation (OrderCreationService also calls it
   * directly for the AUTHORITATIVE pricing pass and must never trigger
   * an Offer lookup as a side effect of that). This step only decorates
   * the already-built view for CUSTOMER DISPLAY — see
   * OfferConsumptionService.previewOffersForItems' own comment for
   * exactly what guarantees this preview does and does not make.
   */
  private async applyOfferPreview(view: CartView, cart: Cart): Promise<CartView> {
    const candidates: OfferCandidateItem[] = [];
    for (let i = 0; i < cart.groups.length; i++) {
      const group = cart.groups[i];
      if (group.groupType !== CartGroupType.CATALOG || !group.vendorBranchId) continue;
      const groupView = view.groups[i];
      for (let j = 0; j < group.items.length; j++) {
        const item = group.items[j];
        const itemView = groupView.items[j];
        if (!item.product || !item.productId || itemView.unitPriceMinor == null) continue;
        candidates.push({
          cartItemId: item.id,
          vendorBranchId: group.vendorBranchId,
          productId: item.productId,
          categoryId: item.product.categoryId,
          quantity: item.quantity,
          unitPriceMinor: itemView.unitPriceMinor,
          basePriceMinor: item.product.priceMinor,
          pricingUnit: item.product.pricingUnit,
        });
      }
    }
    if (candidates.length === 0) return view;

    const { flashSalePreviews, subtotalDiscountPreviews } = await this.offerConsumptionService.previewOffersForItems(
      candidates,
    );
    if (flashSalePreviews.size === 0 && subtotalDiscountPreviews.size === 0) return view;

    for (const group of view.groups) {
      let groupHasSubtotalDiscount = false;
      for (const itemView of group.items) {
        const flashSale = flashSalePreviews.get(itemView.id);
        if (flashSale) {
          itemView.offerId = flashSale.offerId;
          itemView.offerDiscountType = flashSale.discountType;
          itemView.offerDiscountValue = flashSale.discountValue;
          itemView.offerDiscountedQuantity = flashSale.discountedQuantity;
          itemView.offerDiscountAmountMinor = flashSale.discountAmountMinor;
          itemView.payableLineTotalMinor =
            itemView.lineTotalMinor != null ? itemView.lineTotalMinor - (flashSale.discountAmountMinor ?? 0) : null;
          // Customer Offers Integration. Unambiguous fields — never
          // reverse-engineered from the legacy discountType/Value
          // pair above, which no longer cleanly represents a
          // replacement price.
          itemView.offerMechanism = 'FLASH_SALE';
          itemView.specialPriceMinor = flashSale.specialPriceMinor;
        }
        if (subtotalDiscountPreviews.has(itemView.id)) {
          groupHasSubtotalDiscount = true;
        }
      }
      // Customer Offers Integration. Segment-level, non-authoritative
      // signal only — CONFIRMED never a computed discount amount (see
      // SubtotalDiscountPreviewResult's own comment); the real amount
      // is only known authoritatively at checkout.
      group.hasSubtotalDiscountOffer = groupHasSubtotalDiscount;
    }
    return view;
  }

  private validateSelectedOptions(product: Product, selectedOptionValueIds: string[]): void {
    // One shared rule (also applied again at checkout): required / min / max / single-choice / foreign values.
    validateOptionSelection(product.options, selectedOptionValueIds);
    assertNonNegativeUnitPrice(product.priceMinor, product.options, selectedOptionValueIds);
  }
}
