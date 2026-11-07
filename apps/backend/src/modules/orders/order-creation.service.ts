import { notifyVendorsOfNewOrder } from './vendor-new-order-alerts';
import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { StaffAlertsService } from '../notifications/staff-alerts.service';
import { AdHocFulfilmentService } from './ad-hoc-fulfilment.service';
import { recordSegmentEvent } from './segment-events.util';
import { linkPlacementMovementsToOrder, setStockContext } from './stock-context';
import { DataSource, EntityManager } from 'typeorm';
import { Cart, CartStatus } from '../cart/entities/cart.entity';
import { CartItem } from '../cart/entities/cart-item.entity';
import { CartGroupType } from '../cart/cart-group-type.enum';
import { AdHocServiceType } from '../cart/ad-hoc-service-type.enum';
import { FulfillmentType } from '../cart/fulfillment-type.enum';
import { Order } from './entities/order.entity';
import { CustomerNotificationType, recordOrderNotification } from '../notifications/customer-notification-events';
import { OrderStatus } from './order-status.enum';
import { OrderVendorSegment } from './entities/order-vendor-segment.entity';
import { OrderVendorSegmentStatus } from './order-vendor-segment-status.enum';
import { OrderItem } from './entities/order-item.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { BusinessConfigService } from '../business-config/business-config.service';
import { Payment } from '../payments/entities/payment.entity';
import { PaymentStatus } from '../payments/payment-status.enum';
import { PricingUnit } from '../products/pricing-unit.enum';
import { Product } from '../products/entities/product.entity';
import { InventoryMode } from '../products/inventory-mode.enum';
import { OfferConsumptionService, OfferItemPlan, OfferSegmentPlan } from '../offers/offer-consumption.service';
import { WalletService } from '../wallet/wallet.service';
import { WalletTransactionType } from '../wallet/wallet-transaction-type.enum';
import { Role } from '../../common/enums/role.enum';
import { RequestContextService } from '../../common/request-context/request-context.service';
import { logBusinessEvent } from '../../common/logging/log-business-event';
import { BusinessEvent } from '../../common/logging/business-events';
import { AddressValidationService } from './checkout/address-validation.service';
import { CheckoutPlannerService } from './checkout/checkout-planner.service';
import { CheckoutQuoteService, CHECKOUT_CART_RELATIONS, QuoteStaleException } from './checkout/checkout-quote.service';
import { nextOrderNumber } from './order-number';
import { CheckoutQuoteTokenService, QuotedAmounts } from './checkout/checkout-quote-token.service';
import { CheckoutPlan } from './checkout/checkout-plan';
import { OrderStatusHistoryService } from './order-status-history.service';
import { DeliveryFeeBreakdown } from '../delivery-fee/delivery-fee-calculation.service';

/**
 * Creates an order from the customer's ACTIVE cart — atomically, and entirely on the server's numbers.
 *
 * Everything that prices or validates the checkout lives in CheckoutPlannerService (shared with the read-only quote); this
 * service adds what only order creation does: the cart lock, the quote-freshness check, the atomic inventory decrement, the
 * wallet debit, and writing the immutable snapshots. Nothing the client sends is an authoritative amount.
 */
@Injectable()
export class OrderCreationService {
  private readonly logger = new Logger(OrderCreationService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly businessConfigService: BusinessConfigService,
    private readonly offerConsumptionService: OfferConsumptionService,
    private readonly requestContextService: RequestContextService,
    private readonly plannerService: CheckoutPlannerService,
    private readonly addressValidationService: AddressValidationService,
    private readonly quoteService: CheckoutQuoteService,
    private readonly quoteTokenService: CheckoutQuoteTokenService,
    private readonly walletService: WalletService,
    private readonly orderStatusHistoryService: OrderStatusHistoryService,
    private readonly adHocFulfilmentService: AdHocFulfilmentService,
    // Staff inbox (vendor notification centre). Optional so unit tests that build this service by hand keep working unchanged.
    @Optional() private readonly staffAlerts?: StaffAlertsService,
  ) {}

  /**
   * Tracked Inventory Order-Time Enforcement. OPEN products: no-op,
   * confirmed — never decremented, quantity never required. TRACKED:
   * an atomic, race-safe `UPDATE ... WHERE quantity >= :amount`
   * inside THIS SAME transaction/connection (`manager`, never a
   * separate query runner) — CONFIRMED this is the actual concurrency
   * guarantee, not the Cart's own "+" max-quantity guard (which is
   * UX-only, per the approved design). WEIGHT products decrement by
   * `requestedWeightGrams` only — `actualWeightGrams` (fulfillment-
   * time, recorded later by Vendor/Driver) is never read here and
   * never will be in this chunk, per the explicit instruction not to
   * build an inventory-adjustment system.
   *
   * On insufficient stock, throws before any decrement for THIS item
   * happens — combined with the transaction wrapping the whole
   * `createOrder` call, any decrement already applied to an EARLIER
   * item in this same order is rolled back too (standard transaction
   * semantics — no manual compensation needed, confirmed by reusing
   * the existing transaction boundary rather than introducing a
   * second one).
   */
  private async enforceAndDecrementInventory(manager: EntityManager, product: Product, item: CartItem, cartId: string): Promise<void> {
    if (product.inventoryMode !== InventoryMode.TRACKED) {
      return;
    }

    const requestedAmount = product.pricingUnit === PricingUnit.WEIGHT ? item.requestedWeightGrams ?? 0 : item.quantity;

    await setStockContext(manager, { reason: 'ORDER_PLACED', referenceType: 'CART', referenceId: cartId, actorRole: 'CUSTOMER' });
    const result = await manager
      .createQueryBuilder()
      .update(Product)
      .set({ quantity: () => 'quantity - :amount' })
      .where('id = :id', { id: product.id })
      .andWhere('inventory_mode = :mode', { mode: InventoryMode.TRACKED })
      .andWhere('quantity >= :amount', { amount: requestedAmount })
      .setParameter('amount', requestedAmount)
      .execute();

    if (result.affected !== 1) {
      // Best-effort "available" hint only — this is the value already
      // loaded moments earlier in this same transaction, not a fresh
      // authoritative read (the atomic UPDATE above is what actually
      // decided this failed, not this number). Never claims more
      // precision than that.
      throw new BadRequestException({
        message: 'One or more items in your cart no longer have enough stock.',
        details: {
          code: 'INSUFFICIENT_INVENTORY',
          productId: product.id,
          requestedQuantity: requestedAmount,
          availableQuantity: product.quantity ?? 0,
        },
      });
    }
  }

  async createOrder(customerId: string, dto: CreateOrderDto): Promise<Order> {
    // BusinessConfig reads happen before the transaction — they're reads of a separate, independently-managed table and don't
    // need to participate in the cart/order lock.
    const multiVendorEnabled = await this.businessConfigService.isMultiVendorOrdersEnabled();

    if (dto.addressId && dto.deliveryAddress) {
      throw new BadRequestException({
        message: 'Send either a saved address (addressId) or a new one (deliveryAddress), not both.',
        details: { code: 'AMBIGUOUS_DELIVERY_ADDRESS' },
      });
    }
    // A saved address is resolved to its snapshot now (ownership + active checked); a new one is normalised. Either way the
    // order stores a SNAPSHOT — there is no live address row an order could later depend on.
    const address = dto.addressId
      ? await this.addressValidationService.resolveSavedAddress(customerId, dto.addressId)
      : dto.deliveryAddress
        ? this.addressValidationService.normalize(dto.deliveryAddress)
        : null;

    const verification = dto.quoteToken ? this.quoteTokenService.verify(dto.quoteToken, customerId) : null;
    if (verification?.status === 'INVALID') {
      throw new BadRequestException({ message: 'The quote is not valid. Please request a new one.', details: { code: 'QUOTE_INVALID' } });
    }

    const createdOrder = await this.dataSource.transaction(async (manager) => {
      // 1. Lock the ACTIVE cart — the same pessimistic_write pattern CartService.addItem already uses. This is also the whole
      // idempotency story: a concurrent second submit either queues behind this lock, or — once this transaction commits and the
      // cart is no longer ACTIVE — finds no cart to lock at all and fails with the same "no active cart" error below.
      const lockedCart = await manager.findOne(Cart, {
        where: { customerId, status: CartStatus.ACTIVE },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedCart) {
        throw new NotFoundException('No active cart to submit.');
      }

      // 2. Re-read the full cart state fresh, inside this same locked transaction — this IS the revalidation: nothing about
      // pricing is ever cached on Cart/CartItem, so this load is already the live truth, not a stale read.
      const cart = await manager.findOne(Cart, { where: { id: lockedCart.id }, relations: CHECKOUT_CART_RELATIONS });
      if (!cart || cart.groups.length === 0 || cart.groups.every((g) => g.items.length === 0)) {
        throw new BadRequestException({ message: 'Your cart is empty.', details: { code: 'EMPTY_CART' } });
      }

      // 3. Validate and price EVERYTHING (availability, fulfilment, service area, delivery fee, offers, coupon, wallet, payment
      // rules) through the same planner the quote used. A delivery fee the customer confirmed is honoured while the inputs it
      // was made for are unchanged; anything else is recomputed and — if it differs from what they confirmed — refused below.
      const frozen =
        verification?.status === 'VALID' && verification.payload.breakdown
          ? { inputsHash: verification.payload.ih, breakdown: verification.payload.breakdown as DeliveryFeeBreakdown }
          : null;
      const plan = await this.plannerService.plan(manager, cart, {
        customerId,
        address,
        paymentMethod: dto.paymentMethod,
        electronicPaymentMethod: dto.electronicPaymentMethod,
        useWallet: dto.useWallet,
        walletAmountMinor: dto.walletAmountMinor,
        couponCode: dto.couponCode,
        frozen,
        mode: 'ORDER',
        multiVendorEnabled,
      });

      // 4. The customer confirmed a quote: it must still be what would be charged.
      if (verification) {
        const staleReason = this.staleReason(verification, plan);
        if (staleReason) {
          const current = await this.quoteService.assemble(manager, plan, customerId, {
            addressId: dto.addressId ?? null,
            addressSource: address ? 'REQUEST' : null,
          });
          throw new QuoteStaleException(staleReason.reason, staleReason.changes, current.data);
        }
      }

      // 5. Tracked inventory: the atomic, race-safe decrement — the real concurrency guarantee (the cart's "+" max is UX only).
      for (const group of cart.groups) {
        for (const item of group.items) {
          if (item.productId && item.product) await this.enforceAndDecrementInventory(manager, item.product, item, cart.id);
        }
      }

      // 5b. A confirmed quote is MANDATORY for a DELIVERY order — a client (old or malicious) must never obtain a fresh price
      // and place the order without ever having seen/confirmed it. PICKUP has no delivery quote to confirm (no fee, no
      // address, no service-area check — see planner step 6), so none is required of it. Checked LAST, after every other
      // real validation above (availability, service area, delivery-fee calculation, coupon, wallet, inventory) has already
      // run and would have refused the order for its OWN reason first — the token requirement never masks or takes priority
      // over an actual business rejection, and never substitutes for any of the checks above (it is a confirmation
      // requirement, not a bypass of anything).
      if (plan.fulfillmentType !== FulfillmentType.PICKUP && !verification) {
        throw new BadRequestException({
          message: 'A confirmed delivery quote is required to place this order. Please request a quote and confirm it first.',
          details: { code: 'QUOTE_TOKEN_REQUIRED' },
        });
      }

      // 6. Write the order and its immutable snapshots.
      const order = await this.persistOrder(manager, customerId, plan, dto);
      await linkPlacementMovementsToOrder(manager, cart.id, order.id); // the stock ledger rows written above now point at the order

      await manager.update(Cart, { id: cart.id }, { status: CartStatus.ORDERED });
      // Told in the same transaction as the order itself — "order exists" and "customer notified" cannot disagree.
      await recordOrderNotification(manager, order, CustomerNotificationType.ORDER_PLACED);
      // The staff of each vendor branch in the order learn of it in the same transaction (only their own branch's part; never customer data).
      // R2: an InstaPay / Vodafone Cash order is announced to vendors only once Operations verified the payment (PaymentStateMachineService).
      if (this.staffAlerts && order.paymentMethod !== 'MANUAL_TRANSFER') {
        await notifyVendorsOfNewOrder(manager, this.staffAlerts, order);
      }

      const createdOrder = await manager.findOne(Order, { where: { id: order.id }, relations: { segments: { items: true } } });
      return createdOrder!;
    });

    logBusinessEvent(this.logger, 'log', BusinessEvent.ORDER_CREATED, () => this.requestContextService.getCorrelationId(), {
      orderId: createdOrder.id,
      customerId,
      paymentMethod: createdOrder.paymentMethod,
      fulfillmentType: createdOrder.fulfillmentType,
      totalMinor: createdOrder.totalMinor,
      hasPendingAdHocPricing: createdOrder.hasPendingAdHocPricing,
      segmentCount: createdOrder.segments?.length ?? 0,
    });

    await this.offerConsumptionService.recordHatlyFundedDiscountEvent(createdOrder.id, createdOrder.discountMinor);

    // Hatly / Wasally have no vendor to accept them: once the payment gate passes they become ready for dispatch (best effort — a
    // failure never undoes or fails the placed order; the periodic pass retries).
    if (createdOrder.segments?.some((seg) => seg.groupType === CartGroupType.AD_HOC_SERVICE)) {
      try {
        await this.adHocFulfilmentService.advanceOrder(createdOrder.id);
      } catch (error) {
        this.logger.error(`Hatly/Wasally readiness after placing order ${createdOrder.id} failed: ${(error as Error).message}`);
      }
    }

    return createdOrder;
  }

  /** Why the quote the customer confirmed no longer matches what would be charged (null = it still does). */
  private staleReason(
    verification: NonNullable<ReturnType<CheckoutQuoteTokenService['verify']>>,
    plan: CheckoutPlan,
  ): { reason: string; changes: string[] } | null {
    if (verification.status !== 'VALID') return { reason: 'QUOTE_EXPIRED', changes: ['expired'] };
    if (verification.payload.ih !== plan.inputsHash) {
      return { reason: 'INPUTS_CHANGED', changes: ['cart, address, fulfilment or coupon changed since the quote'] };
    }
    const quoted: QuotedAmounts = verification.payload.amounts;
    const now: QuotedAmounts = {
      subtotalMinor: plan.subtotalMinor,
      discountMinor: plan.discountMinor,
      deliveryFeeMinor: plan.deliveryFeeMinor,
      totalMinor: plan.totalMinor,
      walletAppliedMinor: plan.payment.walletAppliedMinor,
      amountDueMinor: plan.payment.amountDueMinor,
    };
    const changes = (Object.keys(now) as Array<keyof QuotedAmounts>).filter((k) => now[k] !== quoted[k]);
    return changes.length > 0 ? { reason: 'AMOUNTS_CHANGED', changes } : null;
  }

  private async persistOrder(manager: EntityManager, customerId: string, plan: CheckoutPlan, dto: CreateOrderDto): Promise<Order> {
    const { cart, view } = plan;
    const isRegistered = plan.delivery.breakdown != null && Array.isArray((plan.delivery.breakdown as DeliveryFeeBreakdown).vendorSequence);
    const breakdown = isRegistered ? (plan.delivery.breakdown as DeliveryFeeBreakdown) : null;
    const payment = plan.payment;
    const method = payment.method!;

    const orderNumber = await nextOrderNumber(manager);
    const order = await manager.save(
      Order,
      manager.create(Order, {
        customerId,
        orderNumber,
        status: OrderStatus.PENDING,
        fulfillmentType: plan.fulfillmentType,
        orderNote: cart.orderNote ?? null,
        // Pickup has no delivery address (null); a delivery order always stores the confirmed address snapshot.
        deliveryAddressSnapshot: plan.address,
        subtotalMinor: view.subtotalMinor,
        deliveryFeeMinor: plan.deliveryFeeMinor,
        discountMinor: plan.discountMinor,
        totalMinor: plan.totalMinor,
        hasPendingAdHocPricing: plan.hasPendingAdHocPricing,
        deliveryFeeBreakdownSnapshot: plan.delivery.breakdown,
        paymentMethod: method,
        electronicPaymentMethod: payment.electronicMethod,
        walletAmountMinor: payment.walletAppliedMinor,
        amountDueMinor: payment.amountDueMinor,
        estimatedTravelSeconds: breakdown?.totalEtaSeconds ?? null,
        // The quote the customer confirmed, frozen with the order: later BusinessConfig / map changes never alter it.
        checkoutQuoteSnapshot: {
          version: 1,
          quotedAt: new Date().toISOString(),
          inputsHash: plan.inputsHash,
          deliverySource: plan.delivery.source,
          amounts: {
            subtotalMinor: view.subtotalMinor,
            discountMinor: plan.discountMinor,
            deliveryFeeMinor: plan.deliveryFeeMinor,
            totalMinor: plan.totalMinor,
            walletAppliedMinor: payment.walletAppliedMinor,
            amountDueMinor: payment.amountDueMinor,
          },
          breakdown: plan.delivery.breakdown,
          eta: plan.eta,
        },
      }),
    );

    const orderItemIdByCartItemId = new Map<string, string>();
    const segmentIdByGroupIndex = new Map<number, string>();
    const now = Date.now();

    for (const seg of plan.segments) {
      const { group, groupView, branch, groupIndex: i } = seg;
      // R12: AUTO accepts on placement (every checkout check has already passed); VENDOR and HATLY start PENDING.
      const autoAcceptEnabled = branch ? (branch.acceptanceMode ? branch.acceptanceMode === 'AUTO' : branch.autoAcceptEnabled === true) : false;
      const subtotalPlan = plan.subtotalPlansByGroupIndex.get(i);
      const adHocLocations = plan.delivery.adHocLocations ?? {
        pickupLatitude: null,
        pickupLongitude: null,
        destinationLatitude: null,
        destinationLongitude: null,
      };

      const segment = await manager.save(
        OrderVendorSegment,
        manager.create(OrderVendorSegment, {
          orderId: order.id,
          groupType: group.groupType,
          vendorBranchId: group.vendorBranchId ?? null,
          adHocPlaceNameSnapshot: group.adHocPlaceName ?? null,
          adHocServiceTypeSnapshot: group.adHocServiceType ?? null,
          adHocPickupLatitudeSnapshot: adHocLocations.pickupLatitude,
          adHocPickupLongitudeSnapshot: adHocLocations.pickupLongitude,
          adHocDestinationLatitudeSnapshot: adHocLocations.destinationLatitude,
          adHocDestinationLongitudeSnapshot: adHocLocations.destinationLongitude,
          vendorNoteSnapshot: group.vendorNote ?? null,
          status: autoAcceptEnabled ? OrderVendorSegmentStatus.CONFIRMED : OrderVendorSegmentStatus.PENDING,
          subtotalMinor: groupView.subtotalMinor,
          // An ESTIMATE from the branch's configured preparation time — null when none is configured (never a default). The
          // vendor can refine it later; it is operational data and never changes any amount.
          expectedReadyAt: seg.preparationMinutes ? new Date(now + seg.preparationMinutes * 60_000) : null,
          preparationEstimateMinutes: seg.preparationMinutes,
          vendorNameSnapshot: branch ? branch.vendor?.name ?? branch.name : null,
          branchNameSnapshot: branch?.name ?? null,
          branchAddressSnapshot: branch?.address ?? null,
          appliedOfferId: subtotalPlan?.offer.id ?? null,
          offerDiscountTypeSnapshot: subtotalPlan?.offer.discountType ?? null,
          offerDiscountValueSnapshot: subtotalPlan?.offer.discountValue ?? null,
          offerEligibleSubtotalMinorSnapshot: subtotalPlan?.eligibleSubtotalMinor ?? null,
          offerDiscountAmountMinor: subtotalPlan?.discountAmountMinor ?? null,
          couponCodeSnapshot: seg.couponApplied ? plan.coupon.code ?? null : null,
        }),
      );

      // History starts here: the segment was created PENDING, or automatically ACCEPTED because its branch is set to automatic acceptance
      // (accepted only — preparing and ready remain separate steps).
      await recordSegmentEvent(manager, {
        segmentId: segment.id,
        orderId: order.id,
        fromStatus: null,
        toStatus: segment.status,
        actorUserId: null,
        actorRole: null,
        onBehalfOfVendor: false,
        reason: autoAcceptEnabled ? 'Automatic acceptance (branch setting)' : null,
      });
      segmentIdByGroupIndex.set(i, segment.id);

      for (let j = 0; j < group.items.length; j++) {
        const item = group.items[j];
        const itemView = groupView.items[j];

        const optionsSnapshot = (item.selectedOptionValues ?? []).map((sov) => ({
          name: sov.optionValue.option?.name ?? '',
          valueName: sov.optionValue.name,
          priceDeltaMinor: sov.optionValue.priceDeltaMinor,
        }));

        const isWeighted = item.product?.pricingUnit === PricingUnit.WEIGHT;
        const offerPlan: OfferItemPlan | undefined = plan.offerPlans.get(item.id);

        const savedItem = await manager.save(
          OrderItem,
          manager.create(OrderItem, {
            orderVendorSegmentId: segment.id,
            productId: item.productId ?? null,
            productNameSnapshot: itemView.productName,
            productNameArSnapshot: itemView.productNameAr ?? null,
            productImageUrlSnapshot: item.product?.imageUrl ?? null,
            quantity: item.quantity,
            unitPriceMinor: itemView.unitPriceMinor,
            optionsSnapshot,
            notes: item.notes ?? null,
            freeTextDescriptionSnapshot: item.freeTextDescription ?? null,
            imageUrlsSnapshot: item.imageUrls ?? null,
            // "وصّلي لمكان" buys nothing: its item has no price to confirm later, so it is recorded as priced at 0 (the delivery
            // fee is the whole charge). That keeps the "custom items still need a final price" gate and the ops price queue away
            // from it. A "هاتلي من مكان" item stays null = pending until Hatly records the purchase.
            actualAmountMinor: group.groupType === CartGroupType.AD_HOC_SERVICE && group.adHocServiceType === AdHocServiceType.DELIVER_TO_PLACE ? 0 : null,
            pricingUnitSnapshot: item.product?.pricingUnit ?? null,
            requestedWeightGrams: isWeighted ? item.requestedWeightGrams ?? null : null,
            estimatedAmountMinor: isWeighted ? itemView.lineTotalMinor : null,
            actualWeightGrams: null,
            finalAmountMinor: null,
            appliedOfferId: offerPlan?.offer.id ?? null,
            offerDiscountedQuantity: offerPlan?.discountedQuantity ?? null,
            offerDiscountTypeSnapshot: offerPlan?.offer.discountType ?? null,
            offerDiscountValueSnapshot: offerPlan?.offer.discountValue ?? null,
            offerDiscountAmountMinor: offerPlan?.discountAmountMinor ?? null,
            offerSpecialPriceMinorSnapshot: offerPlan?.offer.specialPriceMinor ?? null,
            offerMechanismSnapshot: offerPlan ? 'FLASH_SALE' : null,
          }),
        );
        if (offerPlan) {
          orderItemIdByCartItemId.set(item.id, savedItem.id);
        }
      }
    }

    await this.offerConsumptionService.finalizeConsumption(manager, {
      customerId,
      orderId: order.id,
      itemPlans: plan.offerPlans,
      orderItemIdByCartItemId,
      segmentPlans: [...plan.subtotalPlansByGroupIndex.entries()]
        .map(([groupIndex, p]: [number, OfferSegmentPlan]) => {
          const orderVendorSegmentId = segmentIdByGroupIndex.get(groupIndex);
          return orderVendorSegmentId ? { plan: p, orderVendorSegmentId } : null;
        })
        .filter((x): x is { plan: OfferSegmentPlan; orderVendorSegmentId: string } => x !== null),
    });

    if (plan.coupon.status === 'APPLIED') {
      order.couponSnapshot = {
        code: plan.coupon.code!,
        offerId: plan.coupon.offerId!,
        offerName: plan.coupon.offerName!,
        vendorBranchId: plan.coupon.vendorBranchId!,
        orderVendorSegmentId: segmentIdByGroupIndex.get(plan.coupon.groupIndex!) ?? null,
        discountMinor: plan.coupon.discountMinor!,
      };
      await manager.save(Order, order);
    }

    // WALLET: the server-decided amount is debited from the append-only ledger in THIS transaction (the wallet lock was
    // taken while planning, so the balance the plan saw is the balance this debit sees). One idempotent ORDER_PAYMENT row.
    if (payment.walletAppliedMinor > 0) {
      await this.walletService.recordTransaction(
        {
          customerId,
          amountDeltaMinor: -payment.walletAppliedMinor,
          type: WalletTransactionType.ORDER_PAYMENT,
          idempotencyKey: `order-payment:${order.id}`,
          orderId: order.id,
          reason: 'Order payment from wallet.',
        },
        manager,
      );
    }

    // MANUAL_TRANSFER: a Payment row awaiting the customer's transfer + admin verification. (COD / PAY_AT_DELIVERY / WALLET
    // create none — their electronic method, if any, is stored on the order itself.)
    if (method === 'MANUAL_TRANSFER') {
      await manager.save(
        Payment,
        manager.create(Payment, {
          orderId: order.id,
          method: 'MANUAL_TRANSFER',
          electronicMethod: payment.electronicMethod,
          status: PaymentStatus.PENDING,
          amountMinor: order.amountDueMinor ?? order.totalMinor ?? null,
        }),
      );
    }

    await this.orderStatusHistoryService.record(manager, {
      orderId: order.id,
      from: null,
      to: OrderStatus.PENDING,
      actorRole: Role.CUSTOMER,
      actorUserId: customerId,
    });

    return order;
  }
}
