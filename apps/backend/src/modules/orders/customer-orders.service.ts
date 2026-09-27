import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Order } from './entities/order.entity';
import { OrderStatus } from './order-status.enum';
import { VendorBranch } from '../vendors/entities/vendor-branch.entity';
import { Payment } from '../payments/entities/payment.entity';
import { PaymentStatus } from '../payments/payment-status.enum';
import { Delivery } from '../delivery/entities/delivery.entity';
import { Driver } from '../delivery/entities/driver.entity';
import { OrderStatusEvent } from './entities/order-status-event.entity';
import { OrderEtaService, OrderEtaView } from './order-eta.service';
import { customerCancellationBlock } from './customer-cancellation-rule';
import { paymentBlocksFulfilment } from './order-payment-gate.service';
import { DeliveryFeeBreakdown } from '../delivery-fee/delivery-fee-calculation.service';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50; // sanity ceiling — not a business rule, guards against a garbage/malicious limit

/** The three tabs of the customer's order list (PD-006): ongoing · completed · cancelled. */
export type OrderListTab = 'active' | 'completed' | 'cancelled';

export const ORDER_LIST_TAB_STATUSES: Record<OrderListTab, OrderStatus[]> = {
  active: [
    OrderStatus.PENDING,
    OrderStatus.CONFIRMED,
    OrderStatus.PREPARING,
    OrderStatus.READY_FOR_PICKUP,
    OrderStatus.ASSIGNED_TO_DRIVER,
    OrderStatus.PICKED_UP,
    OrderStatus.ON_THE_WAY,
  ],
  completed: [OrderStatus.DELIVERED],
  // An undelivered (FAILED_DELIVERY) order is not ongoing and did not complete: it is listed with the cancelled ones.
  cancelled: [OrderStatus.CANCELLED, OrderStatus.FAILED_DELIVERY],
};

export interface CustomerOrderSummaryView {
  id: string;
  /** The customer-facing reference (`HT-100234`) — show this, never the id. */
  orderNumber: string;
  createdAt: Date;
  status: OrderStatus;
  totalMinor: number | null;
  paymentMethod: string;
  electronicPaymentMethod: string | null;
  /** MANUAL_TRANSFER awaiting admin approval — "order created" is not "payment successful". */
  awaitingPaymentApproval: boolean;
  fulfillmentType: string;
  vendorBranchNames: string[];
  /** Up to 3 product images from the order's own snapshots, for the visual card. */
  itemImageUrls: string[];
  itemCount: number;
  /** Operational ETA for an ongoing order; `state` explains why there is none otherwise. */
  eta: OrderEtaView;
}

export interface OrderTimelineEntryView {
  status: string;
  at: Date;
  actorRole: string | null;
}

export interface CustomerOrderPaymentView {
  method: string;
  /**
   * Manual-transfer state (PENDING · CUSTOMER_CLAIMED_TRANSFER · UNDER_REVIEW · PAID · REJECTED); DUE_ON_DELIVERY for COD and
   * Pay-at-Delivery; PAID for a wallet-paid order.
   */
  status: string | null;
  amountMinor: number | null;
  electronicMethod: string | null;
  walletAmountMinor: number;
  amountDueMinor: number | null;
  awaitingApproval: boolean;
}

export interface CustomerOrderDriverView {
  name: string;
  phone: string;
}

export interface CustomerOrderItemView {
  id: string;
  productId: string | null;
  productNameSnapshot: string | null;
  productNameArSnapshot: string | null;
  productImageUrlSnapshot: string | null;
  quantity: number;
  unitPriceMinor: number | null;
  actualAmountMinor: number | null;
  optionsSnapshot: Array<{ name: string; valueName: string; priceDeltaMinor: number }>;
  notes: string | null;
  pricingUnitSnapshot: string | null;
  requestedWeightGrams: number | null;
  actualWeightGrams: number | null;
  estimatedAmountMinor: number | null;
  finalAmountMinor: number | null;
  freeTextDescriptionSnapshot: string | null;
  imageUrlsSnapshot: string[] | null;
  offerMechanismSnapshot: string | null;
  offerSpecialPriceMinorSnapshot: number | null;
}

export interface CustomerOrderSegmentView {
  id: string;
  groupType: string;
  vendorBranchId: string | null;
  /** Frozen at order time; the current name only for rows that pre-date snapshots. */
  vendorBranchName: string | null;
  branchAddress: string | null;
  status: string;
  subtotalMinor: number | null;
  items: CustomerOrderItemView[];
  offerDiscountTypeSnapshot: string | null;
  offerDiscountValueSnapshot: number | null;
  offerEligibleSubtotalMinorSnapshot: number | null;
  offerDiscountAmountMinor: number | null;
  couponCodeSnapshot: string | null;
  /** Operational — may change; never affects any amount. */
  expectedReadyAt: Date | null;
  preparationEstimateMinutes: number | null;
}

export interface OrderDeliveryBreakdownView {
  baseFeeMinor: number;
  additionalVendorFeeMinor: number;
  additionalVendorChargeMinor: number;
  vendorCount: number;
  distanceMeters: number;
  /** The fee frozen at creation. After a vendor cancels, `deliveryFeeMinor` on the order is the CURRENT fee. */
  frozenTotalFeeMinor: number;
  vendors: Array<{ vendorBranchId: string; distanceToCustomerMeters: number }>;
}

export interface CustomerOrderDetailsView {
  id: string;
  /** The customer-facing reference (`HT-100234`) — show this, never the id. */
  orderNumber: string;
  createdAt: Date;
  status: OrderStatus;
  fulfillmentType: string;
  /** The immutable delivery address snapshot (coordinates + the details the customer typed). Null for pickup. */
  deliveryAddressSnapshot: unknown;
  subtotalMinor: number;
  deliveryFeeMinor: number | null;
  discountMinor: number;
  totalMinor: number | null;
  paymentMethod: string;
  electronicPaymentMethod: string | null;
  walletAmountMinor: number;
  amountDueMinor: number | null;
  coupon: { code: string; offerName: string; discountMinor: number; vendorBranchId: string; orderVendorSegmentId: string | null } | null;
  deliveryBreakdown: OrderDeliveryBreakdownView | null;
  eta: OrderEtaView;
  timeline: OrderTimelineEntryView[];
  /** Whether the customer can cancel the whole order right now (the server rule; the app only offers it when true). */
  customerCanCancel: boolean;
  payment: CustomerOrderPaymentView | null;
  cancellationReason: string | null;
  cancelledByRole: string | null;
  failureReason: string | null;
  failedAt: string | null;
  segments: CustomerOrderSegmentView[];
  /**
   * null until a Driver is actually assigned (via Delivery.driverId — never a client-supplied id, and never a live-tracking
   * field). Name/phone only, from the real assigned Driver's own User row.
   */
  driver: CustomerOrderDriverView | null;
}

/** Tracking (V1): what is happening now — status, ETA, timeline, per-vendor progress. No map, no driver location. */
export interface CustomerOrderTrackingView {
  orderId: string;
  /** The customer-facing reference (`HT-100234`) — show this, never the id. */
  orderNumber: string;
  status: OrderStatus;
  fulfillmentType: string;
  eta: OrderEtaView;
  timeline: OrderTimelineEntryView[];
  segments: Array<{
    id: string;
    vendorName: string | null;
    status: string;
    expectedReadyAt: Date | null;
    preparationEstimateMinutes: number | null;
  }>;
  payment: { method: string; electronicMethod: string | null; status: string | null; awaitingApproval: boolean };
  customerCanCancel: boolean;
  cancellationReason: string | null;
}

export interface CustomerOrderListResult {
  data: CustomerOrderSummaryView[];
  page: number;
  limit: number;
  total: number;
}

/**
 * Builds the customer-facing view of their own orders — deliberately NOT the raw Order/OrderVendorSegment/Delivery/Driver/User
 * entities, mirroring VendorOrdersService's own established discipline. Everything historical (names, prices, options, address,
 * payment choice, coupon, delivery breakdown) comes from the order's own SNAPSHOTS, never from the current catalog; only the
 * operational fields (status, ETA, timeline, payment state) reflect live state.
 *
 * Fields deliberately NEVER read/returned: Delivery's `acceptDeadlineAt`/`reassignmentCount` (internal dispatch mechanics),
 * Driver's commission / verification / live location, Payment's `verifiedByUserId` (an internal admin actor id).
 *
 * Ownership is ALWAYS `Order.customerId === customerId` from the authenticated caller — never a client-supplied id. A
 * non-existent order and someone else's order both surface as NotFoundException.
 */
@Injectable()
export class CustomerOrdersService {
  constructor(
    @InjectRepository(Order) private readonly ordersRepository: Repository<Order>,
    @InjectRepository(VendorBranch) private readonly vendorBranchesRepository: Repository<VendorBranch>,
    @InjectRepository(Payment) private readonly paymentsRepository: Repository<Payment>,
    @InjectRepository(Delivery) private readonly deliveriesRepository: Repository<Delivery>,
    @InjectRepository(Driver) private readonly driversRepository: Repository<Driver>,
    @InjectRepository(OrderStatusEvent) private readonly statusEventsRepository: Repository<OrderStatusEvent>,
    private readonly orderEtaService: OrderEtaService,
  ) {}

  async listForCustomer(
    customerId: string,
    params: { page?: number; limit?: number; status?: OrderStatus; tab?: OrderListTab },
  ): Promise<CustomerOrderListResult> {
    const page = params.page && params.page > 0 ? params.page : DEFAULT_PAGE;
    const limit = params.limit && params.limit > 0 ? Math.min(params.limit, MAX_LIMIT) : DEFAULT_LIMIT;

    const where: { customerId: string; status?: OrderStatus | ReturnType<typeof In> } = { customerId };
    if (params.status) {
      where.status = params.status;
    } else if (params.tab) {
      where.status = In(ORDER_LIST_TAB_STATUSES[params.tab]);
    }

    const [orders, total] = await this.ordersRepository.findAndCount({
      where: where as never,
      relations: { segments: { items: true } },
      order: { createdAt: 'DESC' }, // newest first
      skip: (page - 1) * limit,
      take: limit,
    });

    const nameByBranchId = await this.loadBranchNames(
      orders.flatMap((o) => o.segments.filter((s) => s.vendorBranchId && !s.vendorNameSnapshot).map((s) => s.vendorBranchId!)),
    );

    const data: CustomerOrderSummaryView[] = [];
    for (const order of orders) {
      const items = order.segments.flatMap((s) => s.items ?? []);
      const payment = order.paymentMethod === 'MANUAL_TRANSFER' ? await this.paymentsRepository.findOne({ where: { orderId: order.id } }) : null;
      data.push({
        id: order.id,
        orderNumber: order.orderNumber,
        createdAt: order.createdAt,
        status: order.status,
        totalMinor: order.totalMinor ?? null,
        paymentMethod: order.paymentMethod,
        electronicPaymentMethod: order.electronicPaymentMethod ?? null,
        awaitingPaymentApproval: this.awaitingApproval(order, payment),
        fulfillmentType: order.fulfillmentType,
        vendorBranchNames: order.segments
          .filter((s) => s.vendorBranchId)
          .map((s) => s.vendorNameSnapshot ?? nameByBranchId.get(s.vendorBranchId!) ?? 'Vendor'),
        itemImageUrls: items.map((i) => i.productImageUrlSnapshot).filter((u): u is string => !!u).slice(0, 3),
        itemCount: items.length,
        eta: await this.orderEtaService.compute({
          status: order.status,
          fulfillmentType: order.fulfillmentType,
          estimatedTravelSeconds: order.estimatedTravelSeconds,
          segments: order.segments,
          paymentBlocksFulfilment: paymentBlocksFulfilment(order.paymentMethod, payment),
        }),
      });
    }

    return { data, page, limit, total };
  }

  async getForCustomer(customerId: string, orderId: string): Promise<CustomerOrderDetailsView> {
    const order = await this.loadOwned(customerId, orderId);

    const nameByBranchId = await this.loadBranchNames(
      order.segments.filter((s) => s.vendorBranchId && !s.vendorNameSnapshot).map((s) => s.vendorBranchId!),
    );

    // Only MANUAL_TRANSFER ever creates a Payment row (see OrderCreationService).
    const payment = order.paymentMethod === 'MANUAL_TRANSFER' ? await this.paymentsRepository.findOne({ where: { orderId } }) : null;
    const driver = await this.loadDriverView(orderId);
    const delivery = await this.deliveriesRepository.findOne({ where: { orderId } });
    const eta = await this.orderEtaService.compute({
      status: order.status,
      fulfillmentType: order.fulfillmentType,
      estimatedTravelSeconds: order.estimatedTravelSeconds,
      segments: order.segments,
      pickedUpAt: delivery?.pickedUpAt ?? null,
      paymentBlocksFulfilment: paymentBlocksFulfilment(order.paymentMethod, payment),
    });

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      createdAt: order.createdAt,
      status: order.status,
      fulfillmentType: order.fulfillmentType,
      deliveryAddressSnapshot: order.deliveryAddressSnapshot ?? null,
      subtotalMinor: order.subtotalMinor,
      deliveryFeeMinor: order.deliveryFeeMinor ?? null,
      discountMinor: order.discountMinor,
      totalMinor: order.totalMinor ?? null,
      paymentMethod: order.paymentMethod,
      electronicPaymentMethod: order.electronicPaymentMethod ?? null,
      walletAmountMinor: Number(order.walletAmountMinor ?? 0),
      amountDueMinor: order.amountDueMinor ?? null,
      coupon: order.couponSnapshot ?? null,
      deliveryBreakdown: this.publicBreakdown(order.deliveryFeeBreakdownSnapshot),
      eta,
      timeline: await this.loadTimeline(orderId),
      customerCanCancel: customerCancellationBlock(order.status, order.segments.map((s) => s.status)) === null,
      payment: this.paymentView(order, payment),
      cancellationReason: order.cancellationReason ?? null,
      cancelledByRole: order.cancelledByRole ?? null,
      failureReason: order.failureReason ?? null,
      failedAt: order.failedAt?.toISOString() ?? null,
      segments: order.segments.map((segment) => ({
        id: segment.id,
        groupType: segment.groupType,
        vendorBranchId: segment.vendorBranchId ?? null,
        vendorBranchName: segment.vendorNameSnapshot ?? (segment.vendorBranchId ? nameByBranchId.get(segment.vendorBranchId) ?? null : null),
        branchAddress: segment.branchAddressSnapshot ?? null,
        status: segment.status,
        subtotalMinor: segment.subtotalMinor ?? null,
        offerDiscountTypeSnapshot: segment.offerDiscountTypeSnapshot ?? null,
        offerDiscountValueSnapshot: segment.offerDiscountValueSnapshot ?? null,
        offerEligibleSubtotalMinorSnapshot: segment.offerEligibleSubtotalMinorSnapshot ?? null,
        offerDiscountAmountMinor: segment.offerDiscountAmountMinor ?? null,
        couponCodeSnapshot: segment.couponCodeSnapshot ?? null,
        expectedReadyAt: segment.expectedReadyAt ?? null,
        preparationEstimateMinutes: segment.preparationEstimateMinutes ?? null,
        items: segment.items.map((item) => ({
          id: item.id,
          productId: item.productId ?? null,
          productNameSnapshot: item.productNameSnapshot ?? null,
          productNameArSnapshot: item.productNameArSnapshot ?? null,
          productImageUrlSnapshot: item.productImageUrlSnapshot ?? null,
          quantity: item.quantity,
          unitPriceMinor: item.unitPriceMinor ?? null,
          actualAmountMinor: item.actualAmountMinor ?? null,
          optionsSnapshot: item.optionsSnapshot ?? [],
          notes: item.notes ?? null,
          pricingUnitSnapshot: item.pricingUnitSnapshot ?? null,
          requestedWeightGrams: item.requestedWeightGrams ?? null,
          actualWeightGrams: item.actualWeightGrams ?? null,
          estimatedAmountMinor: item.estimatedAmountMinor ?? null,
          finalAmountMinor: item.finalAmountMinor ?? null,
          freeTextDescriptionSnapshot: item.freeTextDescriptionSnapshot ?? null,
          imageUrlsSnapshot: item.imageUrlsSnapshot ?? null,
          offerMechanismSnapshot: item.offerMechanismSnapshot ?? null,
          offerSpecialPriceMinorSnapshot: item.offerSpecialPriceMinorSnapshot ?? null,
        })),
      })),
      driver,
    };
  }

  async trackForCustomer(customerId: string, orderId: string): Promise<CustomerOrderTrackingView> {
    const order = await this.loadOwned(customerId, orderId);
    const nameByBranchId = await this.loadBranchNames(
      order.segments.filter((s) => s.vendorBranchId && !s.vendorNameSnapshot).map((s) => s.vendorBranchId!),
    );
    const payment = order.paymentMethod === 'MANUAL_TRANSFER' ? await this.paymentsRepository.findOne({ where: { orderId } }) : null;
    const delivery = await this.deliveriesRepository.findOne({ where: { orderId } });
    const paymentView = this.paymentView(order, payment);

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      fulfillmentType: order.fulfillmentType,
      eta: await this.orderEtaService.compute({
        status: order.status,
        fulfillmentType: order.fulfillmentType,
        estimatedTravelSeconds: order.estimatedTravelSeconds,
        segments: order.segments,
        pickedUpAt: delivery?.pickedUpAt ?? null,
        paymentBlocksFulfilment: paymentBlocksFulfilment(order.paymentMethod, payment),
      }),
      timeline: await this.loadTimeline(orderId),
      segments: order.segments.map((s) => ({
        id: s.id,
        vendorName: s.vendorNameSnapshot ?? (s.vendorBranchId ? nameByBranchId.get(s.vendorBranchId) ?? null : null),
        status: s.status,
        expectedReadyAt: s.expectedReadyAt ?? null,
        preparationEstimateMinutes: s.preparationEstimateMinutes ?? null,
      })),
      payment: {
        method: order.paymentMethod,
        electronicMethod: order.electronicPaymentMethod ?? null,
        status: paymentView.status,
        awaitingApproval: paymentView.awaitingApproval,
      },
      customerCanCancel: customerCancellationBlock(order.status, order.segments.map((s) => s.status)) === null,
      cancellationReason: order.cancellationReason ?? null,
    };
  }

  private async loadOwned(customerId: string, orderId: string): Promise<Order> {
    const order = await this.ordersRepository.findOne({ where: { id: orderId }, relations: { segments: { items: true } } });
    if (!order || order.customerId !== customerId) {
      throw new NotFoundException('Order not found.');
    }
    return order;
  }

  private async loadTimeline(orderId: string): Promise<OrderTimelineEntryView[]> {
    const events = await this.statusEventsRepository.find({ where: { orderId }, order: { createdAt: 'ASC' } });
    return events.map((e) => ({ status: e.toStatus, at: e.createdAt, actorRole: e.actorRole ?? null }));
  }

  /** "Order created" is not "payment successful": a transfer nobody has approved yet is awaiting approval. */
  private awaitingApproval(order: Order, payment: Payment | null): boolean {
    return (
      order.paymentMethod === 'MANUAL_TRANSFER' &&
      !!payment &&
      payment.status !== PaymentStatus.PAID &&
      payment.status !== PaymentStatus.REJECTED
    );
  }

  private paymentView(order: Order, payment: Payment | null): CustomerOrderPaymentView {
    const method = order.paymentMethod;
    const status =
      method === 'MANUAL_TRANSFER'
        ? payment?.status ?? null
        : method === 'WALLET'
          ? 'PAID'
          : method === 'COD' || method === 'PAY_AT_DELIVERY'
            ? 'DUE_ON_DELIVERY'
            : null;
    return {
      method,
      status,
      amountMinor: payment?.amountMinor ?? null,
      electronicMethod: order.electronicPaymentMethod ?? null,
      walletAmountMinor: Number(order.walletAmountMinor ?? 0),
      amountDueMinor: order.amountDueMinor ?? null,
      awaitingApproval: this.awaitingApproval(order, payment),
    };
  }

  /** The customer-safe subset of the frozen delivery breakdown (no internal route legs). Null for pickup / ad-hoc orders. */
  private publicBreakdown(snapshot: unknown): OrderDeliveryBreakdownView | null {
    const b = snapshot as Partial<DeliveryFeeBreakdown> | null;
    if (!b || !Array.isArray(b.vendorSequence) || typeof b.deliveryFeeMinor !== 'number') return null;
    const charge = Number(b.additionalVendorChargeMinor ?? 0);
    return {
      baseFeeMinor: b.deliveryFeeMinor - charge,
      additionalVendorFeeMinor: Number(b.additionalVendorFeeMinorUsed ?? 0),
      additionalVendorChargeMinor: charge,
      vendorCount: b.vendorSequence.length,
      distanceMeters: Number(b.roundedTotalDistanceMeters ?? 0),
      frozenTotalFeeMinor: b.deliveryFeeMinor,
      vendors: b.vendorSequence.map((s) => ({ vendorBranchId: s.vendorBranchId, distanceToCustomerMeters: s.distanceToCustomerMeters })),
    };
  }

  private async loadBranchNames(vendorBranchIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(vendorBranchIds)];
    if (ids.length === 0) return new Map();
    const branches = await this.vendorBranchesRepository.find({
      where: ids.map((id) => ({ id })),
      relations: { vendor: true },
    });
    return new Map(branches.map((b) => [b.id, b.vendor?.name ?? b.name]));
  }

  /** name + phone, derived ONLY from the actual Driver assigned via Delivery.driverId. No live location is read or returned. */
  private async loadDriverView(orderId: string): Promise<CustomerOrderDriverView | null> {
    const delivery = await this.deliveriesRepository.findOne({ where: { orderId } });
    if (!delivery?.driverId) return null;

    const driver = await this.driversRepository.findOne({
      where: { id: delivery.driverId },
      relations: { user: true },
    });
    if (!driver?.user) return null;

    return { name: driver.user.fullName, phone: driver.user.phone };
  }
}
