import { ConflictException, HttpException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Cart, CartStatus } from '../../cart/entities/cart.entity';
import { CartGroupType } from '../../cart/cart-group-type.enum';
import { FulfillmentType } from '../../cart/fulfillment-type.enum';
import { Address } from '../../addresses/entities/address.entity';
import { BusinessConfigService } from '../../business-config/business-config.service';
import { BusinessConfigKey } from '../../business-config/business-config-key.enum';
import { DeliveryFeeBreakdown } from '../../delivery-fee/delivery-fee-calculation.service';
import { HatlyServiceCharge } from '../../finance/hatly-service-pricing.service';
import { ELECTRONIC_PAYMENT_METHODS } from '../../payments/electronic-payment-method.enum';
import { AddressValidationService } from './address-validation.service';
import { CheckoutPlannerService } from './checkout-planner.service';
import { CheckoutInput, CheckoutPlan, EtaEstimate } from './checkout-plan';
import { CheckoutQuoteTokenService, QuotedAmounts } from './checkout-quote-token.service';
import { CheckoutQuoteDto } from './dto/checkout-quote.dto';
import { DeliveryAddressSnapshot } from '../entities/order.entity';

/** The cart relations checkout needs — a superset of what CartService loads (see OrderCreationService). */
export const CHECKOUT_CART_RELATIONS = {
  groups: { items: { product: true, selectedOptionValues: { optionValue: { option: true } } } },
} as const;

export interface EtaView {
  available: boolean;
  reason?: string;
  preparationMinutes: number | null;
  travelMinutes: number | null;
  /** The point estimate, in minutes from now. */
  estimatedMinutes: number | null;
  /** Range shown to the customer. Equal to the estimate unless ETA_RANGE_BUFFER_MINUTES is configured — never invented. */
  rangeMinMinutes: number | null;
  rangeMaxMinutes: number | null;
}

/** A quote the customer must re-confirm: the order was NOT created because what they confirmed is no longer what would be charged. */
export class QuoteStaleException extends ConflictException {
  constructor(reason: string, changes: string[], currentQuote: unknown) {
    super({
      message: 'The price or delivery details changed. Please review the updated quote and confirm again.',
      details: { code: 'QUOTE_STALE', reason, changes, currentQuote },
    });
  }
}

/**
 * The customer-facing checkout quote: an authoritative, server-generated breakdown (subtotal, discounts, delivery fee with its
 * parts, wallet, amount due, ETA) plus what the customer may choose (payment options, pickup). It writes nothing and holds no
 * locks. Its `quoteToken` freezes the delivery fee for the inputs it was made for (see CheckoutQuoteTokenService).
 */
@Injectable()
export class CheckoutQuoteService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly planner: CheckoutPlannerService,
    private readonly tokenService: CheckoutQuoteTokenService,
    private readonly businessConfigService: BusinessConfigService,
    private readonly addressValidationService: AddressValidationService,
  ) {}

  async quote(customerId: string, dto: CheckoutQuoteDto) {
    const multiVendorEnabled = await this.businessConfigService.isMultiVendorOrdersEnabled();

    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      const cart = await manager.findOne(Cart, {
        where: { customerId, status: CartStatus.ACTIVE },
        relations: CHECKOUT_CART_RELATIONS,
      });
      if (!cart || cart.groups.length === 0 || cart.groups.every((g) => g.items.length === 0)) {
        return this.blocked('EMPTY_CART', 'Your cart is empty.');
      }

      // Address: an explicit one, else the customer's default (preselected only if it turns out to be serviceable).
      let address: DeliveryAddressSnapshot | null = null;
      let addressSource: 'REQUEST' | 'DEFAULT' | null = null;
      let addressId: string | null = dto.addressId ?? null;
      try {
        if (dto.addressId) {
          address = await this.addressValidationService.resolveSavedAddress(customerId, dto.addressId);
          addressSource = 'REQUEST';
        } else if (dto.deliveryAddress) {
          address = this.addressValidationService.normalize(dto.deliveryAddress);
          addressSource = 'REQUEST';
        }
      } catch (error) {
        return this.fromError(error);
      }
      let defaultAddressId: string | null = null;
      if (!address && cart.fulfillmentType === FulfillmentType.DELIVERY) {
        const def = await manager.findOne(Address, { where: { customerId, isDefault: true, isActive: true } });
        if (def) {
          defaultAddressId = def.id;
          address = await this.addressValidationService.resolveSavedAddress(customerId, def.id);
          addressSource = 'DEFAULT';
          addressId = def.id;
        }
      }

      const input = (addr: typeof address): CheckoutInput => ({
        customerId,
        address: addr,
        paymentMethod: dto.paymentMethod,
        electronicPaymentMethod: dto.electronicPaymentMethod,
        useWallet: dto.useWallet,
        walletAmountMinor: dto.walletAmountMinor,
        couponCode: dto.couponCode,
        mode: 'QUOTE',
        multiVendorEnabled,
      });

      let plan: CheckoutPlan;
      try {
        plan = await this.planner.plan(manager, cart, input(address));
        // A DEFAULT address that cannot be delivered to is not preselected: the customer is asked to choose one.
        if (addressSource === 'DEFAULT' && plan.eligibility && !plan.eligibility.serviceable) {
          address = null;
          addressSource = null;
          addressId = null;
          plan = await this.planner.plan(manager, cart, input(null));
        }
      } catch (error) {
        return this.fromError(error);
      }
      return this.assemble(manager, plan, customerId, { addressId, addressSource, defaultAddressId });
    });
  }

  /** Builds the response (and mints a fresh token) for a plan — also used to answer a stale-quote rejection at order creation. */
  async assemble(
    manager: EntityManager,
    plan: CheckoutPlan,
    customerId: string,
    meta: { addressId: string | null; addressSource: 'REQUEST' | 'DEFAULT' | null; defaultAddressId?: string | null } = {
      addressId: null,
      addressSource: null,
    },
  ) {
    const ttl = await this.businessConfigService.getCheckoutQuoteTtlSeconds();
    const buffer = await this.businessConfigService.getEtaRangeBufferMinutes();
    const enabledMethods = await this.businessConfigService.getEnabledElectronicPaymentMethods();
    const transferConfigured =
      (await this.businessConfigService.get<unknown>(BusinessConfigKey.MANUAL_TRANSFER_DESTINATION, null)) != null &&
      (await this.businessConfigService.get<unknown>(BusinessConfigKey.CUSTOMER_SERVICE_WHATSAPP_NUMBER, null)) != null;

    const breakdown = plan.delivery.breakdown as (Partial<DeliveryFeeBreakdown> & { chargeMinor?: number }) | null;
    const isRegistered = breakdown != null && Array.isArray(breakdown.vendorSequence);
    const hatlyCharge = !isRegistered && breakdown != null ? (breakdown as unknown as Partial<HatlyServiceCharge>) : null;
    const pricedByZone = plan.eligibility?.pricingSource === 'DELIVERY_ZONE';
    const amounts: QuotedAmounts = {
      subtotalMinor: plan.subtotalMinor,
      discountMinor: plan.discountMinor,
      deliveryFeeMinor: plan.deliveryFeeMinor,
      totalMinor: plan.totalMinor,
      walletAppliedMinor: plan.payment.walletAppliedMinor,
      amountDueMinor: plan.payment.amountDueMinor,
    };

    const catalogSegments = plan.segments.filter((s) => s.branch);
    const singleBranch = catalogSegments.length === 1 && plan.segments.length === 1 ? catalogSegments[0].branch : null;
    const pickupReason =
      plan.segments.length > 1 || plan.segments.some((s) => !s.branch)
        ? 'PICKUP_SINGLE_VENDOR_ONLY'
        : singleBranch && !singleBranch.pickupEnabled
          ? 'BRANCH_PICKUP_DISABLED'
          : null;

    const weightedOrUnpriced = plan.hasWeightedItem || plan.hasPendingAdHocPricing;
    // U2 (approved): a pickup order is paid in cash at the counter — no wallet, no transfer, no Pay at Delivery.
    const pickupCashOnly = plan.fulfillmentType === FulfillmentType.PICKUP;
    const canPlaceOrder =
      plan.blockers.length === 0 &&
      plan.payment.method !== null &&
      (plan.fulfillmentType === FulfillmentType.PICKUP || plan.hasPendingAdHocPricing
        ? true
        : plan.eligibility?.serviceable === true && plan.deliveryFeeMinor !== null);

    const quoteToken =
      plan.deliveryFeeMinor !== null || plan.hasPendingAdHocPricing
        ? this.tokenService.sign({
            v: 1,
            cid: customerId,
            exp: Math.floor(Date.now() / 1000) + ttl,
            ih: plan.inputsHash,
            breakdown: isRegistered && plan.delivery.source !== 'NONE' ? (plan.delivery.breakdown as DeliveryFeeBreakdown) : null,
            amounts,
          })
        : null;

    return {
      data: {
        canPlaceOrder,
        // Explicit: at least one Hatly Service item has no confirmed price yet. The total / amount due are then `null` (unknown), the
        // order is COD-only, and the final amount is confirmed during preparation — never a numeric 0.
        hasPendingPricing: plan.hasPendingAdHocPricing,
        blockers: plan.blockers,
        fulfillment: {
          type: plan.fulfillmentType,
          pickupAvailable: pickupReason === null && catalogSegments.length === 1,
          pickupUnavailableReason: pickupReason,
          pickupBranch:
            plan.fulfillmentType === FulfillmentType.PICKUP && singleBranch
              ? {
                  vendorBranchId: singleBranch.id,
                  name: singleBranch.vendor?.name ?? singleBranch.name,
                  address: singleBranch.address,
                  latitude: singleBranch.latitude,
                  longitude: singleBranch.longitude,
                }
              : null,
        },
        address: { addressId: meta.addressId, source: meta.addressSource, snapshot: plan.address },
        eligibility: plan.eligibility,
        summary: amounts,
        delivery: {
          applicable: plan.delivery.applicable,
          source: plan.delivery.source,
          feeMinor: plan.deliveryFeeMinor,
          baseFeeMinor: isRegistered ? Number(breakdown!.deliveryFeeMinor) - Number(breakdown!.additionalVendorChargeMinor) : null,
          additionalVendorFeeMinor: isRegistered ? Number(breakdown!.additionalVendorFeeMinorUsed) : null,
          additionalVendorChargeMinor: isRegistered ? Number(breakdown!.additionalVendorChargeMinor) : null,
          vendorCount: plan.segments.length,
          // PD-009: DISTANCE (map pin) or DELIVERY_ZONE (no pin — the selected zone's fee is the base fee). Null until priced.
          pricingSource: plan.eligibility?.serviceable ? plan.eligibility.pricingSource ?? null : null,
          deliveryZone: plan.address?.deliveryZone ?? null,
          distanceMeters: isRegistered && !pricedByZone && breakdown!.roundedTotalDistanceMeters != null ? Number(breakdown!.roundedTotalDistanceMeters) : null,
          // Hatly Service: fee = the delivery zone's fee × multiplier — both parts shown, never a hidden formula.
          hatlyService:
            hatlyCharge && typeof hatlyCharge.multiplierUsed === 'number' && typeof hatlyCharge.zoneDeliveryFeeMinorUsed === 'number'
              ? { zoneDeliveryFeeMinor: hatlyCharge.zoneDeliveryFeeMinorUsed, multiplier: hatlyCharge.multiplierUsed }
              : null,
          vendors: isRegistered
            ? (breakdown!.vendorSequence ?? []).map((stop) => ({
                vendorBranchId: stop.vendorBranchId,
                name: plan.branchById.get(stop.vendorBranchId)?.vendor?.name ?? plan.branchById.get(stop.vendorBranchId)?.name ?? null,
                distanceToCustomerMeters: stop.distanceToCustomerMeters,
              }))
            : [],
          eta: this.etaView(plan.eta, buffer),
        },
        vendors: plan.segments.map((s) => ({
          vendorBranchId: s.group.vendorBranchId ?? null,
          name: s.groupView.vendorName ?? s.groupView.adHocPlaceName,
          subtotalMinor: s.groupView.subtotalMinor,
          discountMinor: s.discountMinor,
          itemCount: s.group.items.length,
          preparationMinutes: s.preparationMinutes,
          couponApplied: s.couponApplied,
        })),
        coupon:
          plan.coupon.status === 'NONE'
            ? { status: 'NONE' }
            : {
                status: plan.coupon.status,
                code: plan.coupon.code,
                discountMinor: plan.coupon.discountMinor ?? null,
                vendorBranchId: plan.coupon.vendorBranchId ?? null,
                vendorName: plan.coupon.vendorBranchId ? (plan.branchById.get(plan.coupon.vendorBranchId)?.vendor?.name ?? null) : null,
                reasonCode: plan.coupon.reasonCode ?? null,
                message: plan.coupon.message ?? null,
              },
        payment: {
          selected: { method: plan.payment.method, electronicMethod: plan.payment.electronicMethod },
          awaitsPaymentApproval: plan.payment.awaitsPaymentApproval,
          wallet: {
            balanceMinor: plan.payment.walletBalanceMinor,
            appliedMinor: plan.payment.walletAppliedMinor,
            // Wallet is an independent source; it is not offered for weighed / unpriced orders (final amount unknown), nor for pickup.
            available: !weightedOrUnpriced && !pickupCashOnly,
          },
          options: {
            cod: true,
            payAtDelivery: !plan.hasPendingAdHocPricing && !pickupCashOnly,
            manualTransfer: {
              available: transferConfigured && !plan.hasWeightedItem && !plan.hasPendingAdHocPricing && !pickupCashOnly,
              reason: pickupCashOnly
                ? 'PICKUP_CASH_ONLY'
                : !transferConfigured
                  ? 'NOT_CONFIGURED'
                  : plan.hasWeightedItem
                    ? 'WEIGHED_ITEMS'
                    : plan.hasPendingAdHocPricing
                      ? 'UNPRICED_ORDER'
                      : null,
            },
            electronicMethods: ELECTRONIC_PAYMENT_METHODS.filter((m) => enabledMethods.includes(m)),
          },
        },
        quoteToken,
        expiresAt: quoteToken ? new Date(Date.now() + ttl * 1000).toISOString() : null,
      },
    };
  }

  /** Public so other views (order details / tracking) apply the same range rule. */
  etaView(eta: EtaEstimate, bufferMinutes: number | null): EtaView {
    if (!eta.available || eta.totalMinutes === null) {
      return { available: false, reason: eta.reason, preparationMinutes: eta.preparationMinutes, travelMinutes: eta.travelMinutes, estimatedMinutes: null, rangeMinMinutes: null, rangeMaxMinutes: null };
    }
    return {
      available: true,
      preparationMinutes: eta.preparationMinutes,
      travelMinutes: eta.travelMinutes,
      estimatedMinutes: eta.totalMinutes,
      rangeMinMinutes: eta.totalMinutes,
      rangeMaxMinutes: eta.totalMinutes + (bufferMinutes ?? 0),
    };
  }

  private blocked(code: string, message: string, details?: unknown) {
    return { data: { canPlaceOrder: false, blockers: [{ code, message, details }], quoteToken: null, expiresAt: null } };
  }

  /** A business rejection (a plain 400/409 with a `details.code`) becomes a blocker the UI can show; anything else is a real error. */
  private fromError(error: unknown) {
    if (error instanceof HttpException) {
      const status = error.getStatus();
      const body = error.getResponse() as { message?: string; details?: { code?: string } };
      if ((status === 400 || status === 404 || status === 409) && body?.details?.code) {
        return this.blocked(body.details.code, typeof body.message === 'string' ? body.message : body.details.code, body.details);
      }
    }
    throw error;
  }
}
