import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Driver } from './entities/driver.entity';
import { Order } from '../orders/entities/order.entity';
import { VendorBranch } from '../vendors/entities/vendor-branch.entity';
import { CartGroupType } from '../cart/cart-group-type.enum';
import { AdHocServiceType } from '../cart/ad-hoc-service-type.enum';
import { MAP_PROVIDER, MapProvider, GeoPoint, isMapsDisabled } from '../location/map-provider.interface';
import { BusinessConfigService } from '../business-config/business-config.service';
import { ServiceAreaResolverService, haversineDistanceMeters } from '../service-areas/service-area-resolver.service';

/**
 * CONFIRMED BUSINESS DECISIONS implemented here:
 *   - Rank by distance to the FIRST pickup point, nearest driver first.
 *   - For a multi-vendor order, "first pickup point" reuses the
 *     ALREADY-APPROVED existing vendor ordering — the same
 *     farthest-from-customer-first sequence already computed and
 *     frozen at order creation for pricing
 *     (`Order.deliveryFeeBreakdownSnapshot.vendorSequence`). Its first
 *     entry (farthest from the customer) is the natural first pickup
 *     stop of that route. This reuses existing, already-approved
 *     logic rather than inventing a new operational route ordering —
 *     an explicit interpretation choice, not a new business rule.
 *   - Bicycle drivers excluded entirely if
 *     MAX_BICYCLE_PICKUP_DISTANCE_METERS is unset (fail closed — see
 *     BusinessConfigService.getMaxBicyclePickupDistanceMeters()'s own
 *     doc comment), or if their distance to the first pickup point
 *     exceeds the configured limit once it IS set.
 *   - Driver location (`lastLatitude`/`lastLongitude`) is used ONLY
 *     here, for ranking — never passed anywhere near
 *     DeliveryFeeCalculationService or any pricing path.
 *   - Eligibility: isOnline, isAvailable, verificationStatus ===
 *     APPROVED — all already-established Driver fields, nothing new.
 */
@Injectable()
export class DriverRankingService {
  private readonly logger = new Logger(DriverRankingService.name);

  constructor(
    @InjectRepository(Driver) private readonly driversRepository: Repository<Driver>,
    @InjectRepository(VendorBranch) private readonly vendorBranchesRepository: Repository<VendorBranch>,
    @Inject(MAP_PROVIDER) private readonly mapProvider: MapProvider,
    private readonly businessConfigService: BusinessConfigService,
    private readonly serviceAreaResolverService: ServiceAreaResolverService,
  ) {}

  /**
   * Returns driver IDs ranked nearest-first, ready to hand directly to
   * DeliveryAssignmentService.assignDriver() as `candidateDriverIds`.
   * Never throws for "no eligible driver" — returns an empty array,
   * letting the caller (AutomaticDispatchService) decide what to do
   * (per the confirmed no-driver-available behavior).
   *
   * PHASE I-B addition (Multi-City / Service Area, CLOSED — do not
   * reopen): ServiceArea eligibility is resolved from the SAME
   * `firstPickupPoint` already used for distance ranking — not a
   * stored `VendorBranch.serviceAreaId` and not a new driver field
   * (`driverServiceAreaId`/`driverCity` are deliberately never added,
   * per the locked decision). For a multi-vendor order, this reuses
   * the EXISTING, already-approved "only the first pickup point
   * matters for driver ranking" simplification — the same one
   * `resolveFirstPickupPoint` already applies to distance ranking.
   * This is not a new contradiction: a multi-vendor order whose
   * segments span different ServiceAreas is handled exactly as
   * consistently (or inconsistently) as the pre-existing distance
   * ranking already handled it — segment 2+'s location was already
   * irrelevant to driver selection before this chunk.
   *
   * If `firstPickupPoint` itself does not resolve to any active
   * ServiceArea, this returns an empty candidate list — the same
   * fail-closed choice already made for Discovery, not a silent
   * unfiltered fallback. See this method's own final report for the
   * operational implication.
   */
  async rankCandidates(order: Order): Promise<string[]> {
    const firstPickupPoint = await this.resolveFirstPickupPoint(order);
    if (!firstPickupPoint) {
      return [];
    }

    const pickupServiceArea = await this.serviceAreaResolverService.resolveForPoint(
      firstPickupPoint.latitude,
      firstPickupPoint.longitude,
    );
    if (!pickupServiceArea) {
      return [];
    }

    const eligibleDrivers = await this.driversRepository.find({
      where: { isOnline: true, isAvailable: true, verificationStatus: 'APPROVED' },
    });

    const maxBicycleDistanceMeters = await this.businessConfigService.getMaxBicyclePickupDistanceMeters();

    const withDistance: Array<{ driverId: string; distanceMeters: number }> = [];
    const straightLine = isMapsDisabled(this.mapProvider);
    let bicyclesExcluded = 0;
    for (const driver of eligibleDrivers) {
      if (driver.lastLatitude == null || driver.lastLongitude == null) {
        continue; // no known location — cannot rank
      }

      // ServiceArea boundary — additive, does not replace or alter the
      // distance check that follows.
      const driverServiceArea = await this.serviceAreaResolverService.resolveForPoint(
        driver.lastLatitude,
        driver.lastLongitude,
      );
      if (!driverServiceArea || driverServiceArea.id !== pickupServiceArea.id) {
        continue;
      }

      const isBicycle = await this.isBicycleDriver(driver);
      if (isBicycle && maxBicycleDistanceMeters === null) {
        continue; // fail closed — no configured limit yet, bicycles excluded entirely
      }

      let distanceMeters: number;
      if (straightLine) {
        // PD-009 G (Maps disabled): rank by straight-line distance — an ordering heuristic only, never a price or an estimate shown
        // to anyone. The bicycle limit is a ROAD-distance rule that cannot be verified without Maps, so bicycles are not auto-ranked
        // (fail closed, like an unset limit); an admin with OVERRIDE_DISPATCH can still assign one deliberately.
        if (isBicycle) {
          bicyclesExcluded++;
          continue;
        }
        distanceMeters = haversineDistanceMeters(driver.lastLatitude, driver.lastLongitude, firstPickupPoint.latitude, firstPickupPoint.longitude);
      } else {
        try {
          const result = await this.mapProvider.distanceAndEta(
            { latitude: driver.lastLatitude, longitude: driver.lastLongitude },
            firstPickupPoint,
          );
          distanceMeters = result.distanceMeters;
        } catch {
          continue; // can't compute distance for this driver — skip, don't fabricate one
        }
      }

      if (isBicycle && maxBicycleDistanceMeters !== null && distanceMeters > maxBicycleDistanceMeters) {
        continue;
      }

      withDistance.push({ driverId: driver.id, distanceMeters });
    }

    withDistance.sort((a, b) => a.distanceMeters - b.distanceMeters);
    if (straightLine) {
      this.logger.log(
        `dispatch ranking basis=STRAIGHT_LINE (Maps disabled): order ${order.id} — ${withDistance.length} candidate(s), ${bicyclesExcluded} bicycle driver(s) not auto-ranked`,
      );
    }
    return withDistance.map((d) => d.driverId);
  }

  private async isBicycleDriver(driver: Driver): Promise<boolean> {
    if (!driver.vehicleTypeId) return false;
    if (driver.vehicleType) return driver.vehicleType.isBicycle;
    // vehicleType relation wasn't eagerly loaded — fall back to a direct check.
    const loaded = await this.driversRepository.findOne({
      where: { id: driver.id },
      relations: { vehicleType: true },
    });
    return loaded?.vehicleType?.isBicycle ?? false;
  }

  /**
   * Resolves "the first pickup point" per order shape:
   *   - Multi/single-vendor CATALOG + DELIVERY: first entry of the
   *     already-frozen pricing vendor sequence (farthest-first).
   *   - CATALOG + PICKUP: the single branch's own coordinates (no
   *     sequence exists for a pickup order — nothing to reuse).
   *   - AD_HOC_SERVICE BUY_FROM_PLACE: the resolved pickup coordinate
   *     already snapshotted on the segment at order creation.
   *   - AD_HOC_SERVICE DELIVER_TO_PLACE: the customer's own delivery
   *     address — confirmed as this type's starting point since Phase
   *     3's Hatly Service location design.
   */
  private async resolveFirstPickupPoint(order: Order): Promise<GeoPoint | null> {
    const firstSegment = order.segments?.[0];
    if (!firstSegment) return null;

    if (firstSegment.groupType === CartGroupType.AD_HOC_SERVICE) {
      if (firstSegment.adHocServiceTypeSnapshot === AdHocServiceType.BUY_FROM_PLACE) {
        if (
          firstSegment.adHocPickupLatitudeSnapshot == null ||
          firstSegment.adHocPickupLongitudeSnapshot == null
        ) {
          return null;
        }
        return {
          latitude: firstSegment.adHocPickupLatitudeSnapshot,
          longitude: firstSegment.adHocPickupLongitudeSnapshot,
        };
      }
      // DELIVER_TO_PLACE — starting point is the customer's own address. PD-009: an address located only by its Delivery Zone
      // has no point to rank from; no coordinate is invented (not even the zone's representative one), so the order is left to
      // manual dispatch — the same fail-closed outcome as any other unresolvable pickup.
      const snapshot = order.deliveryAddressSnapshot;
      if (!snapshot || snapshot.latitude == null || snapshot.longitude == null) return null;
      return { latitude: snapshot.latitude, longitude: snapshot.longitude };
    }

    // CATALOG
    const breakdown = order.deliveryFeeBreakdownSnapshot as
      | { vendorSequence?: Array<{ vendorBranchId: string }> }
      | null
      | undefined;
    const firstVendorBranchId = breakdown?.vendorSequence?.[0]?.vendorBranchId ?? firstSegment.vendorBranchId;
    if (!firstVendorBranchId) return null;

    const branch = await this.vendorBranchesRepository.findOne({ where: { id: firstVendorBranchId } });
    if (!branch) return null;
    return { latitude: branch.latitude, longitude: branch.longitude };
  }

  /**
   * CONFIRMED (Phase D, decision 9): "manual override may bypass
   * normal automatic ranking/eligibility only for an Admin with the
   * appropriate OVERRIDE_DISPATCH permission." An admin without that
   * permission who names a specific driver still needs that driver to
   * pass the same ranking/eligibility filters rankCandidates() already
   * applies (bicycle-distance limit, online/available/verified, etc.)
   * — reuses that exact method rather than duplicating any filter
   * logic, just checks membership in its result.
   */
  async isDriverEligibleForOrder(order: Order, driverId: string): Promise<boolean> {
    const ranked = await this.rankCandidates(order);
    return ranked.includes(driverId);
  }
}
