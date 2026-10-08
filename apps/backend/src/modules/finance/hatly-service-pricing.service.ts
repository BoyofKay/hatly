import { BadRequestException, Injectable } from '@nestjs/common';
import { GeoPoint } from '../location/map-provider.interface';
import { BusinessConfigService } from '../business-config/business-config.service';
import { AdHocServiceType } from '../cart/ad-hoc-service-type.enum';

function isValidPoint(p: GeoPoint | null | undefined): p is GeoPoint {
  return (
    !!p &&
    typeof p.latitude === 'number' &&
    typeof p.longitude === 'number' &&
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude) &&
    Math.abs(p.latitude) <= 90 &&
    Math.abs(p.longitude) <= 180
  );
}

/**
 * The frozen Hatly Service delivery charge (stored as the order's delivery breakdown). Every input is recorded, so changing the
 * zone fee, renaming / deactivating the zone or changing the multiplier later never changes what a historical order was charged.
 */
export interface HatlyServiceCharge {
  chargeMinor: number;
  pricingSource: 'DELIVERY_ZONE';
  deliveryZoneId: string;
  /** The zone's fee at that moment — the amount the multiplier was applied to. */
  zoneDeliveryFeeMinorUsed: number;
  multiplierUsed: number;
}

/**
 * PD-009 (amended) — APPROVED Hatly Service pricing is ZONE-BASED:
 *
 *   Hatly Service delivery fee = the address's ACTIVE Delivery Zone fee × HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER
 *
 * No map distance is ever measured and coordinates are never required or used for the price — an address WITH a pin is priced
 * exactly like the same address without one. There is no fallback to distance pricing: without an active zone the charge is
 * refused (`ADDRESS_ZONE_REQUIRED`); the planner has already rejected an inactive zone (`DELIVERY_ZONE_UNAVAILABLE`).
 *
 * The customer's own place is still required by type (it is where the driver goes, never a Hatly default): BUY_FROM_PLACE needs
 * the pickup place, DELIVER_TO_PLACE the destination.
 */
@Injectable()
export class HatlyServicePricingService {
  constructor(private readonly businessConfigService: BusinessConfigService) {}

  async calculateCharge(params: {
    serviceType: AdHocServiceType;
    resolvedPickup?: GeoPoint | null;
    resolvedDestination?: GeoPoint | null;
    /** The address's ACTIVE Delivery Zone, as resolved server-side (never a client-sent fee). */
    deliveryZone: { id: string; deliveryFeeMinor: number } | null | undefined;
  }): Promise<HatlyServiceCharge> {
    const isBuy = params.serviceType === AdHocServiceType.BUY_FROM_PLACE;
    if (isBuy && !isValidPoint(params.resolvedPickup)) {
      throw new BadRequestException({
        message: 'Please choose the location of the place to buy from.',
        details: { code: 'BUY_FROM_PLACE_PICKUP_REQUIRED' },
      });
    }
    if (!isBuy && !isValidPoint(params.resolvedDestination)) {
      throw new BadRequestException({
        message: 'Please choose a destination for this request.',
        details: { code: 'DELIVER_TO_PLACE_DESTINATION_REQUIRED' },
      });
    }
    const zone = params.deliveryZone;
    if (!zone || !Number.isInteger(zone.deliveryFeeMinor) || zone.deliveryFeeMinor < 0) {
      throw new BadRequestException({
        message: 'Choose the delivery area (zone) of this address.',
        details: { code: 'ADDRESS_ZONE_REQUIRED' },
      });
    }

    const multiplierUsed = await this.businessConfigService.getHatlyServiceDeliveryFeeMultiplier();
    // Integer minor units: round half up to the nearest piastre (an integer times a ≤4-decimal factor).
    const chargeMinor = Math.round(zone.deliveryFeeMinor * multiplierUsed);
    return {
      chargeMinor,
      pricingSource: 'DELIVERY_ZONE',
      deliveryZoneId: zone.id,
      zoneDeliveryFeeMinorUsed: zone.deliveryFeeMinor,
      multiplierUsed,
    };
  }
}
