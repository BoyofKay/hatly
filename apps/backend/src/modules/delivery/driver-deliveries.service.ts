import { Injectable, NotFoundException } from '@nestjs/common';
import { DeliveryAddressSnapshot } from '../orders/entities/order.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
  assignedAt: Date | null;
  acceptDeadlineAt: Date | null;
  pickedUpAt: Date | null;
  deliveredAt: Date | null;
  segments: DriverDeliverySegmentView[];
}

@Injectable()
export class DriverDeliveriesService {
  constructor(
    @InjectRepository(Delivery) private readonly deliveriesRepository: Repository<Delivery>,
    @InjectRepository(VendorBranch) private readonly vendorBranchesRepository: Repository<VendorBranch>,
    private readonly driverAuthorizationService: DriverAuthorizationService,
  ) {}

  async listForUser(userId: string): Promise<DriverDeliveryView[]> {
    const driver = await this.driverAuthorizationService.getDriverForUser(userId);
    const deliveries = await this.deliveriesRepository.find({
      where: { driverId: driver.id },
      relations: { order: { customer: true, segments: { items: true } } },
      order: { createdAt: 'DESC' },
    });
    return this.buildViews(deliveries);
  }

  async getForUser(userId: string, deliveryId: string): Promise<DriverDeliveryView> {
    const driver = await this.driverAuthorizationService.getDriverForUser(userId);
    await this.driverAuthorizationService.assertOwnsDelivery(driver.id, deliveryId);

    const delivery = await this.deliveriesRepository.findOne({
      where: { id: deliveryId },
      relations: { order: { customer: true, segments: { items: true } } },
    });
    if (!delivery) {
      throw new NotFoundException('Delivery not found.');
    }
    return (await this.buildViews([delivery]))[0];
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
      assignedAt: delivery.assignedAt ?? null,
      acceptDeadlineAt: delivery.acceptDeadlineAt ?? null,
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
          items: (segment.items ?? []).map((item) => ({
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
