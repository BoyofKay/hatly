import { Injectable, NotFoundException } from '@nestjs/common';
import { loadSegmentHistoryForSegments, SegmentHistoryEntry } from './order-segment-history';
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
  voiceNoteUrlSnapshot: string | null;
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
  /** When the segment was created — the basis of "waiting for acceptance for N minutes". */
  createdAt: Date;
  /** Oldest first. `onBehalfOfVendor` marks what Hatly operations did for this branch. */
  history: SegmentHistoryEntry[];
  items: VendorOrderItemView[];
  /** Items taken off this order because they were unavailable (PD-016). Kept apart so existing clients never see them as live items. */
  removedItems: Array<{ id: string; productNameSnapshot: string | null; quantity: number; removedAt: Date }>;
}

export interface VendorOrderView {
  id: string;
  /** The customer-facing order number (HT-…), the one the customer quotes — already shown to vendors in their order history. */
  orderNumber: string;
  status: string; // order-level status — read-only info for the vendor, never written here
  fulfillmentType: string;
  orderNote: string | null;
  paymentMethod: string;
  segments: VendorOrderSegmentView[];
}

/**
 * Upper bound on one vendor order list (newest first). The list used to load EVERY segment the vendor's branches ever had, with
 * their order and items, on each dashboard view — a cost that grows forever with a busy branch. Older orders stay reachable by id.
 */
export const VENDOR_ORDERS_LIST_MAX_SEGMENTS = 500;

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
      take: VENDOR_ORDERS_LIST_MAX_SEGMENTS,
    });
    const visible = await this.onlyVendorVisible(segments);

    return this.groupSegmentsByOrder(visible, await this.historyFor(visible));
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

    if (segments.length === 0 || (await this.onlyVendorVisible(segments)).length === 0) {
      // R2: an InstaPay / Vodafone Cash order whose payment Operations have not verified yet is answered exactly like a missing one.
      // Same "not found" whether the order doesn't exist at all or
      // exists but has no segment owned by this vendor — no reason to
      // leak which, matching CartService.getOwnedCartForItem's pattern.
      throw new NotFoundException('Order not found.');
    }

    return this.groupSegmentsByOrder(segments, await this.historyFor(segments))[0];
  }

  /** R2: drops segments of MANUAL_TRANSFER orders whose payment is not PAID yet (see vendor-order-visibility.ts). */
  private async onlyVendorVisible(segments: OrderVendorSegment[]): Promise<OrderVendorSegment[]> {
    const gated = [...new Set(segments.filter((s) => s.order?.paymentMethod === 'MANUAL_TRANSFER').map((s) => s.orderId))];
    if (gated.length === 0) return segments;
    const paid: Array<{ order_id: string }> = await this.segmentsRepository.query(
      `SELECT order_id FROM payments WHERE order_id = ANY($1) AND status = 'PAID'`,
      [gated],
    );
    const paidIds = new Set(paid.map((r) => r.order_id));
    return segments.filter((s) => s.order?.paymentMethod !== 'MANUAL_TRANSFER' || paidIds.has(s.orderId));
  }

  private historyFor(segments: OrderVendorSegment[]) {
    return loadSegmentHistoryForSegments((sql, params) => this.segmentsRepository.query(sql, params), segments.map((s) => s.id), 'ROLE');
  }

  private groupSegmentsByOrder(segments: OrderVendorSegment[], history: Map<string, SegmentHistoryEntry[]>): VendorOrderView[] {
    const byOrderId = new Map<string, VendorOrderView>();

    for (const segment of segments) {
      let view = byOrderId.get(segment.orderId);
      if (!view) {
        view = {
          id: segment.order.id,
          orderNumber: segment.order.orderNumber,
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
        createdAt: (segment as unknown as { createdAt: Date }).createdAt,
        history: history.get(segment.id) ?? [],
        removedItems: (segment.items ?? []).filter((item) => item.removedAt).map((item) => ({ id: item.id, productNameSnapshot: item.productNameSnapshot ?? null, quantity: item.quantity, removedAt: item.removedAt! })),
        items: (segment.items ?? []).filter((item) => !item.removedAt).map((item) => ({
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
            voiceNoteUrlSnapshot: item.voiceNoteUrlSnapshot ?? null,
          pricingUnitSnapshot: item.pricingUnitSnapshot ?? null,
          requestedWeightGrams: item.requestedWeightGrams ?? null,
          actualWeightGrams: item.actualWeightGrams ?? null,
        })),
      });
    }

    return [...byOrderId.values()];
  }
}
