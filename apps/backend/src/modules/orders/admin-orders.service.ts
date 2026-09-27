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
import { isOrderNumber } from './order-number';

export interface AdminOrderItemView {
  id: string;
  productId: string | null;
  productNameSnapshot: string | null;
  freeTextDescription: string | null;
  imageUrls: string[] | null;
  quantity: number;
  unitPriceMinor: number | null;
  actualAmountMinor: number | null;
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
  items: AdminOrderItemView[];
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
  customerId: string;
  fulfillmentType: string;
  paymentMethod: string;
  subtotalMinor: number;
  deliveryFeeMinor: number | null;
  discountMinor: number;
  totalMinor: number | null;
  hasPendingAdHocPricing: boolean;
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
    return this.getOne(idOrOrderNumber);
  }

  async getOne(orderId: string): Promise<AdminOrderDetailView> {
    const order = await this.dataSource.getRepository(Order).findOne({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException('Order not found.');
    }

    const [segments, payment, customer, delivery, financialEvents, driverCashRemainders, adHocPurchaseRecords] =
      await Promise.all([
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
            .where('item.order_vendor_segment_id IN (:...segmentIds)', { segmentIds })
            .getMany()
        : [];

    let driver: AdminOrderDriverView | null = null;
    if (delivery?.driverId) {
      const driverRow = await this.dataSource.getRepository(Driver).findOne({ where: { id: delivery.driverId } });
      if (driverRow) {
        const driverUser = await this.dataSource.getRepository(User).findOne({ where: { id: driverRow.userId } });
        if (driverUser) {
          driver = { id: driverRow.id, fullName: driverUser.fullName, phone: driverUser.phone };
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
      hasPendingAdHocPricing: order.hasPendingAdHocPricing,
      cancellationReason: order.cancellationReason ?? null,
      cancelledByRole: order.cancelledByRole ?? null,
      failureReason: order.failureReason ?? null,
      failedAt: order.failedAt ?? null,
      createdAt: (order as any).createdAt,
      updatedAt: (order as any).updatedAt,
      customer: customer ? { id: customer.id, fullName: customer.fullName, phone: customer.phone } : null,
      driver,
      segments: segments.map((segment) => ({
        id: segment.id,
        groupType: segment.groupType,
        vendorBranchId: segment.vendorBranchId ?? null,
        status: segment.status,
        subtotalMinor: segment.subtotalMinor ?? null,
        items: items
          .filter((item) => item.orderVendorSegmentId === segment.id)
          .map((item) => ({
            id: item.id,
            productId: item.productId ?? null,
            productNameSnapshot: item.productNameSnapshot ?? null,
            freeTextDescription: item.freeTextDescriptionSnapshot ?? null,
            imageUrls: item.imageUrlsSnapshot ?? null,
            quantity: item.quantity,
            unitPriceMinor: item.unitPriceMinor ?? null,
            actualAmountMinor: item.actualAmountMinor ?? null,
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
}
