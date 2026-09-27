import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { EntityManager } from 'typeorm';
import { Cart } from '../../cart/entities/cart.entity';
import { CartGroupType } from '../../cart/cart-group-type.enum';
import { CartVendorGroup } from '../../cart/entities/cart-vendor-group.entity';
import { FulfillmentType } from '../../cart/fulfillment-type.enum';
import { AdHocServiceType } from '../../cart/ad-hoc-service-type.enum';
import { CartPricingService } from '../../cart/cart-pricing.service';
import { VendorBranch } from '../../vendors/entities/vendor-branch.entity';
import { BusinessConfigService } from '../../business-config/business-config.service';
import { BusinessConfigKey } from '../../business-config/business-config-key.enum';
import { DeliveryFeeCalculationService } from '../../delivery-fee/delivery-fee-calculation.service';
import { HatlyServicePricingService } from '../../finance/hatly-service-pricing.service';
import { OfferCandidateItem, OfferConsumptionService, OfferSegmentPlan } from '../../offers/offer-consumption.service';
import { PricingUnit } from '../../products/pricing-unit.enum';
import { InventoryMode } from '../../products/inventory-mode.enum';
import { WalletService } from '../../wallet/wallet.service';
import { ElectronicPaymentMethod } from '../../payments/electronic-payment-method.enum';
import { OrderPaymentMethod } from '../order-payment-method';
import { AddressValidationService } from './address-validation.service';
import { CheckoutInput, CheckoutPlan, CheckoutSegmentPlan, CouponOutcome, EtaEstimate } from './checkout-plan';

interface StoredGeoPoint {
  latitude: number;
  longitude: number;
}

/**
 * The single place where a checkout is priced and validated. The read-only QUOTE endpoint and the transactional ORDER creation
 * both call `plan()`, so what a customer is quoted and what they are charged can never come from two diverging copies of the
 * rules (availability, pickup/multi-vendor rules, service area, delivery fee, offers, coupon, wallet, payment gating).
 *
 * QUOTE mode takes no row locks and reports address problems as data; ORDER mode runs under the cart lock, takes the offer /
 * wallet locks, and throws on any problem. Neither mode writes anything.
 */
@Injectable()
export class CheckoutPlannerService {
  constructor(
    private readonly cartPricingService: CartPricingService,
    private readonly businessConfigService: BusinessConfigService,
    private readonly deliveryFeeCalculationService: DeliveryFeeCalculationService,
    private readonly hatlyServicePricingService: HatlyServicePricingService,
    private readonly offerConsumptionService: OfferConsumptionService,
    private readonly addressValidationService: AddressValidationService,
    private readonly walletService: WalletService,
  ) {}

  async plan(manager: EntityManager, cart: Cart, input: CheckoutInput): Promise<CheckoutPlan> {
    const isOrder = input.mode === 'ORDER';
    const blockers: CheckoutPlan['blockers'] = [];

    // ---- 1. vendors, availability -------------------------------------------------------------------------------
    const catalogBranchIds = [
      ...new Set(cart.groups.filter((g) => g.groupType === CartGroupType.CATALOG && g.vendorBranchId).map((g) => g.vendorBranchId!)),
    ];
    const branches =
      catalogBranchIds.length > 0
        ? await manager.find(VendorBranch, { where: catalogBranchIds.map((id) => ({ id })), relations: { vendor: true } })
        : [];
    const branchById = new Map(branches.map((b) => [b.id, b]));

    for (const group of cart.groups) {
      if (group.groupType !== CartGroupType.CATALOG) continue;
      const branch = group.vendorBranchId ? branchById.get(group.vendorBranchId) : undefined;
      // vendor.isActive is enforced too: deactivating a Vendor must stop checkout even for a cart filled before it.
      if (!branch || !branch.isActive || !branch.vendor?.isActive) {
        throw new BadRequestException({
          message: 'One of the vendors in your cart is currently unavailable.',
          details: { code: 'BRANCH_UNAVAILABLE' },
        });
      }
      for (const item of group.items) {
        // A custom (product-less) item is intentionally never "unavailable"; a real product that vanished still is.
        if (!item.productId) continue;
        if (!item.product || !item.product.isAvailable || item.product.deletedAt) {
          throw new BadRequestException({
            message: 'One or more items in your cart are no longer available.',
            details: { code: 'PRODUCT_UNAVAILABLE' },
          });
        }
        if (!isOrder && item.product.inventoryMode === InventoryMode.TRACKED) {
          // Read-only hint for the quote; the authoritative check is the atomic decrement at order creation.
          const requested = item.product.pricingUnit === PricingUnit.WEIGHT ? item.requestedWeightGrams ?? 0 : item.quantity;
          if (requested > (item.product.quantity ?? 0)) {
            throw new BadRequestException({
              message: 'One or more items in your cart no longer have enough stock.',
              details: { code: 'INSUFFICIENT_INVENTORY', productId: item.product.id, availableQuantity: item.product.quantity ?? 0 },
            });
          }
        }
      }
    }

    // ---- 2. fulfilment rules -------------------------------------------------------------------------------------
    const fulfillmentType = cart.fulfillmentType;
    if (fulfillmentType === FulfillmentType.PICKUP) {
      if (cart.groups.length > 1) {
        throw new ConflictException({
          message: 'Pickup is only available for a single-vendor order.',
          details: { code: 'PICKUP_SINGLE_VENDOR_ONLY' },
        });
      }
      const [onlyGroup] = cart.groups;
      if (onlyGroup.groupType !== CartGroupType.CATALOG) {
        throw new ConflictException({
          message: 'Pickup is only available for a registered vendor.',
          details: { code: 'PICKUP_REGISTERED_VENDOR_ONLY' },
        });
      }
      if (!branchById.get(onlyGroup.vendorBranchId!)?.pickupEnabled) {
        throw new ConflictException({
          message: 'This vendor does not offer pickup.',
          details: { code: 'BRANCH_PICKUP_DISABLED' },
        });
      }
    }
    if (cart.groups.length > 1 && !input.multiVendorEnabled) {
      throw new ConflictException({
        message: 'Multi-vendor orders are temporarily unavailable. Please check out with a single vendor.',
        details: { code: 'MULTI_VENDOR_ORDERS_DISABLED' },
      });
    }

    // ---- 3. pricing view -----------------------------------------------------------------------------------------
    const vendorNameByBranchId = new Map(branches.map((b) => [b.id, b.vendor?.name ?? b.name]));
    const view = this.cartPricingService.buildCartView(cart, vendorNameByBranchId);
    const hasPendingAdHocPricing = cart.groups.some((g) => g.groupType === CartGroupType.AD_HOC_SERVICE);
    const hasWeightedItem = cart.groups.some((g) => g.items.some((i) => i.product?.pricingUnit === PricingUnit.WEIGHT));

    // ---- 4. payment-method rules that do not depend on the total --------------------------------------------------
    const requestedMethod = input.paymentMethod;
    const walletRequested = input.useWallet === true || requestedMethod === 'WALLET';
    const enabledElectronic = await this.businessConfigService.getEnabledElectronicPaymentMethods();
    const fail = (code: string, message: string, details: Record<string, unknown> = {}) => {
      if (isOrder) throw new BadRequestException({ message, details: { code, ...details } });
      blockers.push({ code, message, details });
    };

    if (requestedMethod === 'ONLINE') {
      fail('ONLINE_PAYMENT_NOT_AVAILABLE', 'Online payment is not available yet.');
    }
    if (requestedMethod === 'MANUAL_TRANSFER' && hasWeightedItem) {
      // The final amount of a weighed item is only known once the weight is recorded — no pre-payment against an estimate.
      fail(
        'MANUAL_TRANSFER_NOT_ALLOWED_FOR_WEIGHTED_ORDER',
        'Manual Transfer is not available for an order containing a weighed item — the final amount is only known once the actual weight is recorded.',
      );
    }
    if (hasPendingAdHocPricing && requestedMethod !== undefined && requestedMethod !== 'COD') {
      fail('ELECTRONIC_PAYMENT_NOT_ALLOWED_FOR_UNPRICED_ORDER', 'Orders containing an unpriced Hatly Service item must be paid on delivery.');
    }
    if (isOrder && requestedMethod === undefined) {
      fail('PAYMENT_METHOD_REQUIRED', 'Choose how you will pay.');
    }
    let electronicMethod: ElectronicPaymentMethod | null = null;
    if (requestedMethod === 'MANUAL_TRANSFER' || requestedMethod === 'PAY_AT_DELIVERY') {
      if (!input.electronicPaymentMethod) {
        fail('ELECTRONIC_PAYMENT_METHOD_REQUIRED', 'Choose the electronic payment method (InstaPay, Vodafone Cash, …).');
      } else if (!enabledElectronic.includes(input.electronicPaymentMethod)) {
        fail('ELECTRONIC_PAYMENT_METHOD_NOT_AVAILABLE', 'This electronic payment method is not available.', { method: input.electronicPaymentMethod });
      } else {
        electronicMethod = input.electronicPaymentMethod;
      }
    } else if (input.electronicPaymentMethod) {
      fail('ELECTRONIC_PAYMENT_METHOD_NOT_ALLOWED', 'An electronic payment method only applies to Manual Transfer and Pay at Delivery.');
    }
    if (requestedMethod === 'MANUAL_TRANSFER' && isOrder) {
      const destination = await this.businessConfigService.get<unknown>(BusinessConfigKey.MANUAL_TRANSFER_DESTINATION, null);
      const whatsapp = await this.businessConfigService.get<unknown>(BusinessConfigKey.CUSTOMER_SERVICE_WHATSAPP_NUMBER, null);
      if (!destination || !whatsapp) {
        throw new ConflictException({
          message: 'Manual Transfer is not available right now.',
          details: { code: 'MANUAL_TRANSFER_NOT_CONFIGURED' },
        });
      }
    }

    // ---- 4b. delivery address + eligibility -----------------------------------------------------------------------
    const isPickup = fulfillmentType === FulfillmentType.PICKUP;
    const catalogBranches = cart.groups
      .map((g) => (g.vendorBranchId ? branchById.get(g.vendorBranchId) : undefined))
      .filter((b): b is VendorBranch => b !== undefined);
    const address = isPickup ? null : input.address;
    let eligibility: CheckoutPlan['eligibility'] = null;

    if (!isPickup && !hasPendingAdHocPricing) {
      eligibility = await this.addressValidationService.checkEligibility(address, catalogBranches);
      if (!eligibility.serviceable) {
        if (isOrder) {
          throw new BadRequestException({
            message: eligibility.message ?? 'This address cannot be delivered to.',
            details: { code: eligibility.code === 'ADDRESS_REQUIRED' ? 'DELIVERY_ADDRESS_REQUIRED' : eligibility.code === 'ADDRESS_OUT_OF_SERVICE_AREA' ? 'ADDRESS_NOT_SERVICEABLE' : eligibility.code, vendors: eligibility.vendors },
          });
        }
        blockers.push({ code: eligibility.code ?? 'ADDRESS_NOT_SERVICEABLE', message: eligibility.message ?? '', details: { vendors: eligibility.vendors } });
      }
    } else if (!isPickup && hasPendingAdHocPricing && isOrder && !address) {
      throw new BadRequestException({ message: 'A delivery address is required.', details: { code: 'DELIVERY_ADDRESS_REQUIRED' } });
    }

    // ---- 5. fingerprint of everything a quote depends on ----------------------------------------------------------
    const inputsHash = this.fingerprint(input.customerId, cart, view, address, input.couponCode);

    // ---- 6. delivery fee ------------------------------------------------------------------------------------------
    const delivery: CheckoutPlan['delivery'] = { applicable: !isPickup, feeMinor: null, breakdown: null, source: 'NONE', adHocLocations: null };
    if (isPickup) {
      // PICKUP: nothing is delivered, so the fee is 0 (not an invented price) and no address / service area is involved.
      delivery.feeMinor = 0;
    } else if (!hasPendingAdHocPricing) {
      const eligibleForFee = eligibility?.serviceable === true && address !== null;
      if (eligibleForFee) {
        if (input.frozen && input.frozen.inputsHash === inputsHash) {
          // The customer confirmed THIS fee for THESE inputs: it is honoured, not re-measured.
          delivery.breakdown = input.frozen.breakdown;
          delivery.feeMinor = input.frozen.breakdown.deliveryFeeMinor;
          delivery.source = 'FROZEN_QUOTE';
        } else {
          try {
            const breakdown = await this.deliveryFeeCalculationService.calculate(catalogBranches, {
              latitude: address!.latitude,
              longitude: address!.longitude,
            });
            delivery.breakdown = breakdown;
            delivery.feeMinor = breakdown.deliveryFeeMinor;
            delivery.source = 'FRESH';
          } catch (error) {
            if (isOrder) throw error;
            blockers.push({ code: 'DELIVERY_FEE_UNAVAILABLE', message: 'Delivery fee could not be calculated right now. Please try again shortly.' });
          }
        }
      }
    } else {
      // Hatly Service (ad-hoc): a separate, known charge computed and frozen now, exactly as before.
      const adHocGroup = cart.groups[0];
      const locations = await this.resolveAdHocLocations(adHocGroup);
      if (address) {
        const charge = await this.hatlyServicePricingService.calculateCharge({
          serviceType: adHocGroup.adHocServiceType!,
          resolvedPickup:
            locations.pickupLatitude != null ? { latitude: locations.pickupLatitude, longitude: locations.pickupLongitude! } : null,
          resolvedDestination:
            locations.destinationLatitude != null ? { latitude: locations.destinationLatitude, longitude: locations.destinationLongitude! } : null,
          customerLocation: { latitude: address.latitude, longitude: address.longitude },
        });
        delivery.breakdown = charge;
        delivery.feeMinor = charge.chargeMinor;
        delivery.source = 'FRESH';
      }
      delivery.adHocLocations = locations;
    }

    // ---- 7. offers, coupon ----------------------------------------------------------------------------------------
    const readOnly = !isOrder;
    const candidatesByGroup = new Map<number, OfferCandidateItem[]>();
    const offerCandidateItems: OfferCandidateItem[] = [];
    for (let i = 0; i < cart.groups.length; i++) {
      const group = cart.groups[i];
      if (group.groupType !== CartGroupType.CATALOG || !group.vendorBranchId) continue;
      const groupView = view.groups[i];
      const groupCandidates: OfferCandidateItem[] = [];
      for (let j = 0; j < group.items.length; j++) {
        const item = group.items[j];
        const itemView = groupView.items[j];
        if (!item.product || !item.productId || itemView.unitPriceMinor == null) continue;
        const candidate: OfferCandidateItem = {
          cartItemId: item.id,
          vendorBranchId: group.vendorBranchId,
          productId: item.productId,
          categoryId: item.product.categoryId,
          quantity: item.quantity,
          unitPriceMinor: itemView.unitPriceMinor,
          pricingUnit: item.product.pricingUnit,
        };
        offerCandidateItems.push(candidate);
        groupCandidates.push(candidate);
      }
      candidatesByGroup.set(i, groupCandidates);
    }
    const { plans: offerPlans } = await this.offerConsumptionService.planFlashSaleForCart(manager, {
      customerId: input.customerId,
      items: offerCandidateItems,
      readOnly,
    });
    const alreadyFlashSaledCartItemIds = new Set(offerPlans.keys());

    const subtotalPlansByGroupIndex = new Map<number, OfferSegmentPlan>();
    for (const [i, groupItems] of candidatesByGroup) {
      if (groupItems.length === 0) continue;
      const group = cart.groups[i];
      const { plan } = await this.offerConsumptionService.planSubtotalDiscountForSegment(manager, {
        vendorBranchId: group.vendorBranchId!,
        items: groupItems,
        alreadyFlashSaledCartItemIds,
        readOnly,
      });
      if (!plan) continue;
      const customerAllowed = await this.offerConsumptionService.checkSubtotalDiscountCustomerLimit(manager, { offer: plan.offer, customerId: input.customerId });
      if (!customerAllowed) continue;
      subtotalPlansByGroupIndex.set(i, plan);
    }

    let coupon: CouponOutcome = { status: 'NONE' };
    const couponCode = input.couponCode?.trim();
    if (couponCode) {
      const result = await this.offerConsumptionService.planCouponForCart(manager, {
        code: couponCode,
        customerId: input.customerId,
        segments: [...candidatesByGroup].map(([groupIndex, items]) => ({
          groupIndex,
          vendorBranchId: cart.groups[groupIndex].vendorBranchId!,
          items,
        })),
        alreadyFlashSaledCartItemIds,
        readOnly,
      });
      if (result.status === 'REJECTED') {
        coupon = { status: 'REJECTED', code: couponCode.toUpperCase(), reasonCode: result.reasonCode, message: result.message };
      } else if (subtotalPlansByGroupIndex.has(result.groupIndex)) {
        // One subtotal discount per vendor segment (the existing rule): a coupon never silently replaces, or stacks on, an
        // automatic offer of the same vendor. The customer is told, and decides.
        coupon = {
          status: 'REJECTED',
          code: result.code,
          reasonCode: 'COUPON_CONFLICTS_WITH_OFFER',
          message: 'This vendor already has an automatic offer on your cart, and a coupon cannot be combined with it.',
        };
      } else {
        subtotalPlansByGroupIndex.set(result.groupIndex, result.plan);
        coupon = {
          status: 'APPLIED',
          code: result.code,
          offerId: result.plan.offer.id,
          offerName: result.plan.offer.name,
          vendorBranchId: result.vendorBranchId,
          groupIndex: result.groupIndex,
          discountMinor: result.plan.discountAmountMinor,
        };
      }
      if (coupon.status === 'REJECTED' && isOrder) {
        throw new BadRequestException({ message: coupon.message, details: { code: coupon.reasonCode, couponCode: coupon.code } });
      }
    }

    // ---- 8. segments, totals ---------------------------------------------------------------------------------------
    const segments: CheckoutSegmentPlan[] = cart.groups.map((group, i) => {
      const branch = group.vendorBranchId ? branchById.get(group.vendorBranchId) ?? null : null;
      const flash = group.items.reduce((sum, item) => sum + (offerPlans.get(item.id)?.discountAmountMinor ?? 0), 0);
      return {
        groupIndex: i,
        group,
        groupView: view.groups[i],
        branch,
        discountMinor: flash + (subtotalPlansByGroupIndex.get(i)?.discountAmountMinor ?? 0),
        preparationMinutes: branch?.preparationTimeMinutes ?? null,
        couponApplied: coupon.status === 'APPLIED' && coupon.groupIndex === i,
      };
    });
    const discountMinor = segments.reduce((sum, s) => sum + s.discountMinor, 0);
    const deliveryFeeMinor = delivery.feeMinor;
    const totalMinor = deliveryFeeMinor !== null && !hasPendingAdHocPricing ? view.subtotalMinor + deliveryFeeMinor - discountMinor : null;

    // ---- 9. wallet + amount due -----------------------------------------------------------------------------------
    let walletBalanceMinor = 0;
    let walletAppliedMinor = 0;
    let effectiveMethod: OrderPaymentMethod | null = requestedMethod ?? null;
    if (walletRequested) {
      // The wallet is an independent payment source (PD-001): it may be combined with COD, Pay at Delivery AND Manual Transfer.
      // With a transfer, the wallet part needs no approval and the Payment row holds only the remainder.
      if (hasPendingAdHocPricing) {
        fail('WALLET_NOT_ALLOWED_FOR_UNPRICED_ORDER', 'The wallet cannot be used while the price of the order is still unknown.');
      } else if (hasWeightedItem) {
        fail('WALLET_NOT_ALLOWED_FOR_WEIGHTED_ORDER', 'The wallet cannot be used for an order containing a weighed item — its final amount is only known once weighed.');
      } else {
        if (isOrder) await this.walletService.lockCustomerWallet(input.customerId, manager);
        walletBalanceMinor = Math.max(0, await this.walletService.getBalance(input.customerId, manager));
        if (totalMinor !== null) {
          const cap = input.walletAmountMinor ?? Number.POSITIVE_INFINITY;
          walletAppliedMinor = Math.max(0, Math.min(walletBalanceMinor, totalMinor, cap));
          if (requestedMethod === 'WALLET' && walletAppliedMinor < totalMinor) {
            fail('WALLET_INSUFFICIENT_BALANCE', 'Your wallet balance does not cover this order.', { balanceMinor: walletBalanceMinor, totalMinor });
          }
          if (walletAppliedMinor > 0 && walletAppliedMinor === totalMinor) effectiveMethod = 'WALLET';
        }
      }
    }
    const amountDueMinor = totalMinor === null ? null : totalMinor - walletAppliedMinor;
    if (effectiveMethod === 'WALLET') electronicMethod = null;
    if (isOrder && effectiveMethod === 'WALLET' && input.electronicPaymentMethod) {
      // A wallet-only order has no remainder to pay electronically.
      throw new BadRequestException({ message: 'An electronic payment method is not needed when the wallet covers the order.', details: { code: 'ELECTRONIC_PAYMENT_METHOD_NOT_ALLOWED' } });
    }

    // ---- 10. ETA (an estimate from real inputs — or an explicit "unavailable") ------------------------------------
    const eta = this.estimate(segments, isPickup, delivery.breakdown);

    return {
      cart,
      view,
      branchById,
      fulfillmentType,
      hasPendingAdHocPricing,
      hasWeightedItem,
      address,
      eligibility,
      delivery,
      segments,
      offerPlans,
      subtotalPlansByGroupIndex,
      coupon,
      subtotalMinor: view.subtotalMinor,
      discountMinor,
      deliveryFeeMinor,
      totalMinor,
      payment: {
        method: effectiveMethod,
        electronicMethod,
        walletBalanceMinor,
        walletAppliedMinor,
        amountDueMinor,
        awaitsPaymentApproval: effectiveMethod === 'MANUAL_TRANSFER' && (amountDueMinor ?? 1) > 0,
      },
      eta,
      inputsHash,
      blockers,
    };
  }

  /** Preparation (slowest vendor) + travel (the frozen route estimate). Anything unknown → unavailable, never a default. */
  private estimate(segments: CheckoutSegmentPlan[], isPickup: boolean, breakdown: unknown | null): EtaEstimate {
    const catalog = segments.filter((s) => s.branch);
    if (catalog.length === 0) return { available: false, reason: 'NOT_APPLICABLE', preparationMinutes: null, travelMinutes: null, totalMinutes: null };
    if (catalog.some((s) => s.preparationMinutes == null)) {
      return { available: false, reason: 'PREPARATION_TIME_NOT_CONFIGURED', preparationMinutes: null, travelMinutes: null, totalMinutes: null };
    }
    const preparationMinutes = Math.max(...catalog.map((s) => s.preparationMinutes!));
    if (isPickup) return { available: true, preparationMinutes, travelMinutes: 0, totalMinutes: preparationMinutes };
    const travelSeconds = (breakdown as { totalEtaSeconds?: number } | null)?.totalEtaSeconds;
    if (typeof travelSeconds !== 'number' || !(travelSeconds > 0)) {
      return { available: false, reason: 'TRAVEL_TIME_UNAVAILABLE', preparationMinutes, travelMinutes: null, totalMinutes: null };
    }
    const travelMinutes = Math.ceil(travelSeconds / 60);
    return { available: true, preparationMinutes, travelMinutes, totalMinutes: preparationMinutes + travelMinutes };
  }

  private fingerprint(customerId: string, cart: Cart, view: CheckoutPlan['view'], address: CheckoutInput['address'], couponCode?: string): string {
    const lines = view.groups.flatMap((g) =>
      g.items.map((i) => [
        i.id,
        i.productId,
        i.quantity,
        i.requestedWeightGrams,
        i.selectedOptionValues.map((o) => o.id).sort(),
        i.unitPriceMinor,
        i.lineTotalMinor,
        i.offerId,
        i.offerDiscountAmountMinor,
      ]),
    );
    const payload = [
      customerId,
      cart.id,
      cart.fulfillmentType,
      [...new Set(view.groups.map((g) => g.vendorBranchId ?? `adhoc:${g.id}`))].sort(),
      lines.sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      address ? [Number(address.latitude.toFixed(5)), Number(address.longitude.toFixed(5))] : null,
      (couponCode ?? '').trim().toUpperCase(),
    ];
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  /**
   * The customer's own override if they supplied one, else the configured default — fails closed (via getRequired) if a
   * default is needed but was never configured. BUY_FROM_PLACE's "destination" is the customer's own delivery address.
   */
  async resolveAdHocLocations(group: CartVendorGroup): Promise<NonNullable<CheckoutPlan['delivery']['adHocLocations']>> {
    const empty = { pickupLatitude: null, pickupLongitude: null, destinationLatitude: null, destinationLongitude: null };

    if (group.adHocServiceType === AdHocServiceType.BUY_FROM_PLACE) {
      if (group.adHocPickupLatitude != null && group.adHocPickupLongitude != null) {
        return { ...empty, pickupLatitude: group.adHocPickupLatitude, pickupLongitude: group.adHocPickupLongitude };
      }
      const p = await this.businessConfigService.getRequired<StoredGeoPoint>(BusinessConfigKey.HATLY_SERVICE_DEFAULT_PICKUP_LOCATION);
      return { ...empty, pickupLatitude: p.latitude, pickupLongitude: p.longitude };
    }
    if (group.adHocServiceType === AdHocServiceType.DELIVER_TO_PLACE) {
      if (group.adHocDestinationLatitude != null && group.adHocDestinationLongitude != null) {
        return { ...empty, destinationLatitude: group.adHocDestinationLatitude, destinationLongitude: group.adHocDestinationLongitude };
      }
      const d = await this.businessConfigService.getRequired<StoredGeoPoint>(BusinessConfigKey.HATLY_SERVICE_DEFAULT_DESTINATION_LOCATION);
      return { ...empty, destinationLatitude: d.latitude, destinationLongitude: d.longitude };
    }
    return empty;
  }
}
