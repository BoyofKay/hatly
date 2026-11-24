import { Injectable, NotFoundException } from '@nestjs/common';
import { FrozenRoute, readFrozenRoute } from '../orders/frozen-route';
import { DeliveryAddressSnapshot } from '../orders/entities/order.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { OrderStatus } from '../orders/order-status.enum';
import { Delivery } from './entities/delivery.entity';
import { VendorBranch } from '../vendors/entities/vendor-branch.entity';
import { DriverAuthorizationService } from './driver-authorization.service';
import { CartGroupType } from '../cart/cart-group-type.enum';

/**
 * Builds the driver-facing view of a delivery. Three confirmed rules
 * enforced here, at the view-building layer:
 *   1. A driver only ever sees deliveries actually assigned to THEM
 *      (Delivery.driverId) — filtered at the query itself, not
 *      filtered after fetching everything.
 *   2. UNLIKE VendorOrdersService (Phase B), this view DOES include
 *      customer name/phone/delivery address — confirmed approved
 *      specifically for drivers, does not change the separate,
 *      still-standing Vendor restriction.
 *   3. UNLIKE VendorOrdersService, this view includes ALL of the
 *      order's segments (every vendor), not just one — a direct,
 *      necessary consequence of the already-approved Multi-Vendor
 *      design: a driver's job is to visit every vendor in the order,
 *      so restricting them to one segment (as vendors are restricted)
 *      would make multi-vendor delivery impossible to execute. This
 *      is not a new rule — it follows from Multi-Vendor's own already-
 *      approved shape once driver visibility was confirmed.
 */

export interface DriverDeliverySegmentItemView {
  id: string;
  productId: string | null;
  productNameSnapshot: string | null;
  quantity: number;
  optionsSnapshot: Array<{ name: string; valueName: string; priceDeltaMinor: number }>;
  notes: string | null;
  freeTextDescriptionSnapshot: string | null;
  imageUrlsSnapshot: string[] | null;
  /**
   * PHASE I-A, CHUNK 5 addition. Same additive, read-only fix already
   * applied to VendorOrderItemView in Chunk 4 — previously absent
   * here too, which meant the Driver UI had no way to know which
   * items are WEIGHT-priced or what to record. Purely additive: no
   * calculation, no state change, no new business rule.
   */
  pricingUnitSnapshot: string | null;
  requestedWeightGrams: number | null;
  actualWeightGrams: number | null;
}

export interface DriverDeliverySegmentView {
  id: string;
  groupType: string;
  status: string;
  vendorBranchId: string | null;
  vendorBranchName: string | null;
  vendorBranchAddress: string | null;
  vendorBranchLatitude: number | null;
  vendorBranchLongitude: number | null;
  adHocPlaceNameSnapshot: string | null;
  adHocServiceTypeSnapshot: string | null;
  adHocPickupLatitudeSnapshot: number | null;
  adHocPickupLongitudeSnapshot: number | null;
  adHocDestinationLatitudeSnapshot: number | null;
  adHocDestinationLongitudeSnapshot: number | null;
  vendorNoteSnapshot: string | null;
  items: DriverDeliverySegmentItemView[];
}

export interface DriverDeliveryView {
  id: string; // Delivery.id
  orderId: string;
  /** The human order number (HT-…), never the internal id. */
  orderNumber: string;
  orderStatus: string;
  fulfillmentType: string;
  orderNote: string | null;
  paymentMethod: string;
  electronicPaymentMethod: string | null;
  totalMinor: number | null;
  /**
   * Driver Core + Dispatch Foundation milestone. The amount the driver must actually collect on delivery —
   * NEVER `totalMinor` (which can overstate it once wallet credit has already covered part of the order).
   * Already computed and stored server-side (`Order.amountDueMinor`, set at checkout/order-creation) — this
   * is purely additive exposure, no new financial ledger, no new calculation. Meaningful only for COD/
   * PAY_AT_DELIVERY; for MANUAL_TRANSFER the amount was already collected before dispatch (payment gating),
   * so a driver has nothing left to collect even though this field is still populated for completeness.
   */
  amountDueMinor: number | null;
  customerName: string;
  customerPhone: string;
  /** The order's frozen address snapshot, with the structured details drivers need to find the door. Null for a pickup order. */
  deliveryAddress: DeliveryAddressSnapshot | null;
  /** Hatly / Wasally orders (PD-012): where to go first and where to deliver — the frozen route. Null for every other order. */
  serviceRoute: FrozenRoute | null;
  assignedAt: Date | null;
  acceptDeadlineAt: Date | null;
  /** R16: when this driver acknowledged the assignment (null = not yet). */
  acknowledgedAt: Date | null;
  pickedUpAt: Date | null;
  deliveredAt: Date | null;
  segments: DriverDeliverySegmentView[];
}

/** Order states after which a delivery is history for the driver. */
const FINISHED_ORDER_STATUSES = [OrderStatus.DELIVERED, OrderStatus.FAILED_DELIVERY, OrderStatus.CANCELLED, OrderStatus.COLLECTED];
/** How many finished deliveries the driver's list carries (newest first). Active ones are never cut. */
export const DRIVER_FINISHED_DELIVERIES_LIMIT = 200;

@Injectable()
export class DriverDeliveriesService {
  constructor(
    @InjectRepository(Delivery) private readonly deliveriesRepository: Repository<Delivery>,
    @InjectRepository(VendorBranch) private readonly vendorBranchesRepository: Repository<VendorBranch>,
    private readonly driverAuthorizationService: DriverAuthorizationService,
  ) {}

  /**
   * Security milestone — bounded. Every ACTIVE delivery is always returned; finished ones (delivered / failed / cancelled / collected)
   * only the newest DRIVER_FINISHED_DELIVERIES_LIMIT. The list used to return the driver's whole history — each row carrying a past
   * customer's name, phone and address — growing forever with every delivery (data minimisation + per-request cost).
   */
  async listForUser(userId: string, scope: 'active' | 'finished' | 'all' = 'all'): Promise<DriverDeliveryView[]> {
    const driver = await this.driverAuthorizationService.getDriverForUser(userId);
    const relations = { order: { customer: true, segments: { items: true } } };
    const [active, finished] = await Promise.all([
      scope === 'finished' ? Promise.resolve([] as Delivery[]) : this.deliveriesRepository.find({
        // A READY_FOR_PICKUP order is waiting for a driver: a delivery row may still name the driver it was RELEASED from (hand-back or
        // timeout), who is no longer on the order and must not see it — nor the customer's name, phone and address on it.
        where: { driverId: driver.id, order: { status: Not(In([...FINISHED_ORDER_STATUSES, OrderStatus.READY_FOR_PICKUP])) } },
        relations,
        order: { createdAt: 'DESC' },
      }),
      scope === 'active' ? Promise.resolve([] as Delivery[]) : this.deliveriesRepository.find({
        where: { driverId: driver.id, order: { status: In(FINISHED_ORDER_STATUSES) } },
        relations,
        order: { createdAt: 'DESC' },
        take: DRIVER_FINISHED_DELIVERIES_LIMIT,
      }),
    ]);
    const deliveries = [...active, ...finished].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return this.buildViews(deliveries);
  }

  /**
   * `options.implicitAcknowledgement` (default true): driver-app builds WITHOUT an acknowledge button (≤ 1.0.0+5) acknowledge by opening
   * the assignment — backward compatibility (R38). Builds that send `X-Hatly-Driver-Ack: explicit` acknowledge only with the button
   * (`POST …/acknowledge`, R16), so opening the order never acknowledges it for them.
   */
  async getForUser(userId: string, deliveryId: string, options: { implicitAcknowledgement?: boolean } = {}): Promise<DriverDeliveryView> {
    const driver = await this.driverAuthorizationService.getDriverForUser(userId);
    await this.driverAuthorizationService.assertOwnsDelivery(driver.id, deliveryId);
    if (options.implicitAcknowledgement !== false) await this.markAcknowledged(deliveryId, driver.id);

    const delivery = await this.deliveriesRepository.findOne({
      where: { id: deliveryId, driverId: driver.id },
      relations: { order: { customer: true, segments: { items: true } } },
    });
    if (!delivery || (delivery.order.status === OrderStatus.READY_FOR_PICKUP && !delivery.earlyAssignedAt)) {
      // Same reason as the list: a released driver is no longer on the order.
      throw new NotFoundException('Delivery not found.');
    }
    return (await this.buildViews([delivery]))[0];
  }

  /** R16: explicit acknowledgement (newer driver apps). Same effect as opening the assignment; returns the delivery. */
  async acknowledgeForUser(userId: string, deliveryId: string): Promise<DriverDeliveryView> {
    const driver = await this.driverAuthorizationService.getDriverForUser(userId);
    await this.driverAuthorizationService.assertOwnsDelivery(driver.id, deliveryId);
    await this.markAcknowledged(deliveryId, driver.id);
    return this.getForUser(userId, deliveryId, { implicitAcknowledgement: false });
  }

  /**
   * Records the CURRENT driver's acknowledgement once (first time only, only while the order is ASSIGNED_TO_DRIVER to this driver)
   * and closes that order's ACKNOWLEDGEMENT_OVERDUE alert in the same statement. Idempotent; never changes the assignment.
   */
  private async markAcknowledged(deliveryId: string, driverId: string): Promise<void> {
    await this.deliveriesRepository.manager.query(
      `WITH ack AS (
         UPDATE deliveries d SET acknowledged_at = now()
           FROM orders o
          WHERE d.id = $1 AND d.driver_id = $2 AND d.acknowledged_at IS NULL AND o.id = d.order_id AND (o.status = 'ASSIGNED_TO_DRIVER' OR (d.early_assigned_at IS NOT NULL AND o.status::text IN ('PENDING','CONFIRMED','PREPARING','READY_FOR_PICKUP')))
        RETURNING d.order_id
       )
       UPDATE dispatch_alerts SET resolved_at = now(), updated_at = now()
        WHERE order_id IN (SELECT order_id FROM ack) AND reason = 'ACKNOWLEDGEMENT_OVERDUE' AND resolved_at IS NULL`,
      [deliveryId, driverId],
    );
  }

  private async buildViews(deliveries: Delivery[]): Promise<DriverDeliveryView[]> {
    const branchIds = [
      ...new Set(
        deliveries
          .flatMap((d) => d.order.segments)
          .filter((s) => s.groupType === CartGroupType.CATALOG && s.vendorBranchId)
          .map((s) => s.vendorBranchId!),
      ),
    ];
    const branches =
      branchIds.length > 0
        ? await this.vendorBranchesRepository.find({ where: branchIds.map((id) => ({ id })) })
        : [];
    const branchById = new Map(branches.map((b) => [b.id, b]));

    return deliveries.map((delivery) => ({
      id: delivery.id,
      orderId: delivery.orderId,
      orderNumber: delivery.order.orderNumber,
      orderStatus: delivery.order.status,
      fulfillmentType: delivery.order.fulfillmentType,
      orderNote: delivery.order.orderNote ?? null,
      paymentMethod: delivery.order.paymentMethod,
      electronicPaymentMethod: delivery.order.electronicPaymentMethod ?? null,
      totalMinor: delivery.order.totalMinor ?? null,
      amountDueMinor: delivery.order.amountDueMinor ?? null,
      customerName: delivery.order.customer.fullName,
      customerPhone: delivery.order.customer.phone,
      deliveryAddress: delivery.order.deliveryAddressSnapshot,
      serviceRoute: readFrozenRoute(delivery.order.deliveryFeeBreakdownSnapshot),
      assignedAt: delivery.assignedAt ?? null,
      acceptDeadlineAt: delivery.acceptDeadlineAt ?? null,
      acknowledgedAt: delivery.acknowledgedAt ?? null,
      pickedUpAt: delivery.pickedUpAt ?? null,
      deliveredAt: delivery.deliveredAt ?? null,
      segments: delivery.order.segments.map((segment) => {
        const branch = segment.vendorBranchId ? branchById.get(segment.vendorBranchId) : undefined;
        return {
          id: segment.id,
          groupType: segment.groupType,
          status: segment.status,
          vendorBranchId: segment.vendorBranchId ?? null,
          vendorBranchName: branch?.name ?? null,
          vendorBranchAddress: branch?.address ?? null,
          vendorBranchLatitude: branch?.latitude ?? null,
          vendorBranchLongitude: branch?.longitude ?? null,
          adHocPlaceNameSnapshot: segment.adHocPlaceNameSnapshot ?? null,
          adHocServiceTypeSnapshot: segment.adHocServiceTypeSnapshot ?? null,
          adHocPickupLatitudeSnapshot: segment.adHocPickupLatitudeSnapshot ?? null,
          adHocPickupLongitudeSnapshot: segment.adHocPickupLongitudeSnapshot ?? null,
          adHocDestinationLatitudeSnapshot: segment.adHocDestinationLatitudeSnapshot ?? null,
          adHocDestinationLongitudeSnapshot: segment.adHocDestinationLongitudeSnapshot ?? null,
          vendorNoteSnapshot: segment.vendorNoteSnapshot ?? null,
          items: (segment.items ?? []).filter((item) => !item.removedAt).map((item) => ({
            id: item.id,
            productId: item.productId ?? null,
            productNameSnapshot: item.productNameSnapshot ?? null,
            quantity: item.quantity,
            optionsSnapshot: item.optionsSnapshot ?? [],
            notes: item.notes ?? null,
            freeTextDescriptionSnapshot: item.freeTextDescriptionSnapshot ?? null,
            imageUrlsSnapshot: item.imageUrlsSnapshot ?? null,
            pricingUnitSnapshot: item.pricingUnitSnapshot ?? null,
            requestedWeightGrams: item.requestedWeightGrams ?? null,
            actualWeightGrams: item.actualWeightGrams ?? null,
          })),
        };
      }),
    }));
  }
}
