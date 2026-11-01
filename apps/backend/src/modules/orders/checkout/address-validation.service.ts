import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Address } from '../../addresses/entities/address.entity';
import { isZoneServiceable } from '../../addresses/addresses.service';
import { VendorBranch } from '../../vendors/entities/vendor-branch.entity';
import { ServiceAreaResolverService } from '../../service-areas/service-area-resolver.service';
import { DeliveryZone, toDeliveryZoneSummary } from '../../delivery-zones/entities/delivery-zone.entity';
import { DeliveryAddressSnapshot } from '../entities/order.entity';
import { AddressEligibility, ResolvedDeliveryZone } from './checkout-plan';

import { AddressMode, isPointInEgypt } from '../../addresses/address-mode';

const OPTIONAL_TEXT_FIELDS = [
  'label',
  'instructions',
  'governorate',
  'city',
  'street',
  'buildingNumber',
  'floor',
  'apartment',
  'landmark',
  'formattedAddress',
] as const;

/** True when the snapshot carries a usable map pin (both coordinates, finite). */
export function hasPin(address: Pick<DeliveryAddressSnapshot, 'latitude' | 'longitude'> | null | undefined): boolean {
  return !!address && Number.isFinite(address.latitude) && Number.isFinite(address.longitude);
}

/**
 * Server-side validation of a delivery address and of whether Hatly can deliver to it. Nothing here trusts a client-supplied
 * fee, distance, zone name or "serviceable" flag.
 *
 * PD-009: an address is located EITHER by its map pin (the existing service-area radius check, distance-based fee) OR — when it
 * has no pin — by the Delivery Zone the customer selected (the zone is the serviceability boundary and its fee the base fee).
 * A selected zone that is no longer available always blocks; nothing ever falls back to another zone or location.
 */
@Injectable()
export class AddressValidationService {
  constructor(
    @InjectRepository(Address) private readonly addressesRepository: Repository<Address>,
    @InjectRepository(DeliveryZone) private readonly zonesRepository: Repository<DeliveryZone>,
    private readonly serviceAreaResolver: ServiceAreaResolverService,
  ) {}

  /** Trims, drops empty optional fields, and rejects a malformed address outright (400 INVALID_DELIVERY_ADDRESS). */
  normalize(
    input: Partial<Omit<DeliveryAddressSnapshot, 'latitude' | 'longitude' | 'deliveryZoneId' | 'deliveryZone' | 'mode'>> & {
      mode?: AddressMode | null;
      line1?: string;
      latitude?: number | null;
      longitude?: number | null;
      deliveryZoneId?: string | null;
    },
  ): DeliveryAddressSnapshot {
    const mode = input.mode ?? undefined;
    const line1 = typeof input.line1 === 'string' ? input.line1.trim() : '';
    // A GPS address is its coordinates: it needs no typed text. Every other address must describe where to deliver.
    if (mode !== AddressMode.GPS && line1.length < 1) {
      throw new BadRequestException({
        message: 'The delivery address must describe where to deliver.',
        details: { code: 'INVALID_DELIVERY_ADDRESS', field: 'line1' },
      });
    }
    const hasLat = input.latitude !== undefined && input.latitude !== null;
    const hasLng = input.longitude !== undefined && input.longitude !== null;
    if (hasLat !== hasLng || (hasLat && (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude)))) {
      throw new BadRequestException({
        message: 'The map location of the delivery address is not valid.',
        details: { code: 'INVALID_DELIVERY_ADDRESS', field: 'location' },
      });
    }
    if (mode === AddressMode.GPS && !hasLat) {
      throw new BadRequestException({
        message: 'A GPS address needs the map location.',
        details: { code: 'INVALID_DELIVERY_ADDRESS', field: 'location' },
      });
    }
    if (mode === AddressMode.MANUAL && hasLat) {
      throw new BadRequestException({
        message: 'A manually entered address does not use a map location.',
        details: { code: 'INVALID_DELIVERY_ADDRESS', field: 'location' },
      });
    }
    const snapshot: DeliveryAddressSnapshot = { line1 };
    if (mode) snapshot.mode = mode;
    if (hasLat) {
      snapshot.latitude = Number(input.latitude);
      snapshot.longitude = Number(input.longitude);
    }
    // A GPS address never carries a zone (its fee is the road distance); a stray id is dropped, not trusted.
    if (mode !== AddressMode.GPS && typeof input.deliveryZoneId === 'string' && input.deliveryZoneId.length > 0) snapshot.deliveryZoneId = input.deliveryZoneId;
    for (const field of OPTIONAL_TEXT_FIELDS) {
      const value = input[field];
      if (typeof value === 'string' && value.trim().length > 0) snapshot[field] = value.trim();
    }
    return snapshot;
  }

  /** A saved address of THIS customer (never someone else's, never a deactivated one) as an order-ready snapshot. */
  async resolveSavedAddress(customerId: string, addressId: string): Promise<DeliveryAddressSnapshot> {
    const address = await this.addressesRepository.findOne({ where: { id: addressId } });
    if (!address || address.customerId !== customerId || !address.isActive) {
      throw new NotFoundException({ message: 'Address not found.', details: { code: 'ADDRESS_NOT_FOUND' } });
    }
    return this.normalize({
      mode: address.mode ?? undefined,
      line1: address.line1,
      latitude: address.latitude,
      longitude: address.longitude,
      deliveryZoneId: address.deliveryZoneId,
      label: address.label ?? undefined,
      instructions: address.instructions ?? undefined,
      governorate: address.governorate ?? undefined,
      city: address.city ?? undefined,
      street: address.street ?? undefined,
      buildingNumber: address.buildingNumber ?? undefined,
      floor: address.floor ?? undefined,
      apartment: address.apartment ?? undefined,
      landmark: address.landmark ?? undefined,
      formattedAddress: address.formattedAddress ?? undefined,
    });
  }

  /**
   * Can every vendor branch in the cart deliver to this address? (`branches` is empty for a Hatly Service order — the same
   * address rules still apply.)
   *  1. The address's zone, when it has one, must be active (else DELIVERY_ZONE_UNAVAILABLE — no fallback).
   *  2. With a map pin: the point must be in Egypt and inside an ACTIVE service area (existing rule) → pricing DISTANCE.
   *     Without a pin: the active zone is the boundary (ADDRESS_ZONE_REQUIRED when there is none) → pricing DELIVERY_ZONE.
   *  3. Each branch must deliver and belong to that same service area (a branch with no area configured is not restricted).
   *
   * `zoneAuthoritative` (Hatly Service, PD-009 amended): the ACTIVE zone is the ONLY serviceability/pricing source — it is
   * required even when the address has a pin, and the pin's service-area radius is not consulted (a pin is still sanity-checked,
   * since a driver may use it, but it never decides serviceability or price).
   */
  async checkEligibility(
    address: DeliveryAddressSnapshot | null,
    branches: VendorBranch[],
    options: { zoneAuthoritative?: boolean } = {},
  ): Promise<AddressEligibility> {
    const vendors = (deliverable: boolean, code?: string) =>
      branches.map((b) => ({ vendorBranchId: b.id, deliverable, ...(code ? { code } : {}) }));
    const blocked = (code: string, message: string): AddressEligibility => ({
      serviceable: false,
      code,
      message,
      serviceAreaId: null,
      pricingSource: null,
      deliveryZone: null,
      vendors: vendors(false, code),
    });

    if (!address) return blocked('ADDRESS_REQUIRED', 'Choose a delivery address.');

    // GPS METHOD: the coordinates are the address. Serviceability is the existing service-area coverage; the price is the road distance
    // (never a zone fee, and never "the one zone of that area"). It is decided here, before any zone is looked at.
    if (address.mode === AddressMode.GPS) {
      if (!hasPin(address) || !isPointInEgypt(address.latitude!, address.longitude!)) {
        return blocked('INVALID_DELIVERY_LOCATION', 'The selected location is not valid.');
      }
      const gpsArea = await this.serviceAreaResolver.resolveForPoint(address.latitude!, address.longitude!);
      if (!gpsArea) return blocked('ADDRESS_OUT_OF_SERVICE_AREA', 'Hatly does not deliver to this location yet.');
      return this.finishEligibility(branches, gpsArea.id, 'DISTANCE', null);
    }

    let zone: ResolvedDeliveryZone | null = null;
    let zoneServiceAreaId: string | null = null;
    if (address.deliveryZoneId) {
      const row = await this.zonesRepository.findOne({ where: { id: address.deliveryZoneId }, relations: { serviceArea: true } });
      if (!row || !isZoneServiceable(row)) {
        return blocked('DELIVERY_ZONE_UNAVAILABLE', 'Hatly does not deliver to the selected area right now. Please choose another area.');
      }
      zone = { ...toDeliveryZoneSummary(row), deliveryFeeMinor: row.deliveryFeeMinor };
      zoneServiceAreaId = row.serviceAreaId;
    }

    let serviceAreaId: string;
    let pricingSource: 'DISTANCE' | 'DELIVERY_ZONE';
    if (hasPin(address) && !isPointInEgypt(address.latitude!, address.longitude!)) {
      return blocked('INVALID_DELIVERY_LOCATION', 'The selected location is not valid.');
    }

    // MANUAL METHOD: the selected zone is the boundary and its fixed fee the base fee — a pin (there should be none) is never priced.
    if (options.zoneAuthoritative || address.mode === AddressMode.MANUAL) {
      if (!zone) return blocked('ADDRESS_ZONE_REQUIRED', 'Choose the delivery area (zone) of this address.');
      serviceAreaId = zoneServiceAreaId!;
      pricingSource = 'DELIVERY_ZONE';
    } else if (hasPin(address)) {
      const area = await this.serviceAreaResolver.resolveForPoint(address.latitude!, address.longitude!);
      if (!area) return blocked('ADDRESS_OUT_OF_SERVICE_AREA', 'Hatly does not deliver to this location yet.');
      serviceAreaId = area.id;
      pricingSource = 'DISTANCE';
    } else {
      if (!zone) return blocked('ADDRESS_ZONE_REQUIRED', 'Choose the delivery area (zone) of this address.');
      serviceAreaId = zoneServiceAreaId!;
      pricingSource = 'DELIVERY_ZONE';
    }

    return this.finishEligibility(branches, serviceAreaId, pricingSource, zone);
  }

  /** Every vendor branch in the cart must deliver, and belong to the same service area as the address. */
  private finishEligibility(
    branches: VendorBranch[],
    serviceAreaId: string,
    pricingSource: 'DISTANCE' | 'DELIVERY_ZONE',
    zone: ResolvedDeliveryZone | null,
  ): AddressEligibility {
    const perVendor = branches.map((b) => {
      if (b.deliveryEnabled === false) return { vendorBranchId: b.id, deliverable: false, code: 'VENDOR_DOES_NOT_DELIVER' };
      if (b.serviceAreaId && b.serviceAreaId !== serviceAreaId) return { vendorBranchId: b.id, deliverable: false, code: 'VENDOR_OUTSIDE_DELIVERY_AREA' };
      return { vendorBranchId: b.id, deliverable: true };
    });
    const blockedVendor = perVendor.find((v) => !v.deliverable);
    return blockedVendor
      ? {
          serviceable: false,
          code: blockedVendor.code,
          message: 'One of the vendors in your cart cannot deliver to this location.',
          serviceAreaId,
          pricingSource,
          deliveryZone: zone,
          vendors: perVendor,
        }
      : { serviceable: true, serviceAreaId, pricingSource, deliveryZone: zone, vendors: perVendor };
  }
}
