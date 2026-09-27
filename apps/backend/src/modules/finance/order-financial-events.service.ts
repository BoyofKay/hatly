import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from '../orders/entities/order.entity';
import { OrderVendorSegment } from '../orders/entities/order-vendor-segment.entity';
import { OrderVendorSegmentStatus } from '../orders/order-vendor-segment-status.enum';
import { OrderStatus } from '../orders/order-status.enum';
import { CartGroupType } from '../cart/cart-group-type.enum';
import { VendorBranch } from '../vendors/entities/vendor-branch.entity';
import { Driver } from '../delivery/entities/driver.entity';
import { Delivery } from '../delivery/entities/delivery.entity';
import { FinancialEventService } from './financial-event.service';
import { FinancialEventDirection, FinancialEventType } from './financial-event-type.enum';

/**
 * The single place that reacts to Order.status transitions and
 * recognizes the approved financial events — called from
 * OrderStateMachineService.transition() (see that file's own comment),
 * outside its transaction, after the status change has already
 * committed. No other code path creates VENDOR_COMMISSION_RECOGNIZED,
 * DRIVER_COMMISSION_RECOGNIZED, or the MANUAL_TRANSFER reimbursement —
 * this is the one chokepoint, avoiding the exact "duplicate financial
 * events from multiple code paths" risk called out explicitly.
 *
 * Every write goes through FinancialEventService.record(), which is
 * itself idempotent — a retried/duplicate call here (e.g. two
 * concurrent transition attempts, or transitionIfPossible() being
 * called again) can never double-recognize the same event.
 *
 * CONFIRMED: recognizing a commission/reimbursement event never blocks
 * or fails the operational status transition itself — if a vendor's
 * or driver's commission rate isn't configured yet, that specific
 * event is simply skipped (fails closed on the FINANCIAL side only),
 * never fabricating a rate and never preventing the driver from
 * actually picking up/delivering the order.
 */
@Injectable()
export class OrderFinancialEventsService {
  constructor(
    @InjectRepository(OrderVendorSegment)
    private readonly segmentsRepository: Repository<OrderVendorSegment>,
    @InjectRepository(VendorBranch) private readonly vendorBranchesRepository: Repository<VendorBranch>,
    @InjectRepository(Driver) private readonly driversRepository: Repository<Driver>,
    @InjectRepository(Delivery) private readonly deliveriesRepository: Repository<Delivery>,
    private readonly financialEventService: FinancialEventService,
  ) {}

  async handleTransition(order: Order, to: OrderStatus): Promise<void> {
    switch (to) {
      case OrderStatus.PICKED_UP:
        return this.handlePickedUp(order);
      case OrderStatus.DELIVERED:
        return this.handleDelivered(order);
      case OrderStatus.CANCELLED:
        return this.handleCancelled(order);
      case OrderStatus.FAILED_DELIVERY:
        return this.handleFailedDelivery(order);
      default:
        return; // every other status has no financial event attached
    }
  }

  /**
   * CONFIRMED: vendor commission recognized at pickup, segment-level
   * (never collapsed across a multi-vendor order — each segment gets
   * its own event with its own vendor's own rate).
   *
   * CONFIRMED (decision 6): for a MANUAL_TRANSFER order, the driver
   * pays the vendor(s) from their own money at this same pickup
   * moment — Hatly owes the driver that amount, a reimbursement event,
   * never earnings, never vendor settlement.
   */
  private async handlePickedUp(order: Order): Promise<void> {
    const segments = await this.segmentsRepository.find({ where: { orderId: order.id } });
    // A segment the vendor cancelled is never fulfilled: no commission is earned on it and the
    // driver never pays that vendor (Group 8 finding — both were booked on cancelled segments).
    const catalogSegments = segments.filter(
      (s) =>
        s.groupType === CartGroupType.CATALOG &&
        s.vendorBranchId &&
        s.subtotalMinor != null &&
        s.status !== OrderVendorSegmentStatus.CANCELLED,
    );

    for (const segment of catalogSegments) {
      const branch = await this.vendorBranchesRepository.findOne({ where: { id: segment.vendorBranchId! } });
      if (!branch || branch.commissionRateBasisPoints == null) {
        continue; // fails closed — no rate configured yet, no event fabricated
      }
      const commissionMinor = Math.round((segment.subtotalMinor! * branch.commissionRateBasisPoints) / 10000);
      await this.financialEventService.record({
        type: FinancialEventType.VENDOR_COMMISSION_RECOGNIZED,
        direction: FinancialEventDirection.RECEIVABLE,
        idempotencyKey: `vendor-commission:${segment.id}`,
        amountMinor: commissionMinor,
        orderId: order.id,
        orderVendorSegmentId: segment.id,
        vendorBranchId: branch.id,
        rateSnapshot: { commissionRateBasisPoints: branch.commissionRateBasisPoints },
      });
    }

    if (order.paymentMethod === 'MANUAL_TRANSFER' && catalogSegments.length > 0) {
      const vendorAmountMinor = catalogSegments.reduce((sum, s) => sum + (s.subtotalMinor ?? 0), 0);
      const delivery = await this.deliveriesRepository.findOne({ where: { orderId: order.id } });
      if (delivery?.driverId && vendorAmountMinor > 0) {
        await this.financialEventService.record({
          type: FinancialEventType.DRIVER_REIMBURSEMENT_OWED,
          direction: FinancialEventDirection.PAYABLE,
          idempotencyKey: `manual-transfer-reimbursement:${order.id}`,
          amountMinor: vendorAmountMinor,
          orderId: order.id,
          deliveryId: delivery.id,
          driverId: delivery.driverId,
          reason:
            'Driver paid the vendor(s) from their own money at pickup — Hatly already collected the customer payment via Manual Transfer.',
        });
      }
    }
  }

  /** CONFIRMED: driver commission recognized at delivery, on the driver's own delivery-fee earnings, at the driver's own configured rate. */
  private async handleDelivered(order: Order): Promise<void> {
    if (order.deliveryFeeMinor == null) return;

    const delivery = await this.deliveriesRepository.findOne({ where: { orderId: order.id } });
    if (!delivery?.driverId) return;

    const driver = await this.driversRepository.findOne({ where: { id: delivery.driverId } });
    if (!driver || driver.commissionRateBasisPoints == null) {
      return; // fails closed — no rate configured yet
    }

    const commissionMinor = Math.round((order.deliveryFeeMinor * driver.commissionRateBasisPoints) / 10000);
    await this.financialEventService.record({
      type: FinancialEventType.DRIVER_COMMISSION_RECOGNIZED,
      direction: FinancialEventDirection.RECEIVABLE,
      idempotencyKey: `driver-commission:${order.id}`,
      amountMinor: commissionMinor,
      orderId: order.id,
      deliveryId: delivery.id,
      driverId: driver.id,
      // `baseAmountMinor` (the full delivery-fee earning, before
      // commission) is stored alongside the rate — NOT just the rate
      // alone — so settlement can read the driver's full earning
      // directly rather than trying to back-calculate it from
      // (commissionMinor, rate), which is mathematically impossible
      // whenever rate is exactly 0% (0 / 0 is undefined) — caught and
      // fixed before this was ever saved, not a live bug.
      rateSnapshot: { commissionRateBasisPoints: driver.commissionRateBasisPoints, baseAmountMinor: order.deliveryFeeMinor },
    });
  }

  /**
   * CONFIRMED (decision 7): "preserve the original financial event...
   * record the cancellation and its details." Does NOT create a new
   * reimbursement — if the driver already incurred an expense, that
   * reimbursement event already exists (created at pickup for
   * MANUAL_TRANSFER, or when the driver recorded a Hatly Service
   * purchase — see AdHocPurchaseRecordService). This only adds an
   * informational, linked audit record — never a duplicate financial
   * path (confirmed: "do not duplicate the same reimbursement").
   */
  private async handleCancelled(order: Order): Promise<void> {
    const existingEvents = await this.financialEventService.findByOrderId(order.id);
    const priorExpenseEvent = existingEvents.find(
      (e) => e.type === FinancialEventType.DRIVER_REIMBURSEMENT_OWED,
    );
    if (!priorExpenseEvent) return;

    await this.financialEventService.record({
      type: FinancialEventType.CANCELLATION_WITH_PRIOR_EXPENSE_RECORDED,
      direction: FinancialEventDirection.INFORMATIONAL,
      idempotencyKey: `cancellation-context:${order.id}`,
      orderId: order.id,
      relatedEventId: priorExpenseEvent.id,
      reason:
        'Order cancelled after the driver had already incurred a real expense — see relatedEventId for the preserved original reimbursement event.',
    });
  }

  /**
   * CONFIRMED (decision 8): a distinct, purely informational event —
   * "do NOT invent automatic financial penalties." Any real financial
   * consequence of a failed delivery is a separate decision, not
   * inferred here.
   */
  private async handleFailedDelivery(order: Order): Promise<void> {
    await this.financialEventService.record({
      type: FinancialEventType.FAILED_DELIVERY_RECORDED,
      direction: FinancialEventDirection.INFORMATIONAL,
      idempotencyKey: `failed-delivery:${order.id}`,
      orderId: order.id,
      reason: 'Delivery failed — no automatic financial penalty applied (confirmed rule).',
    });
  }
}
