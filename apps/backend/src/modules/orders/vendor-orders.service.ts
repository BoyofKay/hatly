import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderVendorSegment } from './entities/order-vendor-segment.entity';
import { VendorStaffAuthorizationService } from '../vendors/vendor-staff-authorization.service';

/**
 * Builds the vendor-facing view of an order — deliberately NOT the
 * raw Order/OrderVendorSegment entities. Two confirmed rules enforced
 * here, at the view-building layer, not just by convention:
 *   1. A vendor only ever sees THEIR OWN segment(s) on an order, never
 *      a sibling vendor's segment — even when both exist on the same
 *      multi-vendor order. Filtered by VendorStaff-owned branch IDs.
 *   2. A vendor never sees `customerId`, `deliveryAddressSnapshot`, or
 *      any customer phone/contact field — none of those fields are
 *      read from Order at all in this file, not merely omitted from
 *      the response after being fetched.
 */

export interface VendorOrderItemView {
  id: string;
  productId: string | null;
  productNameSnapshot: string | null;
  quantity: number;
  unitPriceMinor: number | null;
  /**
   * Vendor Custom Item Pricing (Chunk 4C). The final operational
   * price recorded via `recordVendorPrice`/`recordDriverPurchase` —
   * null until (and unless) one has been recorded. `unitPriceMinor`
   * above is NEVER a substitute for this: it stays permanently null
   * for a Custom Request regardless of pricing state, since it
   * represents "what the customer saw at checkout," not the final
   * amount.
   */
  actualAmountMinor: number | null;
  optionsSnapshot: Array<{ name: string; valueName: string; priceDeltaMinor: number }>;
  notes: string | null;
  freeTextDescriptionSnapshot: string | null;
  imageUrlsSnapshot: string[] | null;
  /**
   * PHASE I-A, CHUNK 4 addition (Vendor Dashboard). Read-only,
   * already-existing OrderItem fields — previously not projected onto
   * this view at all, which meant the Vendor UI had no way to know
   * which items are WEIGHT-priced or what weight was requested/
   * already recorded. Purely additive: no calculation, no state
   * change, no new business rule — Weighted Products' own frozen
   * rules (first-actor-wins, immutability once recorded) are entirely
   * unaffected; this only exposes data that already existed.
   */
  pricingUnitSnapshot: string | null;
  requestedWeightGrams: number | null;
  actualWeightGrams: number | null;
}

export interface VendorOrderSegmentView {
  id: string;
  groupType: string;
  vendorBranchId: string;
  vendorNoteSnapshot: string | null;
  status: string;
  subtotalMinor: number | null;
  expectedReadyAt: Date | null;
  items: VendorOrderItemView[];
}

export interface VendorOrderView {
  id: string;
  status: string; // order-level status — read-only info for the vendor, never written here
  fulfillmentType: string;
  orderNote: string | null;
  paymentMethod: string;
  segments: VendorOrderSegmentView[];
}

@Injectable()
export class VendorOrdersService {
  constructor(
    @InjectRepository(OrderVendorSegment)
    private readonly segmentsRepository: Repository<OrderVendorSegment>,
    private readonly vendorStaffAuthorizationService: VendorStaffAuthorizationService,
  ) {}

  async listForUser(userId: string): Promise<VendorOrderView[]> {
    const ownedBranchIds = await this.vendorStaffAuthorizationService.getOwnedBranchIds(userId);
    if (ownedBranchIds.length === 0) {
      return [];
    }

    const segments = await this.segmentsRepository.find({
      where: ownedBranchIds.map((vendorBranchId) => ({ vendorBranchId })),
      relations: { order: true, items: true },
      order: { createdAt: 'DESC' },
    });

    return this.groupSegmentsByOrder(segments);
  }

  async getForUser(userId: string, orderId: string): Promise<VendorOrderView> {
    const ownedBranchIds = await this.vendorStaffAuthorizationService.getOwnedBranchIds(userId);
    if (ownedBranchIds.length === 0) {
      throw new NotFoundException('Order not found.');
    }

    const segments = await this.segmentsRepository.find({
      where: ownedBranchIds.map((vendorBranchId) => ({ orderId, vendorBranchId })),
      relations: { order: true, items: true },
    });

    if (segments.length === 0) {
      // Same "not found" whether the order doesn't exist at all or
      // exists but has no segment owned by this vendor — no reason to
      // leak which, matching CartService.getOwnedCartForItem's pattern.
      throw new NotFoundException('Order not found.');
    }

    return this.groupSegmentsByOrder(segments)[0];
  }

  private groupSegmentsByOrder(segments: OrderVendorSegment[]): VendorOrderView[] {
    const byOrderId = new Map<string, VendorOrderView>();

    for (const segment of segments) {
      let view = byOrderId.get(segment.orderId);
      if (!view) {
        view = {
          id: segment.order.id,
          status: segment.order.status,
          fulfillmentType: segment.order.fulfillmentType,
          orderNote: segment.order.orderNote ?? null,
          paymentMethod: segment.order.paymentMethod,
          segments: [],
        };
        byOrderId.set(segment.orderId, view);
      }

      view.segments.push({
        id: segment.id,
        groupType: segment.groupType,
        vendorBranchId: segment.vendorBranchId!,
        vendorNoteSnapshot: segment.vendorNoteSnapshot ?? null,
        status: segment.status,
        subtotalMinor: segment.subtotalMinor ?? null,
        expectedReadyAt: segment.expectedReadyAt ?? null,
        items: (segment.items ?? []).map((item) => ({
          id: item.id,
          productId: item.productId ?? null,
          productNameSnapshot: item.productNameSnapshot ?? null,
          quantity: item.quantity,
          unitPriceMinor: item.unitPriceMinor ?? null,
          actualAmountMinor: item.actualAmountMinor ?? null,
          optionsSnapshot: item.optionsSnapshot ?? [],
          notes: item.notes ?? null,
          freeTextDescriptionSnapshot: item.freeTextDescriptionSnapshot ?? null,
          imageUrlsSnapshot: item.imageUrlsSnapshot ?? null,
          pricingUnitSnapshot: item.pricingUnitSnapshot ?? null,
          requestedWeightGrams: item.requestedWeightGrams ?? null,
          actualWeightGrams: item.actualWeightGrams ?? null,
        })),
      });
    }

    return [...byOrderId.values()];
  }
}
