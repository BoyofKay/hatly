import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { MAP_PROVIDER, MapProvider, GeoPoint, isMapsDisabled } from '../location/map-provider.interface';
import { BusinessConfigService } from '../business-config/business-config.service';
import { BusinessConfigKey } from '../business-config/business-config-key.enum';
import { roundPricingDistanceMeters } from './pricing-distance-rounding';

/** The base fee of one road-distance route, with every input that produced it (frozen on the order by the caller). */
export interface RouteBaseFee {
  rawDistanceMeters: number;
  roundedDistanceMeters: number;
  pricePer100mMinorUsed: number;
  minimumDeliveryFeeMinorUsed: number;
  baseFeeMinor: number;
}

export interface PricingRouteStop {
  vendorBranchId: string;
  /** Null for a DELIVERY_ZONE breakdown — no distance was measured (the address has no map pin). */
  distanceToCustomerMeters: number | null;
}

/**
 * Frozen at calculation time and stored verbatim on the Order (see
 * order.entity.ts's `deliveryFeeBreakdownSnapshot`) — so a later
 * BusinessConfig change never retroactively changes what a historical
 * order's fee was based on, the same "freeze the inputs, not just the
 * output" principle already used for driver/vendor commission rates
 * elsewhere in this project.
 */
export interface DeliveryFeeBreakdown {
  /**
   * PD-009. Where the BASE fee came from: `DISTANCE` (absent on breakdowns frozen before zones existed — they are all
   * distance-based) = max(minimum, distance fee); `DELIVERY_ZONE` = the selected zone's fee, frozen below.
   */
  pricingSource?: 'DISTANCE' | 'DELIVERY_ZONE';
  /** DELIVERY_ZONE only: the zone and the exact fee it had when this breakdown was frozen. */
  deliveryZoneId?: string;
  zoneDeliveryFeeMinorUsed?: number;
  vendorSequence: PricingRouteStop[]; // DISTANCE: farthest-from-customer first; DELIVERY_ZONE: by vendorBranchId
  legDistancesMeters: number[]; // vendor[0]->vendor[1], ..., last vendor->customer, in that order (empty for DELIVERY_ZONE)
  rawTotalDistanceMeters: number | null; // null for DELIVERY_ZONE
  roundedTotalDistanceMeters: number | null; // null for DELIVERY_ZONE
  pricePer100mMinorUsed: number | null; // null for DELIVERY_ZONE (not an input of its price)
  minimumDeliveryFeeMinorUsed: number | null; // null for DELIVERY_ZONE (not an input of its price)
  additionalVendorFeeMinorUsed: number;
  additionalVendorChargeMinor: number;
  deliveryFeeMinor: number;
  /**
   * Travel-time estimate from the map provider for the SAME route the fee is measured on (vendor legs + last mile), in
   * seconds. Absent on breakdowns frozen before ETA support; never a guess when the provider gave none.
   */
  legEtaSeconds?: number[];
  totalEtaSeconds?: number;
}

/**
 * Registered-vendor (CATALOG-only) delivery-fee pricing — the ONE
 * place this calculation happens. NEVER reads a driver, a Delivery
 * row, or anything dispatch-related — the confirmed business rule is
 * absolute, and this class's dependencies alone prove it structurally
 * (it only depends on MapProvider and BusinessConfigService; there is
 * no way for it to reach driver location even by mistake).
 *
 * AD_HOC_SERVICE orders never call this — see HatlyServicePricingConfig
 * (Phase 2, still a placeholder) for that entirely separate path.
 */
/**
 * The single definition of how a Registered-Vendor delivery fee is composed from its parts:
 * `baseFee + additionalVendorFee * (vendorCount - 1)`, where `baseFee = max(minimumFee, distanceBasedFee)`.
 * Used both when the fee is first calculated (`calculate`) and when it is re-derived after a vendor segment is
 * cancelled (`recalculateForRemainingVendors`), so the formula exists in exactly one place.
 */
export function composeDeliveryFee(params: {
  baseFeeMinor: number;
  additionalVendorFeeMinor: number;
  vendorCount: number;
}): { additionalVendorChargeMinor: number; deliveryFeeMinor: number } {
  const additionalVendorChargeMinor = params.additionalVendorFeeMinor * Math.max(0, params.vendorCount - 1);
  return { additionalVendorChargeMinor, deliveryFeeMinor: params.baseFeeMinor + additionalVendorChargeMinor };
}

@Injectable()
export class DeliveryFeeCalculationService {
  constructor(
    @Inject(MAP_PROVIDER) private readonly mapProvider: MapProvider,
    private readonly businessConfigService: BusinessConfigService,
  ) {}

  /**
   * PD-009 G: `false` when Maps are deliberately disabled (`MAPS_PROVIDER=none`). Callers then price every delivery by its active
   * Delivery Zone (`calculateForZone`) — `calculate()` would only fail closed, it never invents a distance.
   */
  get roadDistancePricingAvailable(): boolean {
    return !isMapsDisabled(this.mapProvider);
  }

  /**
   * `vendorBranches` must be non-empty CATALOG branches only (the
   * caller's responsibility — this service has no way to know what a
   * "CATALOG group" is, by design, to keep it decoupled from Cart/Order
   * concepts). Fails closed (throws) rather than fabricating a number
   * if MapProvider can't produce a real distance, or if any of the
   * three required BusinessConfig values hasn't been set yet — no
   * driver-location fallback exists anywhere in this method.
   */
  // INVARIANT (docs/PRODUCT_DECISIONS.md PD-003): this runs at checkout and for the cart fee quote ONLY. A vendor-segment
  // cancellation must never call it (no distance/Maps recomputation) — the order's Delivery Fee stays fixed; only the
  // Additional Vendor Fee can drop.
  async calculate(
    vendorBranches: Array<{ id: string; latitude: number; longitude: number }>,
    customerLocation: GeoPoint,
  ): Promise<DeliveryFeeBreakdown> {
    if (vendorBranches.length === 0) {
      throw new BadRequestException({
        message: 'At least one vendor branch is required to calculate a delivery fee.',
        details: { code: 'NO_VENDOR_BRANCHES_FOR_PRICING' },
      });
    }

    const distancesToCustomer = await this.wrapMapProviderErrors(() =>
      Promise.all(
        vendorBranches.map(async (branch) => {
          const leg = await this.mapProvider.distanceAndEta(
            { latitude: branch.latitude, longitude: branch.longitude },
            customerLocation,
          );
          return { branch, distanceToCustomerMeters: leg.distanceMeters, etaToCustomerSeconds: leg.etaSeconds };
        }),
      ),
    );

    // Farthest-from-customer first; ties broken by vendorBranchId
    // ascending — a deterministic technical default (an exact tie is
    // an extreme edge case), not a business decision.
    const sorted = [...distancesToCustomer].sort((a, b) => {
      if (b.distanceToCustomerMeters !== a.distanceToCustomerMeters) {
        return b.distanceToCustomerMeters - a.distanceToCustomerMeters;
      }
      return a.branch.id.localeCompare(b.branch.id);
    });

    const vendorSequence: PricingRouteStop[] = sorted.map((s) => ({
      vendorBranchId: s.branch.id,
      distanceToCustomerMeters: s.distanceToCustomerMeters,
    }));

    const legDistancesMeters: number[] = [];
    const legEtaSeconds: number[] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const leg = await this.wrapMapProviderErrors(() =>
        this.mapProvider.distanceAndEta(
          { latitude: sorted[i].branch.latitude, longitude: sorted[i].branch.longitude },
          { latitude: sorted[i + 1].branch.latitude, longitude: sorted[i + 1].branch.longitude },
        ),
      );
      legDistancesMeters.push(leg.distanceMeters);
      legEtaSeconds.push(leg.etaSeconds);
    }
    // Final leg: nearest vendor -> customer (already computed above).
    legDistancesMeters.push(sorted[sorted.length - 1].distanceToCustomerMeters);
    legEtaSeconds.push(sorted[sorted.length - 1].etaToCustomerSeconds);
    // Only a real, positive provider estimate counts — a missing/zero ETA is "unknown", never "0 minutes".
    const etaKnown = legEtaSeconds.every((e) => Number.isFinite(e) && e > 0);

    const rawTotalDistanceMeters = legDistancesMeters.reduce((sum, d) => sum + d, 0);
    const roundedTotalDistanceMeters = roundPricingDistanceMeters(rawTotalDistanceMeters);

    const { pricePer100mMinor, minimumDeliveryFeeMinor, baseFeeMinor } = await this.distanceBaseFee(roundedTotalDistanceMeters);
    const additionalVendorFeeMinor = await this.businessConfigService.getRequired<number>(
      BusinessConfigKey.REGISTERED_VENDOR_ADDITIONAL_VENDOR_FEE_MINOR,
    );
    const { additionalVendorChargeMinor, deliveryFeeMinor } = composeDeliveryFee({
      baseFeeMinor,
      additionalVendorFeeMinor,
      vendorCount: vendorBranches.length,
    });

    return {
      pricingSource: 'DISTANCE',
      vendorSequence,
      legDistancesMeters,
      rawTotalDistanceMeters,
      roundedTotalDistanceMeters,
      pricePer100mMinorUsed: pricePer100mMinor,
      minimumDeliveryFeeMinorUsed: minimumDeliveryFeeMinor,
      additionalVendorFeeMinorUsed: additionalVendorFeeMinor,
      additionalVendorChargeMinor,
      deliveryFeeMinor,
      ...(etaKnown ? { legEtaSeconds, totalEtaSeconds: legEtaSeconds.reduce((sum, e) => sum + e, 0) } : {}),
    };
  }

  /**
   * PD-009 — the base fee of an address WITHOUT a map pin is its Delivery Zone's fee (the caller has already established the zone
   * is active and is the address's pricing source). It goes through the SAME `composeDeliveryFee`, so the additional-vendor fee
   * applies exactly as for distance pricing, and partial cancellation (`recalculateForRemainingVendors`) works unchanged off the
   * frozen breakdown. No map call, no distance, no ETA is invented: those fields are null/empty. Fails closed if the
   * additional-vendor fee has never been configured, like `calculate()`.
   */
  async calculateForZone(
    vendorBranches: Array<{ id: string }>,
    zone: { id: string; deliveryFeeMinor: number },
  ): Promise<DeliveryFeeBreakdown> {
    if (vendorBranches.length === 0) {
      throw new BadRequestException({
        message: 'At least one vendor branch is required to calculate a delivery fee.',
        details: { code: 'NO_VENDOR_BRANCHES_FOR_PRICING' },
      });
    }
    if (!Number.isInteger(zone.deliveryFeeMinor) || zone.deliveryFeeMinor < 0) {
      throw new BadRequestException({
        message: 'Delivery fee could not be calculated right now. Please try again shortly.',
        details: { code: 'DELIVERY_FEE_UNAVAILABLE' },
      });
    }
    const additionalVendorFeeMinor = await this.businessConfigService.getRequired<number>(
      BusinessConfigKey.REGISTERED_VENDOR_ADDITIONAL_VENDOR_FEE_MINOR,
    );
    const { additionalVendorChargeMinor, deliveryFeeMinor } = composeDeliveryFee({
      baseFeeMinor: zone.deliveryFeeMinor,
      additionalVendorFeeMinor,
      vendorCount: vendorBranches.length,
    });
    return {
      pricingSource: 'DELIVERY_ZONE',
      deliveryZoneId: zone.id,
      zoneDeliveryFeeMinorUsed: zone.deliveryFeeMinor,
      // No customer point → no "farthest first" route; a deterministic order (dispatch falls back to the first segment anyway).
      vendorSequence: [...vendorBranches]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((b) => ({ vendorBranchId: b.id, distanceToCustomerMeters: null })),
      legDistancesMeters: [],
      rawTotalDistanceMeters: null,
      roundedTotalDistanceMeters: null,
      pricePer100mMinorUsed: null,
      minimumDeliveryFeeMinorUsed: null,
      additionalVendorFeeMinorUsed: additionalVendorFeeMinor,
      additionalVendorChargeMinor,
      deliveryFeeMinor,
    };
  }

  /**
   * The base delivery fee of ONE route (origin → destination) by actual road distance: the same rounding, rate per 100 m and
   * minimum fee as registered-vendor pricing — the shared definition, not a copy. Used by Hatly and Wasally for the GPS method (their
   * multiplier is applied afterwards, once, to the base fee returned here). Never falls back to a zone fee: when the road-distance
   * provider is disabled the caller gets `DISTANCE_PRICING_UNAVAILABLE`, and an unset rate or minimum fails closed like `calculate()`.
   */
  async calculateRouteBaseFee(from: GeoPoint, to: GeoPoint): Promise<RouteBaseFee> {
    if (!this.roadDistancePricingAvailable) {
      throw new BadRequestException({
        message: 'Delivery by GPS location is not available right now. Please use a manually entered address.',
        details: { code: 'DISTANCE_PRICING_UNAVAILABLE' },
      });
    }
    const leg = await this.wrapMapProviderErrors(() => this.mapProvider.distanceAndEta(from, to));
    const roundedDistanceMeters = roundPricingDistanceMeters(leg.distanceMeters);
    const { pricePer100mMinor, minimumDeliveryFeeMinor, baseFeeMinor } = await this.distanceBaseFee(roundedDistanceMeters);
    return {
      rawDistanceMeters: leg.distanceMeters,
      roundedDistanceMeters,
      pricePer100mMinorUsed: pricePer100mMinor,
      minimumDeliveryFeeMinorUsed: minimumDeliveryFeeMinor,
      baseFeeMinor,
    };
  }

  /** `baseFee = max(minimumFee, distanceBasedFee)` — the one definition of the distance base fee. */
  private async distanceBaseFee(roundedDistanceMeters: number) {
    const pricePer100mMinor = await this.businessConfigService.getRequired<number>(
      BusinessConfigKey.REGISTERED_VENDOR_PRICE_PER_100M_MINOR,
    );
    const minimumDeliveryFeeMinor = await this.businessConfigService.getRequired<number>(
      BusinessConfigKey.REGISTERED_VENDOR_MINIMUM_DELIVERY_FEE_MINOR,
    );
    // roundedDistanceMeters is always an exact multiple of 100 by construction (see roundPricingDistanceMeters), so this
    // division is exact integer arithmetic — never floating point money.
    const distanceFeeMinor = (roundedDistanceMeters / 100) * pricePer100mMinor;
    return { pricePer100mMinor, minimumDeliveryFeeMinor, baseFeeMinor: Math.max(minimumDeliveryFeeMinor, distanceFeeMinor) };
  }

  /**
   * Partial vendor cancellation (PD-002 / PD-003). Re-derives the delivery fee for the vendors that are STILL active,
   * from the `DeliveryFeeBreakdown` frozen on the order at creation — never from the map provider or live
   * BusinessConfig, so the base fee (`max(minimumFee, distanceBasedFee)`) stays exactly what the customer was
   * quoted, and only the additional-vendor part moves:
   *
   *   baseFee            = snapshot.deliveryFeeMinor - snapshot.additionalVendorChargeMinor
   *   deliveryFee(after) = baseFee + additionalVendorFeeMinorUsed * (remainingVendorCount - 1)
   *
   * i.e. removing one vendor removes exactly one additional-vendor fee. With no vendor left the fee is 0.
   * Fails closed (`DELIVERY_FEE_SNAPSHOT_UNAVAILABLE`) if the frozen breakdown is missing or malformed — an invented
   * number would silently over- or under-charge the customer.
   */
  recalculateForRemainingVendors(snapshot: unknown, remainingVendorCount: number): number {
    if (remainingVendorCount <= 0) return 0;

    const b = snapshot as Partial<DeliveryFeeBreakdown> | null | undefined;
    const usable =
      b != null &&
      Number.isFinite(b.deliveryFeeMinor) &&
      Number.isFinite(b.additionalVendorChargeMinor) &&
      Number.isFinite(b.additionalVendorFeeMinorUsed);
    if (!usable) {
      throw new ConflictException({
        message: 'The delivery fee of this order cannot be re-derived because its fee breakdown was not recorded.',
        details: { code: 'DELIVERY_FEE_SNAPSHOT_UNAVAILABLE' },
      });
    }

    return composeDeliveryFee({
      baseFeeMinor: Number(b.deliveryFeeMinor) - Number(b.additionalVendorChargeMinor),
      additionalVendorFeeMinor: Number(b.additionalVendorFeeMinorUsed),
      vendorCount: remainingVendorCount,
    }).deliveryFeeMinor;
  }

  private async wrapMapProviderErrors<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch {
      // Fail closed — never fabricate a distance/fee, and never fall
      // back to any driver-location-derived value (none exists here
      // to fall back to in the first place).
      throw new BadRequestException({
        message: 'Delivery fee could not be calculated right now. Please try again shortly.',
        details: { code: 'DELIVERY_FEE_UNAVAILABLE' },
      });
    }
  }
}
