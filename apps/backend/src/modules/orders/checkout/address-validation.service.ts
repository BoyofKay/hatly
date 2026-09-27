import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Address } from '../../addresses/entities/address.entity';
import { VendorBranch } from '../../vendors/entities/vendor-branch.entity';
import { ServiceAreaResolverService } from '../../service-areas/service-area-resolver.service';
import { DeliveryAddressSnapshot } from '../entities/order.entity';
import { AddressEligibility } from './checkout-plan';

// A coarse sanity box around Egypt: catches swapped or nonsensical coordinates. Serviceability is the SERVICE AREA's job.
const EGYPT_LAT = { min: 21.9, max: 31.7 };
const EGYPT_LNG = { min: 24.6, max: 36.9 };

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

/**
 * Server-side validation of a delivery address and of whether Hatly can deliver to it. The coordinates are the
 * authoritative location; the written details are what the customer typed; `formattedAddress` is only the map provider's
 * suggestion. Nothing here trusts a client-supplied fee, distance or "serviceable" flag.
 */
@Injectable()
export class AddressValidationService {
  constructor(
    @InjectRepository(Address) private readonly addressesRepository: Repository<Address>,
    private readonly serviceAreaResolver: ServiceAreaResolverService,
  ) {}

  /** Trims, drops empty optional fields, and rejects a malformed address outright (400 INVALID_DELIVERY_ADDRESS). */
  normalize(input: Partial<DeliveryAddressSnapshot> & { line1?: string; latitude?: number; longitude?: number }): DeliveryAddressSnapshot {
    const line1 = typeof input.line1 === 'string' ? input.line1.trim() : '';
    if (line1.length < 1) {
      throw new BadRequestException({
        message: 'The delivery address must describe where to deliver.',
        details: { code: 'INVALID_DELIVERY_ADDRESS', field: 'line1' },
      });
    }
    if (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude)) {
      throw new BadRequestException({
        message: 'The delivery address needs a location on the map.',
        details: { code: 'INVALID_DELIVERY_ADDRESS', field: 'location' },
      });
    }
    const snapshot: DeliveryAddressSnapshot = { line1, latitude: Number(input.latitude), longitude: Number(input.longitude) };
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
      line1: address.line1,
      latitude: address.latitude,
      longitude: address.longitude,
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
   * Can every vendor branch in the cart deliver to this point? The point must fall inside an ACTIVE service area, and each
   * branch must have delivery enabled and belong to that same service area (a branch with no area configured is not
   * area-restricted). `address` null = the customer has not chosen one yet.
   */
  async checkEligibility(address: DeliveryAddressSnapshot | null, branches: VendorBranch[]): Promise<AddressEligibility> {
    const vendors = (deliverable: boolean, code?: string) =>
      branches.map((b) => ({ vendorBranchId: b.id, deliverable, ...(code ? { code } : {}) }));

    if (!address) {
      return { serviceable: false, code: 'ADDRESS_REQUIRED', message: 'Choose a delivery address.', serviceAreaId: null, vendors: vendors(false, 'ADDRESS_REQUIRED') };
    }
    const inEgypt =
      address.latitude >= EGYPT_LAT.min && address.latitude <= EGYPT_LAT.max && address.longitude >= EGYPT_LNG.min && address.longitude <= EGYPT_LNG.max;
    if (!inEgypt) {
      return { serviceable: false, code: 'INVALID_DELIVERY_LOCATION', message: 'The selected location is not valid.', serviceAreaId: null, vendors: vendors(false, 'INVALID_DELIVERY_LOCATION') };
    }

    const area = await this.serviceAreaResolver.resolveForPoint(address.latitude, address.longitude);
    if (!area) {
      return { serviceable: false, code: 'ADDRESS_OUT_OF_SERVICE_AREA', message: 'Hatly does not deliver to this location yet.', serviceAreaId: null, vendors: vendors(false, 'ADDRESS_OUT_OF_SERVICE_AREA') };
    }

    const perVendor = branches.map((b) => {
      if (b.deliveryEnabled === false) return { vendorBranchId: b.id, deliverable: false, code: 'VENDOR_DOES_NOT_DELIVER' };
      if (b.serviceAreaId && b.serviceAreaId !== area.id) return { vendorBranchId: b.id, deliverable: false, code: 'VENDOR_OUTSIDE_DELIVERY_AREA' };
      return { vendorBranchId: b.id, deliverable: true };
    });
    const blocked = perVendor.find((v) => !v.deliverable);
    return blocked
      ? { serviceable: false, code: blocked.code, message: 'One of the vendors in your cart cannot deliver to this location.', serviceAreaId: area.id, vendors: perVendor }
      : { serviceable: true, serviceAreaId: area.id, vendors: perVendor };
  }
}
