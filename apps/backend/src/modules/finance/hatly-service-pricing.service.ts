import { BadRequestException, Injectable } from '@nestjs/common';
import { GeoPoint } from '../location/map-provider.interface';
import { BusinessConfigService } from '../business-config/business-config.service';
import { AdHocServiceType } from '../cart/ad-hoc-service-type.enum';
import { AddressMode } from '../addresses/address-mode';
import { DeliveryFeeCalculationService } from '../delivery-fee/delivery-fee-calculation.service';

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

/** One end of a Hatly / Wasally route, as resolved server-side and frozen on the order. */
export interface RouteEndpoint {
  latitude: number;
  longitude: number;
  /** What the customer saw for this end (their chosen label, or the configured default's label). */
  label: string | null;
  /** CUSTOMER: chosen in the cart. DEFAULT: the service's configured default (Admin Dashboard). Never the customer's home address unless they chose it. */
  source: 'CUSTOMER' | 'DEFAULT';
}

/**
 * The frozen Hatly / Wasally delivery charge (stored as the order's delivery breakdown). Every input is recorded, so changing a zone
 * fee, the road-distance rate, the minimum fee, a default route location or the multiplier later never changes what a historical
 * order was charged or where its route went.
 *
 *   chargeMinor = round(baseFeeMinor × multiplierUsed)
 *
 * `pricingSource` says how the BASE fee was found: DELIVERY_ZONE (the MANUAL method — the selected zone's fixed fee, or a legacy
 * address) or DISTANCE (the GPS method — actual road distance of the ORIGIN → DESTINATION route priced with the Admin rate per 100 m
 * and minimum fee).
 */
export interface HatlyServiceCharge {
  chargeMinor: number;
  /** The ordinary delivery base fee, BEFORE the multiplier. */
  baseFeeMinor: number;
  /** HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER as it was when the charge was frozen. */
  multiplierUsed: number;
  pricingSource: 'DELIVERY_ZONE' | 'DISTANCE';
  /** The customer's address method; null for a legacy address (saved before the two methods existed). */
  addressMode: AddressMode | null;
  /** HATLY (هاتلي من مكان) or WASALLY (وصّلي لمكان). */
  service: 'HATLY' | 'WASALLY';
  /** The resolved route, direction preserved: origin → destination. Present on every charge frozen from PD-012 on. */
  route: { origin: RouteEndpoint; destination: RouteEndpoint };
  // DELIVERY_ZONE only
  deliveryZoneId?: string;
  /** The zone's fee at that moment — the base fee the multiplier was applied to. */
  zoneDeliveryFeeMinorUsed?: number;
  // DISTANCE only
  rawDistanceMeters?: number;
  roundedDistanceMeters?: number;
  pricePer100mMinorUsed?: number;
  minimumDeliveryFeeMinorUsed?: number;
  /** The two ends of the measured road route (GPS method). Same points as `route`, kept for readers of earlier frozen charges. */
  routeOrigin?: GeoPoint;
  routeDestination?: GeoPoint;
}

/**
 * Hatly ("هاتلي من مكان") and Wasally ("وصّلي لمكان") use the SAME two ordinary delivery base-pricing methods, then ONE multiplier:
 *
 *   1. base fee — by the customer's delivery-address method:
 *        MANUAL (or a legacy address): the selected active Delivery Zone's fixed fee;
 *        GPS: the actual road distance of the route ORIGIN → DESTINATION, priced with the Admin rate per 100 m and minimum fee (the
 *             shared `calculateRouteBaseFee`, same rounding as registered vendors). There is NO fallback to a zone fee when it is
 *             unavailable.
 *   2. final fee = base fee × HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER (Business Config, approved default 1.5) — applied once, to the base
 *      fee, never to the per-100 m rate.
 *
 * The route endpoints (PD-012) are resolved by the checkout planner — the customer's choice, else the service's configured default —
 * and passed in; this service never reads a default itself and never substitutes one.
 */
@Injectable()
export class HatlyServicePricingService {
  constructor(
    private readonly businessConfigService: BusinessConfigService,
    private readonly deliveryFeeCalculationService: DeliveryFeeCalculationService,
  ) {}

  async calculateCharge(params: {
    serviceType: AdHocServiceType;
    origin?: RouteEndpoint | null;
    destination?: RouteEndpoint | null;
    /** The address's ACTIVE Delivery Zone, as resolved server-side (never a client-sent fee). Used by the MANUAL method. */
    deliveryZone: { id: string; deliveryFeeMinor: number } | null | undefined;
    /** How the customer's address was identified; absent for a legacy address. */
    addressMode?: AddressMode | null;
  }): Promise<HatlyServiceCharge> {
    const isBuy = params.serviceType === AdHocServiceType.BUY_FROM_PLACE;
    const { origin, destination } = params;
    if (!isValidPoint(origin)) {
      throw new BadRequestException({
        message: 'Choose where the request starts.',
        details: { code: isBuy ? 'BUY_FROM_PLACE_PICKUP_REQUIRED' : 'DELIVER_TO_PLACE_ORIGIN_REQUIRED' },
      });
    }
    if (!isValidPoint(destination)) {
      throw new BadRequestException({
        message: 'Choose a destination for this request.',
        details: { code: 'SERVICE_DESTINATION_REQUIRED' },
      });
    }
    const addressMode = params.addressMode ?? null;
    const service = isBuy ? 'HATLY' : 'WASALLY';
    const route = { origin, destination };

    if (addressMode === AddressMode.GPS) {
      const route0 = await this.deliveryFeeCalculationService.calculateRouteBaseFee(origin, destination);
      const multiplierUsed = await this.businessConfigService.getHatlyServiceDeliveryFeeMultiplier();
      return {
        // Integer minor units: round half up to the nearest piastre (an integer times a ≤4-decimal factor).
        chargeMinor: Math.round(route0.baseFeeMinor * multiplierUsed),
        baseFeeMinor: route0.baseFeeMinor,
        multiplierUsed,
        pricingSource: 'DISTANCE',
        addressMode,
        service,
        route,
        rawDistanceMeters: route0.rawDistanceMeters,
        roundedDistanceMeters: route0.roundedDistanceMeters,
        pricePer100mMinorUsed: route0.pricePer100mMinorUsed,
        minimumDeliveryFeeMinorUsed: route0.minimumDeliveryFeeMinorUsed,
        routeOrigin: { latitude: origin.latitude, longitude: origin.longitude },
        routeDestination: { latitude: destination.latitude, longitude: destination.longitude },
      };
    }

    const zone = params.deliveryZone;
    if (!zone || !Number.isInteger(zone.deliveryFeeMinor) || zone.deliveryFeeMinor < 0) {
      throw new BadRequestException({
        message: 'Choose the delivery area (zone) of this address.',
        details: { code: 'ADDRESS_ZONE_REQUIRED' },
      });
    }

    const multiplierUsed = await this.businessConfigService.getHatlyServiceDeliveryFeeMultiplier();
    return {
      chargeMinor: Math.round(zone.deliveryFeeMinor * multiplierUsed),
      baseFeeMinor: zone.deliveryFeeMinor,
      multiplierUsed,
      pricingSource: 'DELIVERY_ZONE',
      addressMode,
      service,
      route,
      deliveryZoneId: zone.id,
      zoneDeliveryFeeMinorUsed: zone.deliveryFeeMinor,
    };
  }
}
