import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { AdHocPurchaseRecord } from './entities/ad-hoc-purchase-record.entity';
import { OrderItem } from './entities/order-item.entity';
import { OrderVendorSegment } from './entities/order-vendor-segment.entity';
import { Order } from './entities/order.entity';
import { Delivery } from '../delivery/entities/delivery.entity';
import { FinancialEventService } from '../finance/financial-event.service';
import { FinancialEventDirection, FinancialEventType } from '../finance/financial-event-type.enum';
import { VendorStaffAuthorizationService } from '../vendors/vendor-staff-authorization.service';
import { DriverAuthorizationService } from '../delivery/driver-authorization.service';
import { applyOrderItemAmountDelta } from './apply-order-item-amount-delta.util';
import { CartGroupType } from '../cart/cart-group-type.enum';
import { OrderStatus } from './order-status.enum';

/**
 * Vendor/Driver Deferred Pricing for Custom CATALOG Items. Extends the
 * original AD_HOC_SERVICE-only "record a driver's actual purchase"
 * capability to ALSO cover a vendor-scoped Custom Item priced by
 * either the Vendor or the Driver — see `AdHocPurchaseRecord`'s own
 * updated doc comment.
 *
 * Two public entry points (`recordVendorPrice`/`recordDriverPurchase`)
 * share ONE private core (`recordCore`) — CONFIRMED, not two
 * duplicated implementations. They diverge only on: (a) which
 * authorization check runs, (b) what `recordedByRole`/actor field is
 * written, and (c) whether the `DRIVER_REIMBURSEMENT_OWED` financial
 * event fires afterward — a Vendor never advances any money, so a
 * Vendor-priced record must never create that event.
 *
 * Eligibility (checked in the shared core, identical for both paths):
 * the target `OrderItem` must have `productId === null` (a normal
 * catalog product can never be priced through this mechanism), and no
 * `AdHocPurchaseRecord` may already exist for it (the unique DB index
 * on `order_item_id` remains the actual, final concurrency guard — the
 * in-code check here just produces a clearer error than a raw
 * constraint violation).
 *
 * `OrderItem.unitPriceMinor` is NEVER written here — it stays exactly
 * whatever it was at checkout (`NULL` for a Custom Item), matching the
 * approved rule that it represents "what the customer saw at
 * checkout," never the final operational amount.
 */
@Injectable()
export class AdHocPurchaseRecordService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly financialEventService: FinancialEventService,
    private readonly vendorStaffAuthorizationService: VendorStaffAuthorizationService,
    private readonly driverAuthorizationService: DriverAuthorizationService,
  ) {}

  /**
   * Vendor/Pharmacy pricing. Authorization: the item's own segment's
   * `vendorBranchId` must be among the branches this Vendor Staff user
   * is authorized for (`VendorStaffAuthorizationService.
   * getOwnedBranchIds` — the exact same check already used elsewhere
   * for Vendor-facing order operations, not a new mechanism). Never
   * fires `DRIVER_REIMBURSEMENT_OWED`.
   */
  async recordVendorPrice(orderItemId: string, amountMinor: number, vendorStaffUserId: string): Promise<AdHocPurchaseRecord> {
    const { record } = await this.dataSource.transaction(async (manager) => {
      const item = await this.lockEligibleItem(manager, orderItemId);
      const segment = await manager.findOne(OrderVendorSegment, { where: { id: item.orderVendorSegmentId } });
      if (!segment) {
        throw new NotFoundException('Order segment not found.');
      }
      const ownedBranchIds = await this.vendorStaffAuthorizationService.getOwnedBranchIds(vendorStaffUserId);
      if (!segment.vendorBranchId || !ownedBranchIds.includes(segment.vendorBranchId)) {
        throw new NotFoundException('Order item not found.');
      }

      const newRecord = await this.recordCore(manager, item, segment, amountMinor, {
        recordedByRole: 'VENDOR',
        recordedByUserId: vendorStaffUserId,
        recordedByDriverId: null,
      });
      return { record: newRecord };
    });

    // CONFIRMED: no financial event of any kind — the Vendor never
    // advances any money, so nothing is owed back to anyone.
    return record;
  }

  /**
   * Driver purchase pricing — preserves the EXISTING External Hatly
   * Service behavior exactly (same DRIVER_REIMBURSEMENT_OWED event,
   * same idempotency key shape, fired outside the transaction, never
   * duplicated). Authorization: the Driver must own the Delivery for
   * this item's Order (`DriverAuthorizationService.getDriverForUser` +
   * a direct ownership check against that Order's own Delivery row —
   * the same ownership guarantee `assertOwnsDelivery` already provides
   * elsewhere in this codebase, applied here via the Order rather than
   * a client-supplied deliveryId, since the caller only knows the
   * OrderItem it wants to price).
   */
  async recordDriverPurchase(orderItemId: string, amountMinor: number, driverUserId: string): Promise<AdHocPurchaseRecord> {
    const driver = await this.driverAuthorizationService.getDriverForUser(driverUserId);

    const { record, orderId } = await this.dataSource.transaction(async (manager) => {
      const item = await this.lockEligibleItem(manager, orderItemId);
      const segment = await manager.findOne(OrderVendorSegment, { where: { id: item.orderVendorSegmentId } });
      if (!segment) {
        throw new NotFoundException('Order segment not found.');
      }
      const delivery = await manager.findOne(Delivery, { where: { orderId: segment.orderId } });
      if (!delivery || delivery.driverId !== driver.id) {
        throw new NotFoundException('Order item not found.');
      }

      const newRecord = await this.recordCore(manager, item, segment, amountMinor, {
        recordedByRole: 'DRIVER',
        recordedByUserId: null,
        recordedByDriverId: driver.id,
      });
      return { record: newRecord, orderId: segment.orderId };
    });

    // Outside the transaction, deliberately — matches the pre-existing
    // behavior exactly. Never duplicated: idempotent on orderItemId,
    // the same natural key AdHocPurchaseRecord itself is unique on.
    await this.financialEventService.record({
      type: FinancialEventType.DRIVER_REIMBURSEMENT_OWED,
      direction: FinancialEventDirection.PAYABLE,
      idempotencyKey: `hatly-service-reimbursement:${orderItemId}`,
      amountMinor,
      orderId,
      driverId: driver.id,
      reason: 'Driver purchased an item with their own money — Hatly owes this amount back.',
    });

    return record;
  }

  /**
   * Hatly Service price confirmation by Hatly operations (admin-side). A Hatly Service order is created with an explicit
   * PENDING price; this replaces it with the confirmed amount through the SAME core the Driver and Vendor paths use, so the
   * subtotal, total and amount due are recomputed authoritatively on the backend (never by the client) and the single
   * `ad_hoc_purchase_records` row per item (unique on `order_item_id`) is the audit trail: who confirmed, when, how much.
   *
   *  - Authorization is enforced at the controller (`MANAGE_HATLY_SERVICE_PRICING`).
   *  - Only an item of an AD_HOC_SERVICE (Hatly Service) segment, on an order that is not yet finished/cancelled.
   *  - Atomic (one transaction) and concurrency-safe (order + item row locks; unique index as the final guard).
   *  - Idempotent: repeating the SAME confirmation (same item, same amount) returns the existing record with
   *    `alreadyApplied: true` and changes nothing. A DIFFERENT amount for an already-priced item is refused (409) — a recorded
   *    price is historical evidence and is never rewritten.
   *  - Never fires DRIVER_REIMBURSEMENT_OWED: no driver advanced any money through this path.
   */
  async confirmHatlyServicePrice(
    orderItemId: string,
    amountMinor: number,
    adminUserId: string,
  ): Promise<{ record: AdHocPurchaseRecord; alreadyApplied: boolean }> {
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      throw new BadRequestException({ message: 'amountMinor must be a positive integer.', details: { code: 'INVALID_FINAL_AMOUNT' } });
    }
    return this.dataSource.transaction(async (manager) => {
      const item = await this.lockOrderThenItem(manager, orderItemId);
      if (item.productId !== null && item.productId !== undefined) {
        throw new BadRequestException({ message: 'Only a product-less custom item can have a recorded final price.', details: { code: 'NOT_A_CUSTOM_ITEM' } });
      }
      const segment = await manager.findOne(OrderVendorSegment, { where: { id: item.orderVendorSegmentId } });
      if (!segment) {
        throw new NotFoundException('Order segment not found.');
      }
      if (segment.groupType !== CartGroupType.AD_HOC_SERVICE) {
        throw new BadRequestException({
          message: 'Operations can only confirm the price of a Hatly Service request.',
          details: { code: 'NOT_A_HATLY_SERVICE_ITEM' },
        });
      }
      const order = await manager.findOne(Order, { where: { id: segment.orderId } });
      if (!order) {
        throw new NotFoundException('Order not found.');
      }
      if ([OrderStatus.DELIVERED, OrderStatus.CANCELLED, OrderStatus.FAILED_DELIVERY].includes(order.status)) {
        throw new ConflictException({
          message: 'The price can no longer be confirmed for an order that is finished or cancelled.',
          details: { code: 'ORDER_NOT_PRICEABLE', status: order.status },
        });
      }

      if (item.actualAmountMinor != null) {
        const existing = await manager.findOne(AdHocPurchaseRecord, { where: { orderItemId: item.id } });
        if (existing && existing.recordedByRole === 'ADMIN' && Number(existing.amountMinor) === amountMinor) {
          return { record: existing, alreadyApplied: true };
        }
        throw new ConflictException({
          message: 'A final price has already been recorded for this item and cannot be changed.',
          details: { code: 'PURCHASE_ALREADY_RECORDED' },
        });
      }

      const record = await this.recordCore(manager, item, segment, amountMinor, {
        recordedByRole: 'ADMIN',
        recordedByUserId: adminUserId,
        recordedByDriverId: null,
      });
      return { record, alreadyApplied: false };
    });
  }

  /**
   * Locks the Order row FIRST, then the OrderItem, always in that order — every pricing path (driver, vendor, operations)
   * and every concurrent price on a sibling item of the same order therefore serialize on the order, so the read-modify-write of
   * the order's subtotal/total in `applyOrderItemAmountDelta` can never lose an update, and two paths can never deadlock by
   * taking the two locks in opposite orders. Returns the locked item (not yet checked for eligibility).
   */
  private async lockOrderThenItem(manager: DataSource['manager'], orderItemId: string): Promise<OrderItem> {
    const probe = await manager.findOne(OrderItem, { where: { id: orderItemId } });
    if (!probe) {
      throw new NotFoundException('Order item not found.');
    }
    const probeSegment = await manager.findOne(OrderVendorSegment, { where: { id: probe.orderVendorSegmentId } });
    if (!probeSegment) {
      throw new NotFoundException('Order segment not found.');
    }
    await manager.findOne(Order, { where: { id: probeSegment.orderId }, lock: { mode: 'pessimistic_write' } });
    const item = await manager.findOne(OrderItem, { where: { id: orderItemId }, lock: { mode: 'pessimistic_write' } });
    if (!item) {
      throw new NotFoundException('Order item not found.');
    }
    return item;
  }

  /**
   * Loads the OrderItem under row locks (concurrency-safe — two simultaneous pricing attempts for the same item serialize
   * here, so the "already priced" check below can never both pass) and verifies eligibility. Never returns a normal catalog
   * product's item, never one that's already priced.
   */
  private async lockEligibleItem(manager: DataSource['manager'], orderItemId: string): Promise<OrderItem> {
    const item = await this.lockOrderThenItem(manager, orderItemId);
    if (item.productId !== null && item.productId !== undefined) {
      throw new BadRequestException({
        message: 'Only a product-less custom item can have a recorded final price.',
        details: { code: 'NOT_A_CUSTOM_ITEM' },
      });
    }
    if (item.actualAmountMinor != null) {
      throw new ConflictException({
        message: 'A final price has already been recorded for this item and cannot be changed.',
        details: { code: 'PURCHASE_ALREADY_RECORDED' },
      });
    }
    return item;
  }

  private async recordCore(
    manager: DataSource['manager'],
    item: OrderItem,
    segment: OrderVendorSegment,
    amountMinor: number,
    recorder: { recordedByRole: 'DRIVER' | 'VENDOR' | 'ADMIN'; recordedByDriverId: string | null; recordedByUserId: string | null },
  ): Promise<AdHocPurchaseRecord> {
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      throw new BadRequestException({
        message: 'amountMinor must be a positive integer.',
        details: { code: 'INVALID_FINAL_AMOUNT' },
      });
    }

    // Still-required defense in depth alongside the row lock above —
    // the unique DB index on order_item_id remains the actual, final
    // protection against two concurrent inserts.
    const existing = await manager.findOne(AdHocPurchaseRecord, { where: { orderItemId: item.id } });
    if (existing) {
      throw new ConflictException({
        message: 'A final price has already been recorded for this item and cannot be changed.',
        details: { code: 'PURCHASE_ALREADY_RECORDED' },
      });
    }

    const newRecord = await manager.save(
      AdHocPurchaseRecord,
      manager.create(AdHocPurchaseRecord, {
        orderItemId: item.id,
        amountMinor,
        recordedByRole: recorder.recordedByRole,
        recordedByDriverId: recorder.recordedByDriverId,
        recordedByUserId: recorder.recordedByUserId,
      }),
    );

    // OrderItem.unitPriceMinor is NEVER touched here — see this
    // service's own top comment.
    item.actualAmountMinor = amountMinor;
    await manager.save(OrderItem, item);

    const order = await manager.findOne(Order, { where: { id: segment.orderId } });
    if (!order) {
      throw new NotFoundException('Order not found.');
    }
    // A never-priced item's previous contribution was always 0 —
    // CONFIRMED, `actualAmountMinor` was null before this call, so the
    // full recorded amount IS the delta, same "first-time price" logic
    // already traced for the weight-finalization case.
    await applyOrderItemAmountDelta(manager, segment, order, amountMinor);

    await this.refreshPendingPricingFlag(manager, item.orderVendorSegmentId);
    await this.finalizeTotalsIfComplete(manager, segment.orderId);

    return newRecord;
  }

  /**
   * Hatly Service orders are created with `totalMinor` / `amountDueMinor` NULL ("pending": the price of the request is not known
   * yet — never a fabricated 0). `applyOrderItemAmountDelta` deliberately keeps a NULL total NULL, so without this step the
   * total would stay unknown forever even after every item was priced. Once NO item is pending any more and the delivery fee
   * is known, the authoritative total is `subtotal + deliveryFee - discount` and the amount due is `total - walletApplied`
   * (a Hatly Service order is COD-only, so the wallet part is 0). Never touches an order whose total is already known, and
   * never invents one while anything is still pending or the fee is unknown.
   */
  private async finalizeTotalsIfComplete(manager: DataSource['manager'], orderId: string): Promise<void> {
    const order = await manager.findOne(Order, { where: { id: orderId } });
    if (!order || order.totalMinor != null || order.hasPendingAdHocPricing) return;
    if (order.deliveryFeeMinor == null) return;
    const totalMinor = order.subtotalMinor + order.deliveryFeeMinor - (order.discountMinor ?? 0);
    order.totalMinor = totalMinor;
    if (order.amountDueMinor == null) {
      order.amountDueMinor = Math.max(0, totalMinor - (order.walletAmountMinor ?? 0));
    }
    await manager.save(Order, order);
  }

  /**
   * Unchanged from the pre-existing implementation — re-checks every
   * product-less item across the whole order (not just this segment)
   * and flips `Order.hasPendingAdHocPricing` to false once all of them
   * have a recorded amount. Deliberately does NOT redesign this field
   * or attempt to compute a final `totalMinor` beyond what
   * `applyOrderItemAmountDelta` already does.
   */
  private async refreshPendingPricingFlag(manager: DataSource['manager'], orderVendorSegmentId: string): Promise<void> {
    const segment = await manager.findOne(OrderVendorSegment, { where: { id: orderVendorSegmentId } });
    if (!segment) {
      throw new NotFoundException('Order segment not found.');
    }

    const allItemsInOrder = await manager
      .createQueryBuilder(OrderItem, 'item')
      .innerJoin(OrderVendorSegment, 'segment', 'segment.id = item.order_vendor_segment_id')
      .where('segment.order_id = :orderId', { orderId: segment.orderId })
      .getMany();

    const stillPending = allItemsInOrder.some(
      (i) => (i.productId === null || i.productId === undefined) && i.actualAmountMinor == null,
    );

    await manager.update(Order, { id: segment.orderId }, { hasPendingAdHocPricing: stillPending });
  }

  /**
   * Admin Order Detail View (Chunk 2a). Read-only — CONFIRMED, no
   * business behavior added, no record created/altered. Mirrors
   * `refreshPendingPricingFlag`'s own existing join pattern (OrderItem
   * -> OrderVendorSegment -> Order) to find every item belonging to
   * this order, then returns whatever AdHocPurchaseRecord rows exist
   * for those items (an item with no recorded price simply has none
   * — never fabricated here).
   */
  async findByOrderId(orderId: string): Promise<AdHocPurchaseRecord[]> {
    const manager = this.dataSource.manager;
    const items = await manager
      .createQueryBuilder(OrderItem, 'item')
      .innerJoin(OrderVendorSegment, 'segment', 'segment.id = item.order_vendor_segment_id')
      .where('segment.order_id = :orderId', { orderId })
      .getMany();
    const itemIds = items.map((i) => i.id);
    if (itemIds.length === 0) return [];
    return manager.find(AdHocPurchaseRecord, { where: { orderItemId: In(itemIds) } });
  }
}
