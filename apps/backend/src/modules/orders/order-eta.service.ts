import { Injectable } from '@nestjs/common';
import { BusinessConfigService } from '../business-config/business-config.service';
import { FulfillmentType } from '../cart/fulfillment-type.enum';
import { OrderStatus } from './order-status.enum';
import { OrderVendorSegmentStatus } from './order-vendor-segment-status.enum';

export type OrderEtaState = 'ESTIMATED' | 'UNAVAILABLE' | 'COMPLETED' | 'CANCELLED';

export interface OrderEtaView {
  state: OrderEtaState;
  /** Why no estimate exists (UNAVAILABLE) — never a fabricated time. */
  reason?: string;
  /** The estimated delivery (or pickup-ready) time; the range is `[estimatedAt, estimatedUntil]`. */
  estimatedAt: string | null;
  estimatedUntil: string | null;
  /** The estimate is already in the past while the order is still open (delays never change money or cancel the order). */
  delayed: boolean;
}

export interface OrderEtaInput {
  status: OrderStatus;
  fulfillmentType: FulfillmentType;
  estimatedTravelSeconds?: number | null;
  segments: Array<{ status: OrderVendorSegmentStatus | string; expectedReadyAt?: Date | null }>;
  pickedUpAt?: Date | null;
  /**
   * True while a MANUAL_TRANSFER payment still blocks PREPARING (see `paymentBlocksFulfilment` /
   * `OrderPaymentGateService`) — preparation cannot truly have started yet, so the ETA reports `PAYMENT_NOT_APPROVED`
   * instead of counting down from `expectedReadyAt` (which was only ever an ESTIMATE stamped at order creation). Once the
   * transfer is approved, `reanchorPreparationTiming` re-stamps every still-pending segment's `expectedReadyAt` from that
   * moment, and the ordinary computation below resumes from a timeline that reflects when preparation actually could begin.
   */
  paymentBlocksFulfilment?: boolean;
}

/**
 * Operational ETA of an order. It is DERIVED, never stored and never financial: each active vendor segment's readiness
 * (`expectedReadyAt` — from the branch's configured preparation time, refinable by the vendor) plus the travel time frozen with
 * the quote. If any ingredient is unknown the answer is "unavailable" with a reason — no default, no fake number.
 */
@Injectable()
export class OrderEtaService {
  constructor(private readonly businessConfigService: BusinessConfigService) {}

  async compute(input: OrderEtaInput, now = new Date()): Promise<OrderEtaView> {
    const none = (state: OrderEtaState, reason?: string): OrderEtaView => ({ state, reason, estimatedAt: null, estimatedUntil: null, delayed: false });

    if (input.status === OrderStatus.CANCELLED) return none('CANCELLED');
    if (input.status === OrderStatus.DELIVERED || input.status === OrderStatus.FAILED_DELIVERY) return none('COMPLETED');
    // A pending/rejected Manual Transfer: fulfilment cannot proceed, so no segment could genuinely have started preparing —
    // never present a countdown that implies otherwise.
    if (input.paymentBlocksFulfilment) return none('UNAVAILABLE', 'PAYMENT_NOT_APPROVED');

    const active = input.segments.filter((s) => s.status !== OrderVendorSegmentStatus.CANCELLED);
    if (active.length === 0) return none('UNAVAILABLE', 'NO_ACTIVE_VENDORS');

    let base: Date;
    if ((input.status === OrderStatus.PICKED_UP || input.status === OrderStatus.ON_THE_WAY) && input.pickedUpAt) {
      base = input.pickedUpAt; // the goods are on the road: the clock starts at pickup
    } else {
      if (active.some((s) => !s.expectedReadyAt)) return none('UNAVAILABLE', 'PREPARATION_TIME_NOT_CONFIGURED');
      base = new Date(
        Math.max(
          ...active.map((s) => {
            const ready = new Date(s.expectedReadyAt!).getTime();
            // a segment that is already ready is ready NOW, however long the estimate said
            return s.status === OrderVendorSegmentStatus.READY_FOR_PICKUP || s.status === OrderVendorSegmentStatus.PICKED_UP ? Math.min(ready, now.getTime()) : ready;
          }),
        ),
      );
    }

    let at = base;
    if (input.fulfillmentType === FulfillmentType.DELIVERY) {
      const travel = input.estimatedTravelSeconds;
      if (typeof travel !== 'number' || !(travel > 0)) return none('UNAVAILABLE', 'TRAVEL_TIME_UNAVAILABLE');
      at = new Date(base.getTime() + travel * 1000);
    }

    const buffer = await this.businessConfigService.getEtaRangeBufferMinutes();
    const until = new Date(at.getTime() + (buffer ?? 0) * 60_000);
    return { state: 'ESTIMATED', estimatedAt: at.toISOString(), estimatedUntil: until.toISOString(), delayed: until.getTime() < now.getTime() };
  }
}
