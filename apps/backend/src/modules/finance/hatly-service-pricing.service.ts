import { Inject, Injectable } from '@nestjs/common';
import { MAP_PROVIDER, MapProvider, GeoPoint } from '../location/map-provider.interface';
import { BusinessConfigService } from '../business-config/business-config.service';
import { AdHocServiceType } from '../cart/ad-hoc-service-type.enum';

export interface HatlyServiceCharge {
  chargeMinor: number;
  distanceMeters: number;
  multiplierUsed: number;
}

/**
 * CONFIRMED (Phase F, decision 3): "Hatly Service pricing uses: Road
 * distance × Hatly Service multiplier... reuse the existing
 * MapProvider/road-distance architecture. Do NOT create another
 * distance engine." This service has exactly one external dependency
 * for distance — the same `MAP_PROVIDER` token
 * `DeliveryFeeCalculationService` already uses — no second provider,
 * no straight-line fallback.
 *
 * Fails closed exactly like the registered-vendor pricing parameters:
 * `BusinessConfigService.getHatlyServiceDistanceMultiplier()` throws
 * if unset, so Hatly Service order creation cannot proceed until an
 * Admin configures it — never a fabricated multiplier.
 *
 * TECHNICAL CHOICE, flagged (not a business decision): the multiplier
 * is interpreted as minor-currency-units per meter (so
 * chargeMinor = round(distanceMeters × multiplier)) — this is the
 * only way to make "distance × multiplier" dimensionally produce a
 * money amount; the multiplier's actual numeric value is not decided
 * here. Also a technical choice: this does NOT reuse the registered-
 * vendor formula's special ≤20m-remainder rounding rule — that rule
 * was specifically approved for that formula, not extended here
 * without being asked; a plain round-to-nearest-minor-unit is used
 * instead, avoiding a fabricated fractional currency amount.
 */
@Injectable()
export class HatlyServicePricingService {
  constructor(
    @Inject(MAP_PROVIDER) private readonly mapProvider: MapProvider,
    private readonly businessConfigService: BusinessConfigService,
  ) {}

  /**
   * `resolvedLocation` must already be resolved (customer-supplied or
   * default-fallback) — this service never reads BusinessConfig
   * location defaults itself, that remains
   * OrderCreationService.resolveAdHocLocations()'s job, unchanged.
   */
  async calculateCharge(params: {
    serviceType: AdHocServiceType;
    resolvedPickup?: GeoPoint | null;
    resolvedDestination?: GeoPoint | null;
    customerLocation: GeoPoint;
  }): Promise<HatlyServiceCharge> {
    const from: GeoPoint =
      params.serviceType === AdHocServiceType.BUY_FROM_PLACE ? params.resolvedPickup! : params.customerLocation;
    const to: GeoPoint =
      params.serviceType === AdHocServiceType.BUY_FROM_PLACE ? params.customerLocation : params.resolvedDestination!;

    const { distanceMeters } = await this.mapProvider.distanceAndEta(from, to);
    const multiplierUsed = await this.businessConfigService.getHatlyServiceDistanceMultiplier();
    const chargeMinor = Math.round(distanceMeters * multiplierUsed);

    return { chargeMinor, distanceMeters, multiplierUsed };
  }
}
