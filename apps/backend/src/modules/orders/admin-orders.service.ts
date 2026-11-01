import { REPORTING_TIMEZONE } from '../admin-platform/common/platform-sql';
import { isUUID } from 'class-validator';
import { HatlyFundedDiscountSummary, loadHatlyFundedDiscountSummary, loadRefundSummary, OrderRefundSummary } from './order-refund-summary';
import { loadSegmentHistory, SegmentHistoryEntry } from './order-segment-history';
import { FrozenRoute, readFrozenRoute } from './frozen-route';
import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Order } from './entities/order.entity';
import { OrderVendorSegment } from './entities/order-vendor-segment.entity';
import { OrderItem } from './entities/order-item.entity';
import { Payment } from '../payments/entities/payment.entity';
import { Delivery } from '../delivery/entities/delivery.entity';
import { Driver } from '../delivery/entities/driver.entity';
import { User } from '../users/entities/user.entity';
import { FinancialEventService } from '../finance/financial-event.service';
import { DriverCashRemainderService } from '../driver-cash-remainder/driver-cash-remainder.service';
import { AdHocPurchaseRecordService } from './ad-hoc-purchase-record.service';
import { isOrderNumber, isUuid } from './order-number';
import { OrderStatus } from './order-status.enum';
import { PaymentStatus } from '../payments/payment-status.enum';
import { OrderPaymentMethod } from './order-payment-method';
import { CustomItemPriceStatus, customItemPriceStatus } from './custom-item-price-status';
import { CartGroupType } from '../cart/cart-group-type.enum';
import { FulfillmentType } from '../cart/fulfillment-type.enum';
import { DeliveryAddressSnapshot } from './entities/order.entity';
import { OrderStatusEvent } from './entities/order-status-event.entity';
import { DispatchAlert } from '../delivery/entities/dispatch-alert.entity';
import { loadOrderTimeline, OrderTimelineEntry } from './order-status-history.service';

// M3b (Launch-Readiness Gap Audit, G-04). Same contract as
// CustomerOrdersService.listForCustomer / WalletService.
// listTransactionsForCustomer — not a new pagination shape.
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export interface AdminOrderListItemView {
  id: string;
  orderNumber: string;
  status: string;
  createdAt: Date;
  totalMinor: number | null;
  paymentMethod: string;
  paymentStatus: string | null;
  /** Operational Completion milestone (additive): DELIVERY or PICKUP. */
  fulfillmentType: string;
  customer: { id: string; fullName: string; phone: string } | null;
  segmentCount: number;
  /** At least one Hatly Service request of this order has no confirmed price yet. An ordinary zero-value order is never pending. */
  hasPendingHatlyServicePricing: boolean;
  /** Names of the vendors that have a part in this order (workspace list: who is preparing it). Never customer data. */
  vendorNames: string[];
  /** The driver on the order while one is on record (assigned … delivered); null while it waits for a driver. */
  driver: { id: string; fullName: string } | null;
}

export interface AdminOrderSearchResult {
  data: AdminOrderListItemView[];
  page: number;
  limit: number;
  total: number;
}

export interface SearchAdminOrdersParams {
  vendorBranchId?: string;
  /** Africa/Cairo calendar dates (YYYY-MM-DD, inclusive). */
  from?: string;
  to?: string;
  minTotalMinor?: number;
  maxTotalMinor?: number;
  page?: number;
  limit?: number;
  search?: string;
  status?: OrderStatus;
  /** Any of these statuses (queue views). */
  statuses?: OrderStatus[];
  dateFrom?: string;
  dateTo?: string;
  paymentStatus?: PaymentStatus;
  paymentMethod?: OrderPaymentMethod;
  /**
   * M3c (Launch-Readiness Gap Audit, G-10) addition — an exact-match
   * filter, distinct from `search` (which for a non-order-number/UUID
   * value does an ILIKE partial match against phone/name and could in
   * principle be ambiguous). `AdminCustomersService`'s customer detail
   * view uses this to reuse this exact method for "recent orders" and
   * "order count" precisely, rather than duplicating this query.
   */
  customerId?: string;
  /** Only orders with a Hatly Service request still waiting for its confirmed price (see the DTO). */
  hasPendingPricing?: boolean;
  /** Only DELIVERY or only PICKUP orders. */
  fulfillmentType?: FulfillmentType;
}

export interface AdminOrderItemView {
  id: string;
  productId: string | null;
  productNameSnapshot: string | null;
  freeTextDescription: string | null;
  imageUrls: string[] | null;
  quantity: number;
  unitPriceMinor: number | null;
  actualAmountMinor: number | null;
  priceStatus: CustomItemPriceStatus | null;
  requestedWeightGrams: number | null;
  actualWeightGrams: number | null;
  offerDiscountAmountMinor: number | null;
  orderVendorSegmentId: string;
}

export interface AdminOrderSegmentView {
  id: string;
  groupType: string;
  vendorBranchId: string | null;
  status: string;
  subtotalMinor: number | null;
  /** Hatly Service (AD_HOC_SERVICE) request details, snapshotted at order creation; null for every other segment. */
  hatlyService: AdminHatlyServiceView | null;
  items: AdminOrderItemView[];
  /** Items taken off the order because they were unavailable (PD-016), with the amount that left the order. */
  removedItems: Array<{ id: string; productNameSnapshot: string | null; quantity: number; removedAmountMinor: number | null; removedAt: Date; exceptionId: string | null }>;
  vendorName: string | null;
  branchName: string | null;
  /** Oldest first: who moved this segment, when, whether Hatly operations acted for the vendor, and the rejection reason. */
  history: SegmentHistoryEntry[];
  /** The reason given when this segment was rejected, if it was. */
  rejectionReason: string | null;
}

/** The route is origin (`pickup*`) → destination (`destination*`), each the customer's choice or the service default (PD-012); `route` carries the labels and sources frozen at checkout (absent on an order placed before PD-012). */
export interface AdminHatlyServiceView {
  serviceType: string | null;
  placeName: string | null;
  pickupLatitude: number | null;
  pickupLongitude: number | null;
  destinationLatitude: number | null;
  destinationLongitude: number | null;
  route: FrozenRoute | null;
}

export interface AdminOrderCustomerView {
  id: string;
  fullName: string;
  phone: string;
}

export interface AdminOrderDriverView {
  id: string;
  fullName: string;
  phone: string;
}

export interface AdminOrderPaymentView {
  id: string;
  method: string;
  status: string;
  amountMinor: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminOrderDetailView {
  id: string;
  /** The customer-facing reference (`HT-100234`) — what support reads back to a customer, never the id. */
  orderNumber: string;
  status: string;
  /** Status history, oldest first (Control Tower milestone). */
  timeline: OrderTimelineEntry[];
  /** Dispatch facts of the delivery (null before any driver was ever assigned). */
  delivery: {
    assignedAt: Date | null;
    acceptDeadlineAt: Date | null;
    pickedUpAt: Date | null;
    deliveredAt: Date | null;
    reassignmentCount: number;
  } | null;
  /** "No eligible driver" alerts raised for this order, newest first, with when (if ever) an assignment resolved them. */
  dispatchAlerts: Array<{ id: string; reason: string; detail: string | null; createdAt: Date; resolvedAt: Date | null }>;
  /** What the dispatcher tried, newest first (last 20): assigned / no driver / disabled / error / timed out / not responding / handed back. */
  dispatchAttempts: Array<{ outcome: string; driverId: string | null; detail: string | null; at: string }>;
  /** What has been given back so far (wallet credits, Manual Transfer refund obligations and whether they were really sent). */
  refundSummary: OrderRefundSummary;
  /** PD-015: the Hatly-funded promotional cost, recorded minus restored (informational). */
  hatlyFundedDiscount: HatlyFundedDiscountSummary;
  customerId: string;
  fulfillmentType: string;
  paymentMethod: string;
  subtotalMinor: number;
  deliveryFeeMinor: number | null;
  discountMinor: number;
  totalMinor: number | null;
  walletAmountMinor: number;
  amountDueMinor: number | null;
  hasPendingAdHocPricing: boolean;
  /** At least one Hatly Service request is still PENDING (narrower than `hasPendingAdHocPricing`, which also counts vendor custom items). */
  hasPendingHatlyServicePricing: boolean;
  deliveryAddress: DeliveryAddressSnapshot | null;
  cancellationReason: string | null;
  cancelledByRole: string | null;
  failureReason: string | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  customer: AdminOrderCustomerView | null;
  driver: AdminOrderDriverView | null;
  segments: AdminOrderSegmentView[];
  payment: AdminOrderPaymentView | null;
  financialEvents: unknown[];
  driverCashRemainders: unknown[];
  adHocPurchaseRecords: unknown[];
}

/**
 * Admin Order Detail View (Chunk 2a). Read-only capability only —
 * CONFIRMED, no business logic, no state-machine change, no refund,
 * no resolution entity. Assembles ALREADY-PERSISTED data from
 * existing entities/services for a future Failed Delivery Review
 * workflow to be built on top of later (not this chunk). Deliberately
 * NOT scoped to any customer — an Admin may look up any Order by id,
 * unlike `CustomerOrdersService.getForCustomer`.
 *
 * Reuses existing services for related data rather than duplicating
 * their query logic: `FinancialEventService.findByOrderId` (already
 * existed), `DriverCashRemainderService.findByOrderId` (new, minimal,
 * read-only — added this chunk), `AdHocPurchaseRecordService.
 * findByOrderId` (same).
 */
/** Statuses in which the delivery's driver is (or was, to completion) the order's driver. */
const DRIVER_OF_RECORD_STATUSES: string[] = [
  OrderStatus.ASSIGNED_TO_DRIVER,
  OrderStatus.PICKED_UP,
  OrderStatus.ON_THE_WAY,
  OrderStatus.DELIVERED,
  OrderStatus.FAILED_DELIVERY,
];

@Injectable()
export class AdminOrdersService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly financialEventService: FinancialEventService,
    private readonly driverCashRemainderService: DriverCashRemainderService,
    private readonly adHocPurchaseRecordService: AdHocPurchaseRecordService,
  ) {}

  /**
   * Accepts either the internal UUID or the customer-facing order number (`HT-100234`) — support reads the number back to a
   * customer and looks it up exactly as given, with no separate lookup path: this resolves it to the SAME `id` `getOne` already
   * uses, once, before the rest of the assembly below runs unchanged.
   */
  async getOneByIdOrOrderNumber(idOrOrderNumber: string): Promise<AdminOrderDetailView> {
    if (isOrderNumber(idOrOrderNumber)) {
      const order = await this.dataSource.getRepository(Order).findOne({ where: { orderNumber: idOrOrderNumber } });
      if (!order) {
        throw new NotFoundException('Order not found.');
      }
      return this.getOne(order.id);
    }
    // Neither an order number nor a UUID: unknown (it used to reach PostgreSQL as a uuid cast and answer 500).
    if (!isUUID(idOrOrderNumber)) throw new NotFoundException('Order not found.');
    return this.getOne(idOrOrderNumber);
  }

  async getOne(orderId: string): Promise<AdminOrderDetailView> {
    const order = await this.dataSource.getRepository(Order).findOne({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException('Order not found.');
    }

    const [segments, payment, customer, delivery, financialEvents, driverCashRemainders, adHocPurchaseRecords] = await Promise.all([
      this.dataSource.getRepository(OrderVendorSegment).find({ where: { orderId } }),
      this.dataSource.getRepository(Payment).findOne({ where: { orderId } }),
      this.dataSource.getRepository(User).findOne({ where: { id: order.customerId } }),
      this.dataSource.getRepository(Delivery).findOne({ where: { orderId } }),
      this.financialEventService.findByOrderId(orderId),
      this.driverCashRemainderService.findByOrderId(orderId),
      this.adHocPurchaseRecordService.findByOrderId(orderId),
    ]);

    const segmentIds = segments.map((s) => s.id);
    const items =
      segmentIds.length > 0
        ? await this.dataSource
            .getRepository(OrderItem)
            .createQueryBuilder('item')
            .where('item.order_vendor_segment_id IN (:...segmentIds)', {
              segmentIds,
            })
            .getMany()
        : [];

    // A delivery row keeps the driver it was RELEASED from (timeout / driver release back to READY_FOR_PICKUP): that driver
    // is only "the order's driver" while on it or once they finished it (Control Tower milestone fix).
    const driverOnRecord = DRIVER_OF_RECORD_STATUSES.includes(order.status);
    const query = (sql: string, params?: unknown[]) => this.dataSource.query(sql, params);
    const [timeline, dispatchAlerts, segmentHistory, refundSummary, attemptRows, hatlyFundedDiscount] = await Promise.all([
      loadOrderTimeline(this.dataSource.getRepository(OrderStatusEvent), orderId),
      this.dataSource.getRepository(DispatchAlert).find({ where: { orderId }, order: { createdAt: 'DESC' } }),
      loadSegmentHistory(query, orderId, 'FULL'),
      loadRefundSummary(query, orderId),
      query('SELECT outcome, driver_id, detail, created_at FROM dispatch_attempts WHERE order_id = $1 ORDER BY created_at DESC LIMIT 20', [orderId]),
      loadHatlyFundedDiscountSummary(query, orderId),
    ]);

    let driver: AdminOrderDriverView | null = null;
    if (driverOnRecord && delivery?.driverId) {
      const driverRow = await this.dataSource.getRepository(Driver).findOne({ where: { id: delivery.driverId } });
      if (driverRow) {
        const driverUser = await this.dataSource.getRepository(User).findOne({ where: { id: driverRow.userId } });
        if (driverUser) {
          driver = {
            id: driverRow.id,
            fullName: driverUser.fullName,
            phone: driverUser.phone,
          };
        }
      }
    }

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      customerId: order.customerId,
      fulfillmentType: order.fulfillmentType,
      paymentMethod: order.paymentMethod,
      subtotalMinor: order.subtotalMinor,
      deliveryFeeMinor: order.deliveryFeeMinor ?? null,
      discountMinor: order.discountMinor,
      totalMinor: order.totalMinor ?? null,
      walletAmountMinor: Number(order.walletAmountMinor ?? 0),
      amountDueMinor: order.amountDueMinor ?? null,
      hasPendingAdHocPricing: order.hasPendingAdHocPricing,
      hasPendingHatlyServicePricing: segments.some(
        (segment) =>
          segment.groupType === CartGroupType.AD_HOC_SERVICE &&
          items.some((item) => item.orderVendorSegmentId === segment.id && customItemPriceStatus(item) === 'PENDING'),
      ),
      deliveryAddress: order.deliveryAddressSnapshot ?? null,
      cancellationReason: order.cancellationReason ?? null,
      cancelledByRole: order.cancelledByRole ?? null,
      failureReason: order.failureReason ?? null,
      failedAt: order.failedAt ?? null,
      createdAt: (order as any).createdAt,
      updatedAt: (order as any).updatedAt,
      customer: customer
        ? {
            id: customer.id,
            fullName: customer.fullName,
            phone: customer.phone,
          }
        : null,
      driver,
      // Control Tower milestone (additive): what happened, and the dispatch facts behind the current state.
      timeline,
      delivery: delivery
        ? {
            assignedAt: driverOnRecord ? delivery.assignedAt ?? null : null,
            acceptDeadlineAt: order.status === OrderStatus.ASSIGNED_TO_DRIVER ? delivery.acceptDeadlineAt ?? null : null,
            pickedUpAt: delivery.pickedUpAt ?? null,
            deliveredAt: delivery.deliveredAt ?? null,
            reassignmentCount: delivery.reassignmentCount ?? 0,
          }
        : null,
      dispatchAlerts: dispatchAlerts.map((a) => ({ id: a.id, reason: a.reason, detail: a.detail ?? null, createdAt: (a as any).createdAt, resolvedAt: a.resolvedAt ?? null })),
      dispatchAttempts: attemptRows.map((r: any) => ({ outcome: r.outcome, driverId: r.driver_id ?? null, detail: r.detail ?? null, at: new Date(r.created_at).toISOString() })),
      refundSummary,
      hatlyFundedDiscount,
      segments: segments.map((segment) => ({
        id: segment.id,
        groupType: segment.groupType,
        vendorBranchId: segment.vendorBranchId ?? null,
        status: segment.status,
        subtotalMinor: segment.subtotalMinor ?? null,
        vendorName: segment.vendorNameSnapshot ?? null,
        branchName: segment.branchNameSnapshot ?? null,
        history: segmentHistory.get(segment.id) ?? [],
        rejectionReason: [...(segmentHistory.get(segment.id) ?? [])].reverse().find((e) => e.toStatus === 'CANCELLED')?.reason ?? null,
        hatlyService:
          segment.groupType === CartGroupType.AD_HOC_SERVICE
            ? {
                serviceType: segment.adHocServiceTypeSnapshot ?? null,
                placeName: segment.adHocPlaceNameSnapshot ?? null,
                pickupLatitude: segment.adHocPickupLatitudeSnapshot ?? null,
                pickupLongitude: segment.adHocPickupLongitudeSnapshot ?? null,
                destinationLatitude: segment.adHocDestinationLatitudeSnapshot ?? null,
                destinationLongitude: segment.adHocDestinationLongitudeSnapshot ?? null,
                route: readFrozenRoute(order.deliveryFeeBreakdownSnapshot),
              }
            : null,
        removedItems: items
          .filter((item) => item.orderVendorSegmentId === segment.id && item.removedAt)
          .map((item) => ({ id: item.id, productNameSnapshot: item.productNameSnapshot ?? null, quantity: item.quantity, removedAmountMinor: item.removedAmountMinor == null ? null : Number(item.removedAmountMinor), removedAt: item.removedAt!, exceptionId: item.removalExceptionId ?? null })),
        items: items
          .filter((item) => item.orderVendorSegmentId === segment.id && !item.removedAt)
          .map((item) => ({
            id: item.id,
            productId: item.productId ?? null,
            productNameSnapshot: item.productNameSnapshot ?? null,
            freeTextDescription: item.freeTextDescriptionSnapshot ?? null,
            imageUrls: item.imageUrlsSnapshot ?? null,
            quantity: item.quantity,
            unitPriceMinor: item.unitPriceMinor ?? null,
            actualAmountMinor: item.actualAmountMinor ?? null,
            priceStatus: customItemPriceStatus(item),
            requestedWeightGrams: item.requestedWeightGrams ?? null,
            actualWeightGrams: item.actualWeightGrams ?? null,
            offerDiscountAmountMinor: item.offerDiscountAmountMinor ?? null,
            orderVendorSegmentId: item.orderVendorSegmentId,
          })),
      })),
      payment: payment
        ? {
            id: payment.id,
            method: payment.method,
            status: payment.status,
            amountMinor: payment.amountMinor ?? null,
            createdAt: (payment as any).createdAt,
            updatedAt: (payment as any).updatedAt,
          }
        : null,
      financialEvents,
      driverCashRemainders,
      adHocPurchaseRecords,
    };
  }

  /**
   * M3b (Launch-Readiness Gap Audit, G-04) — Admin Order Search/browse.
   * A purpose-built list DTO (`AdminOrderListItemView`), never the raw
   * `Order` entity: no `deliveryAddressSnapshot`, no
   * `checkoutQuoteSnapshot`, no other customer/internal detail beyond
   * what an Admin needs to identify and decide whether to open an
   * order. Opening the full detail reuses the EXISTING `getOne` above
   * — this method never assembles segment/item/financial-event detail
   * itself.
   *
   * Filtering (status/date range/payment) is applied on the SAME
   * query that computes `total` and the page, via joins that are
   * never SELECTed (only referenced in WHERE) — so payment/segment
   * DISPLAY data for the current page is fetched afterward in two
   * small, bounded `IN (...)` queries, mirroring `getOne`'s own
   * established "several simple queries, not one mega-join" shape
   * exactly, rather than fighting TypeORM's entity hydration for a
   * manually-joined, non-relation entity.
   */
  async search(params: SearchAdminOrdersParams): Promise<AdminOrderSearchResult> {
    const page = params.page && params.page > 0 ? params.page : DEFAULT_PAGE;
    const limit = params.limit && params.limit > 0 ? Math.min(params.limit, MAX_LIMIT) : DEFAULT_LIMIT;

    const qb = this.dataSource
      .getRepository(Order)
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.customer', 'customer')
      // Entity property names (camelCase), not raw column names, here — TypeORM's
      // `getManyAndCount()` + a joined relation needs to recognize these as real
      // entity properties to combine them into its internal SELECT/ORDER BY
      // rewriting; a raw snake_case name (which the WHERE clauses below use
      // freely) throws deep inside SelectQueryBuilder for this specific path.
      .orderBy('o.createdAt', 'DESC')
      .addOrderBy('o.id', 'DESC') // deterministic tie-break — createdAt alone is not guaranteed unique
      .skip((page - 1) * limit)
      .take(limit);

    if (params.paymentStatus || params.paymentMethod) {
      qb.leftJoin(Payment, 'payment', 'payment.order_id = o.id');
      if (params.paymentStatus)
        qb.andWhere('payment.status = :paymentStatus', {
          paymentStatus: params.paymentStatus,
        });
    }
    if (params.paymentMethod)
      qb.andWhere('o.payment_method = :paymentMethod', {
        paymentMethod: params.paymentMethod,
      });
    if (params.status) qb.andWhere('o.status = :status', { status: params.status });
    if (params.statuses?.length) qb.andWhere('o.status IN (:...statusList)', { statusList: params.statuses });
    if (params.fulfillmentType) qb.andWhere('o.fulfillment_type = :fulfillmentType', { fulfillmentType: params.fulfillmentType });
    if (params.dateFrom) qb.andWhere('o.created_at >= :dateFrom', { dateFrom: params.dateFrom });
    if (params.dateTo) qb.andWhere('o.created_at <= :dateTo', { dateTo: params.dateTo });
    if (params.vendorBranchId) {
      qb.andWhere('EXISTS (SELECT 1 FROM order_vendor_segments f_seg WHERE f_seg.order_id = o.id AND f_seg.vendor_branch_id = :filterBranchId)', { filterBranchId: params.vendorBranchId });
    }
    if (params.from) qb.andWhere(`o.created_at >= ((:cairoFrom)::date)::timestamp AT TIME ZONE '${REPORTING_TIMEZONE}'`, { cairoFrom: params.from });
    if (params.to) qb.andWhere(`o.created_at < (((:cairoTo)::date + 1))::timestamp AT TIME ZONE '${REPORTING_TIMEZONE}'`, { cairoTo: params.to });
    if (params.minTotalMinor !== undefined) qb.andWhere('o.total_minor >= :minTotal', { minTotal: params.minTotalMinor });
    if (params.maxTotalMinor !== undefined) qb.andWhere('o.total_minor <= :maxTotal', { maxTotal: params.maxTotalMinor });
    if (params.customerId)
      qb.andWhere('o.customer_id = :customerId', {
        customerId: params.customerId,
      });
    if (params.hasPendingPricing) {
      qb.andWhere(`EXISTS (${this.pendingHatlyServiceItemsSql('o.id')})`, {
        adHocGroupType: CartGroupType.AD_HOC_SERVICE,
      });
    }

    const search = params.search?.trim();
    if (search) {
      if (isOrderNumber(search)) {
        qb.andWhere('o.order_number = :search', { search });
      } else if (isUuid(search)) {
        qb.andWhere('o.id = :search', { search });
      } else {
        // Partial match against the customer this order actually belongs to — never any other user's data.
        qb.andWhere('(customer.phone ILIKE :like OR customer.full_name ILIKE :like)', { like: `%${search}%` });
      }
    }

    const [orders, total] = await qb.getManyAndCount();
    const orderIds = orders.map((o) => o.id);

    const [payments, segmentCounts, pendingHatlyServiceOrderIds, vendorNamesByOrder, driverByOrder] =
      orderIds.length > 0
        ? await Promise.all([
            this.paymentsByOrderId(orderIds),
            this.segmentCountsByOrderId(orderIds),
            this.pendingHatlyServiceOrderIds(orderIds),
            this.vendorNamesByOrderId(orderIds),
            this.driversByOrderId(orderIds),
          ])
        : [new Map<string, Payment>(), new Map<string, number>(), new Set<string>(), new Map<string, string[]>(), new Map<string, { id: string; fullName: string }>()];

    return {
      data: orders.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        createdAt: (order as any).createdAt,
        totalMinor: order.totalMinor ?? null,
        paymentMethod: order.paymentMethod,
        paymentStatus: payments.get(order.id)?.status ?? null,
        fulfillmentType: order.fulfillmentType,
        customer: order.customer
          ? {
              id: order.customer.id,
              fullName: order.customer.fullName,
              phone: order.customer.phone,
            }
          : null,
        segmentCount: segmentCounts.get(order.id) ?? 0,
        hasPendingHatlyServicePricing: pendingHatlyServiceOrderIds.has(order.id),
        vendorNames: vendorNamesByOrder.get(order.id) ?? [],
        driver: DRIVER_OF_RECORD_STATUSES.includes(order.status) ? driverByOrder.get(order.id) ?? null : null,
      })),
      page,
      limit,
      total,
    };
  }

  /** The vendor names of each order's parts (catalogue segments only — a Hatly Service request has no vendor). */
  private async vendorNamesByOrderId(orderIds: string[]): Promise<Map<string, string[]>> {
    const rows: Array<{ order_id: string; name: string }> = await this.dataSource.query(
      `SELECT DISTINCT s.order_id, ven.name
         FROM order_vendor_segments s
         JOIN vendor_branches vb ON vb.id = s.vendor_branch_id
         JOIN vendors ven ON ven.id = vb.vendor_id
        WHERE s.order_id = ANY($1::uuid[]) AND s.deleted_at IS NULL
        ORDER BY s.order_id, ven.name`,
      [orderIds],
    );
    const byOrder = new Map<string, string[]>();
    for (const r of rows) byOrder.set(r.order_id, [...(byOrder.get(r.order_id) ?? []), r.name]);
    return byOrder;
  }

  /** The driver named on each order's delivery row (the caller only shows it for statuses where that driver is really on the order). */
  private async driversByOrderId(orderIds: string[]): Promise<Map<string, { id: string; fullName: string }>> {
    const rows: Array<{ order_id: string; driver_id: string; full_name: string }> = await this.dataSource.query(
      `SELECT d.order_id, d.driver_id, u.full_name
         FROM deliveries d JOIN drivers dr ON dr.id = d.driver_id JOIN users u ON u.id = dr.user_id
        WHERE d.order_id = ANY($1::uuid[]) AND d.deleted_at IS NULL`,
      [orderIds],
    );
    return new Map(rows.map((r) => [r.order_id, { id: r.driver_id, fullName: r.full_name }]));
  }

  /**
   * A Hatly Service request is PENDING while it has no confirmed amount: a product-less item of an AD_HOC_SERVICE segment with a
   * NULL `actual_amount_minor` (the same rule as `customItemPriceStatus`). NOT the order's `has_pending_ad_hoc_pricing` flag,
   * which also counts vendor custom requests priced by the vendor.
   */
  private pendingHatlyServiceItemsSql(orderIdExpression: string): string {
    return `SELECT 1 FROM order_items pending_item
      JOIN order_vendor_segments pending_segment ON pending_segment.id = pending_item.order_vendor_segment_id
      WHERE pending_segment.order_id = ${orderIdExpression}
        AND pending_segment.group_type = :adHocGroupType
        AND pending_item.product_id IS NULL
        AND pending_item.actual_amount_minor IS NULL`;
  }

  private async pendingHatlyServiceOrderIds(orderIds: string[]): Promise<Set<string>> {
    const rows: Array<{ id: string }> = await this.dataSource
      .getRepository(Order)
      .createQueryBuilder('o')
      .select('o.id', 'id')
      .where('o.id IN (:...orderIds)', { orderIds })
      .andWhere(`EXISTS (${this.pendingHatlyServiceItemsSql('o.id')})`, {
        adHocGroupType: CartGroupType.AD_HOC_SERVICE,
      })
      .getRawMany();
    return new Set(rows.map((r) => r.id));
  }

  private async paymentsByOrderId(orderIds: string[]): Promise<Map<string, Payment>> {
    const rows = await this.dataSource.getRepository(Payment).createQueryBuilder('payment').where('payment.order_id IN (:...orderIds)', { orderIds }).getMany();
    return new Map(rows.map((p) => [p.orderId, p]));
  }

  private async segmentCountsByOrderId(orderIds: string[]): Promise<Map<string, number>> {
    const rows: Array<{ order_id: string; count: string }> = await this.dataSource
      .getRepository(OrderVendorSegment)
      .createQueryBuilder('segment')
      .select('segment.order_id', 'order_id')
      .addSelect('COUNT(*)', 'count')
      .where('segment.order_id IN (:...orderIds)', { orderIds })
      .groupBy('segment.order_id')
      .getRawMany();
    return new Map(rows.map((r) => [r.order_id, Number(r.count)]));
  }
}
