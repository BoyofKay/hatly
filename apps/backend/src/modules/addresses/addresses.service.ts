import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Address } from './entities/address.entity';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { DeliveryZone, DeliveryZoneSummary, toDeliveryZoneSummary } from '../delivery-zones/entities/delivery-zone.entity';
import { ServiceArea } from '../service-areas/entities/service-area.entity';
import { ServiceAreaResolverService } from '../service-areas/service-area-resolver.service';
import { DeliveryFeeCalculationService } from '../delivery-fee/delivery-fee-calculation.service';
import { BusinessConfigService } from '../business-config/business-config.service';
import { BusinessConfigKey } from '../business-config/business-config-key.enum';
import { AddressMode, isPointInEgypt } from './address-mode';

/**
 * Where an address stands with respect to Delivery Zones (PD-009), so the app can ask the customer to (re)select one:
 *  - OK          the address has an active zone (of an active service area);
 *  - MISSING     no zone yet (an address saved before zones existed) — never guessed, the customer chooses;
 *  - UNAVAILABLE its zone was deactivated (or its service area was).
 */
export type AddressZoneStatus = 'OK' | 'MISSING' | 'UNAVAILABLE';

/** What the customer app may offer when adding an address (GET /addresses/capabilities). */
export interface AddressCapabilities {
  manual: { available: boolean };
  gps: { available: boolean; reason: 'MAPS_DISABLED' | 'PRICING_NOT_CONFIGURED' | 'NO_SERVICE_AREA' | null };
}

export interface AddressView {
  id: string;
  /** null = a legacy address saved before the two methods existed. */
  mode: AddressMode | null;
  label: string | null;
  line1: string;
  latitude: number | null;
  longitude: number | null;
  instructions: string | null;
  governorate: string | null;
  city: string | null;
  street: string | null;
  buildingNumber: string | null;
  floor: string | null;
  apartment: string | null;
  landmark: string | null;
  formattedAddress: string | null;
  isDefault: boolean;
  deliveryZoneId: string | null;
  deliveryZone: DeliveryZoneSummary | null;
  zoneStatus: AddressZoneStatus;
}

/** Fields an update may change on a zone-less legacy address without having to choose a zone first. */
const ZONELESS_EDITABLE_FIELDS = new Set(['isDefault', 'label']);

export function isZoneServiceable(zone: DeliveryZone | null | undefined): boolean {
  return !!zone && zone.isActive && zone.parentIsActive && zone.isSelectable && !zone.deletedAt && zone.serviceArea?.isActive !== false;
}

/**
 * CONFIRMED business decision (Checkout / Address chunk): minimum
 * complete Saved Address functionality — create/list/update/deactivate,
 * customer ownership enforced server-side throughout, matching the
 * "don't leak which case" convention already established everywhere
 * else in this codebase (a non-existent address and someone else's
 * address both surface as `NotFoundException`).
 *
 * PD-009: every new/edited address carries the Delivery Zone the customer selected (validated active here); governorate and
 * city are derived from that zone so they can never contradict it. The map pin is optional (a pair).
 *
 * Deliberately NOT connected to Order creation here — the checkout turns a saved address into an immutable snapshot (see
 * AddressValidationService); editing/deleting an address never changes a historical order.
 */
@Injectable()
export class AddressesService {
  constructor(
    @InjectRepository(Address) private readonly addressesRepository: Repository<Address>,
    @InjectRepository(DeliveryZone) private readonly zonesRepository: Repository<DeliveryZone>,
    @InjectRepository(ServiceArea) private readonly serviceAreasRepository: Repository<ServiceArea>,
    private readonly serviceAreaResolver: ServiceAreaResolverService,
    private readonly deliveryFeeCalculation: DeliveryFeeCalculationService,
    private readonly businessConfig: BusinessConfigService,
  ) {}

  /**
   * Which of the two address methods can be used right now. GPS needs the road-distance provider (Maps) AND the Admin pricing values
   * AND at least one active service area — otherwise it is reported unavailable (never silently priced another way). MANUAL needs at
   * least one active delivery zone.
   */
  async capabilities(): Promise<AddressCapabilities> {
    const zones = await this.zonesRepository.find({ where: { isActive: true, isSelectable: true, parentIsActive: true }, relations: { serviceArea: true } });
    const manualAvailable = zones.some((z) => isZoneServiceable(z));
    let reason: AddressCapabilities['gps']['reason'] = null;
    if (!this.deliveryFeeCalculation.roadDistancePricingAvailable) {
      reason = 'MAPS_DISABLED';
    } else {
      const rate = await this.businessConfig.get<number | null>(BusinessConfigKey.REGISTERED_VENDOR_PRICE_PER_100M_MINOR, null);
      const minimum = await this.businessConfig.get<number | null>(BusinessConfigKey.REGISTERED_VENDOR_MINIMUM_DELIVERY_FEE_MINOR, null);
      if (rate == null || minimum == null) reason = 'PRICING_NOT_CONFIGURED';
      else if ((await this.serviceAreasRepository.count({ where: { isActive: true } })) === 0) reason = 'NO_SERVICE_AREA';
    }
    return { manual: { available: manualAvailable }, gps: { available: reason === null, reason } };
  }

  async create(customerId: string, dto: CreateAddressDto): Promise<Address> {
    if (dto.mode === AddressMode.GPS) return this.createGps(customerId, dto);
    if (dto.mode === AddressMode.MANUAL) this.rejectCoordinatesForManual(dto.latitude, dto.longitude);
    const zone = await this.requireActiveZone(dto.deliveryZoneId!);
    const pin = dto.mode === AddressMode.MANUAL ? { latitude: null, longitude: null } : this.pin(dto.latitude, dto.longitude);
    // The customer's FIRST address becomes their default (checkout preselects the default when it is serviceable).
    const isDefault = dto.isDefault ?? (await this.addressesRepository.count({ where: { customerId, isActive: true } })) === 0;
    if (isDefault) await this.clearDefault(customerId);
    const saved = await this.addressesRepository.save(
      this.addressesRepository.create({
        customerId,
        mode: dto.mode ?? null,
        label: dto.label ?? null,
        line1: dto.line1!.trim(),
        latitude: pin.latitude,
        longitude: pin.longitude,
        instructions: dto.instructions ?? null,
        deliveryZoneId: zone.id,
        governorate: zone.governorateAr,
        city: zone.cityAr,
        street: dto.street ?? null,
        buildingNumber: dto.buildingNumber ?? null,
        floor: dto.floor ?? null,
        apartment: dto.apartment ?? null,
        landmark: dto.landmark ?? null,
        formattedAddress: dto.formattedAddress ?? null,
        isDefault,
        isActive: true,
      }),
    );
    saved.deliveryZone = zone;
    return saved;
  }

  /**
   * GPS method: the coordinates ARE the address. No zone, no typed text. The point must be a valid location inside the existing
   * service-area coverage, and the road-distance provider must be available — otherwise the customer is told so, and nothing is saved.
   */
  private async createGps(customerId: string, dto: CreateAddressDto): Promise<Address> {
    if (dto.deliveryZoneId) {
      throw new BadRequestException({
        message: 'A GPS address does not use a delivery area. Choose the manual method to select one.',
        details: { code: 'INVALID_DELIVERY_ADDRESS', field: 'deliveryZoneId' },
      });
    }
    const pin = await this.requireGpsPoint(dto.latitude, dto.longitude);
    const isDefault = dto.isDefault ?? (await this.addressesRepository.count({ where: { customerId, isActive: true } })) === 0;
    if (isDefault) await this.clearDefault(customerId);
    return this.addressesRepository.save(
      this.addressesRepository.create({
        customerId,
        mode: AddressMode.GPS,
        label: dto.label ?? null,
        line1: dto.line1?.trim() ?? '',
        latitude: pin.latitude,
        longitude: pin.longitude,
        instructions: dto.instructions ?? null,
        deliveryZoneId: null,
        governorate: null,
        city: null,
        street: dto.street ?? null,
        buildingNumber: dto.buildingNumber ?? null,
        floor: dto.floor ?? null,
        apartment: dto.apartment ?? null,
        landmark: dto.landmark ?? null,
        formattedAddress: dto.formattedAddress ?? null,
        isDefault,
        isActive: true,
      }),
    );
  }

  /** A GPS point must be complete, plausible, deliverable by road-distance pricing, and inside configured service-area coverage. */
  private async requireGpsPoint(
    latitude: number | null | undefined,
    longitude: number | null | undefined,
  ): Promise<{ latitude: number; longitude: number }> {
    if (latitude === undefined || latitude === null || longitude === undefined || longitude === null) {
      throw new BadRequestException({
        message: 'Your location could not be read. Allow location access and try again.',
        details: { code: 'INVALID_DELIVERY_ADDRESS', field: 'location' },
      });
    }
    if (!isPointInEgypt(latitude, longitude)) {
      throw new BadRequestException({
        message: 'The selected location is not valid.',
        details: { code: 'INVALID_DELIVERY_LOCATION', field: 'location' },
      });
    }
    if (!this.deliveryFeeCalculation.roadDistancePricingAvailable) {
      throw new BadRequestException({
        message: 'Delivery to a GPS location is not available right now. Please enter your address manually instead.',
        details: { code: 'DISTANCE_PRICING_UNAVAILABLE', field: 'mode' },
      });
    }
    if (!(await this.serviceAreaResolver.resolveForPoint(latitude, longitude))) {
      throw new BadRequestException({
        message: 'Hatly does not deliver to this location yet.',
        details: { code: 'ADDRESS_OUT_OF_SERVICE_AREA', field: 'location' },
      });
    }
    return { latitude, longitude };
  }

  private rejectCoordinatesForManual(latitude: number | null | undefined, longitude: number | null | undefined): void {
    if ((latitude !== undefined && latitude !== null) || (longitude !== undefined && longitude !== null)) {
      throw new BadRequestException({
        message: 'A manually entered address does not use a map location. Choose the GPS method to share one.',
        details: { code: 'INVALID_DELIVERY_ADDRESS', field: 'location' },
      });
    }
  }

  private async clearDefault(customerId: string): Promise<void> {
    await this.addressesRepository.update({ customerId, isDefault: true }, { isDefault: false });
  }

  async listForCustomer(customerId: string): Promise<Address[]> {
    return this.addressesRepository.find({
      where: { customerId, isActive: true },
      relations: { deliveryZone: { serviceArea: true } },
      order: { createdAt: 'DESC' },
    });
  }

  async update(customerId: string, addressId: string, dto: UpdateAddressDto): Promise<Address> {
    const address = await this.getOwned(customerId, addressId);

    // An explicit method switch (or the first mode of a legacy address): the other method's fields are cleared, never mixed.
    if (dto.mode !== undefined && dto.mode !== address.mode) return this.switchMode(customerId, address, dto);
    if (address.mode === AddressMode.GPS) return this.updateGps(customerId, address, dto);
    if (address.mode === AddressMode.MANUAL) this.rejectCoordinatesForManual(dto.latitude, dto.longitude);

    let zone: DeliveryZone | null = address.deliveryZone ?? null;
    if (dto.deliveryZoneId !== undefined && dto.deliveryZoneId !== address.deliveryZoneId) {
      zone = await this.requireActiveZone(dto.deliveryZoneId);
      address.deliveryZoneId = zone.id;
      address.deliveryZone = zone;
    }
    if (!address.deliveryZoneId) {
      const touched = Object.keys(dto).filter((k) => (dto as Record<string, unknown>)[k] !== undefined);
      if (touched.some((k) => !ZONELESS_EDITABLE_FIELDS.has(k))) {
        throw new BadRequestException({
          message: 'Choose the delivery area (zone) of this address.',
          details: { code: 'ADDRESS_ZONE_REQUIRED', field: 'deliveryZoneId' },
        });
      }
    }

    if (dto.latitude !== undefined || dto.longitude !== undefined) {
      const pin = this.pin(dto.latitude, dto.longitude);
      address.latitude = pin.latitude;
      address.longitude = pin.longitude;
    }
    if (dto.label !== undefined) address.label = dto.label;
    if (dto.line1 !== undefined) address.line1 = dto.line1.trim();
    if (dto.instructions !== undefined) address.instructions = dto.instructions;
    if (dto.street !== undefined) address.street = dto.street;
    if (dto.buildingNumber !== undefined) address.buildingNumber = dto.buildingNumber;
    if (dto.floor !== undefined) address.floor = dto.floor;
    if (dto.apartment !== undefined) address.apartment = dto.apartment;
    if (dto.landmark !== undefined) address.landmark = dto.landmark;
    if (dto.formattedAddress !== undefined) address.formattedAddress = dto.formattedAddress;
    if (zone) {
      // Derived from the zone, never free-typed against it.
      address.governorate = zone.governorateAr;
      address.city = zone.cityAr;
    } else {
      if (dto.governorate !== undefined) address.governorate = dto.governorate;
      if (dto.city !== undefined) address.city = dto.city;
    }
    if (dto.isDefault !== undefined) {
      if (dto.isDefault) await this.clearDefault(customerId);
      address.isDefault = dto.isDefault;
    }
    const saved = await this.addressesRepository.save(address);
    saved.deliveryZone = zone;
    return saved;
  }

  /** Editing a GPS address: the point (when changed), details and default flag. A zone or a typed address belongs to the other method. */
  private async updateGps(customerId: string, address: Address, dto: UpdateAddressDto): Promise<Address> {
    if (dto.deliveryZoneId !== undefined) {
      throw new BadRequestException({
        message: 'A GPS address does not use a delivery area. Switch to the manual method to select one.',
        details: { code: 'INVALID_DELIVERY_ADDRESS', field: 'deliveryZoneId' },
      });
    }
    if (dto.latitude !== undefined || dto.longitude !== undefined) {
      const pin = await this.requireGpsPoint(dto.latitude, dto.longitude);
      address.latitude = pin.latitude;
      address.longitude = pin.longitude;
    }
    this.applyDetails(address, dto);
    if (dto.line1 !== undefined) address.line1 = dto.line1.trim();
    return this.saveWithDefault(customerId, address, dto.isDefault, null);
  }

  /**
   * Explicit switch between the two methods. What the target method does not use is CLEARED (a typed address, zone and area names
   * when going to GPS; the coordinates and the map suggestion when going to MANUAL), so the two pricing methods can never mix.
   */
  private async switchMode(customerId: string, address: Address, dto: UpdateAddressDto): Promise<Address> {
    let zone: DeliveryZone | null = null;
    if (dto.mode === AddressMode.GPS) {
      if (dto.deliveryZoneId) {
        throw new BadRequestException({
          message: 'A GPS address does not use a delivery area.',
          details: { code: 'INVALID_DELIVERY_ADDRESS', field: 'deliveryZoneId' },
        });
      }
      const pin = await this.requireGpsPoint(dto.latitude, dto.longitude);
      address.mode = AddressMode.GPS;
      address.latitude = pin.latitude;
      address.longitude = pin.longitude;
      address.deliveryZoneId = null;
      address.deliveryZone = undefined;
      address.governorate = null;
      address.city = null;
      address.line1 = dto.line1?.trim() ?? '';
      address.street = null;
      address.buildingNumber = null;
      address.floor = null;
      address.apartment = null;
      address.landmark = null;
      address.formattedAddress = dto.formattedAddress ?? null;
    } else {
      this.rejectCoordinatesForManual(dto.latitude, dto.longitude);
      if (!dto.deliveryZoneId) {
        throw new BadRequestException({
          message: 'Choose the delivery area (zone) of this address.',
          details: { code: 'ADDRESS_ZONE_REQUIRED', field: 'deliveryZoneId' },
        });
      }
      if (!dto.line1 || dto.line1.trim().length === 0) {
        throw new BadRequestException({
          message: 'The delivery address must describe where to deliver.',
          details: { code: 'INVALID_DELIVERY_ADDRESS', field: 'line1' },
        });
      }
      zone = await this.requireActiveZone(dto.deliveryZoneId);
      address.mode = AddressMode.MANUAL;
      address.latitude = null;
      address.longitude = null;
      address.formattedAddress = null;
      address.deliveryZoneId = zone.id;
      address.deliveryZone = zone;
      address.governorate = zone.governorateAr;
      address.city = zone.cityAr;
      address.line1 = dto.line1.trim();
    }
    this.applyDetails(address, dto);
    return this.saveWithDefault(customerId, address, dto.isDefault, zone);
  }

  /** The optional detail fields shared by both methods (label, notes, building / floor / apartment / landmark). */
  private applyDetails(address: Address, dto: UpdateAddressDto): void {
    if (dto.label !== undefined) address.label = dto.label;
    if (dto.instructions !== undefined) address.instructions = dto.instructions;
    if (dto.street !== undefined) address.street = dto.street;
    if (dto.buildingNumber !== undefined) address.buildingNumber = dto.buildingNumber;
    if (dto.floor !== undefined) address.floor = dto.floor;
    if (dto.apartment !== undefined) address.apartment = dto.apartment;
    if (dto.landmark !== undefined) address.landmark = dto.landmark;
  }

  private async saveWithDefault(customerId: string, address: Address, isDefault: boolean | undefined, zone: DeliveryZone | null): Promise<Address> {
    if (isDefault !== undefined) {
      if (isDefault) await this.clearDefault(customerId);
      address.isDefault = isDefault;
    }
    const saved = await this.addressesRepository.save(address);
    saved.deliveryZone = zone ?? undefined;
    return saved;
  }

  /**
   * Soft-deactivation, not a hard delete — matches "prefer safe
   * deactivation over destructive deletion" already used elsewhere in
   * this codebase (e.g. MarketplaceSector). A deactivated address
   * simply stops appearing in `listForCustomer`; it never retroactively
   * touches any Order that previously used its values as a snapshot.
   */
  async deactivate(customerId: string, addressId: string): Promise<Address> {
    const address = await this.getOwned(customerId, addressId);
    address.isActive = false;
    address.isDefault = false;
    return this.addressesRepository.save(address);
  }

  /** The customer-facing shape: the zone as names (never admin metadata) plus whether it can be delivered to. */
  toView(address: Address): AddressView {
    const zone = address.deliveryZone ?? null;
    return {
      id: address.id,
      mode: address.mode ?? null,
      label: address.label ?? null,
      line1: address.line1,
      latitude: address.latitude ?? null,
      longitude: address.longitude ?? null,
      instructions: address.instructions ?? null,
      governorate: address.governorate ?? null,
      city: address.city ?? null,
      street: address.street ?? null,
      buildingNumber: address.buildingNumber ?? null,
      floor: address.floor ?? null,
      apartment: address.apartment ?? null,
      landmark: address.landmark ?? null,
      formattedAddress: address.formattedAddress ?? null,
      isDefault: address.isDefault,
      deliveryZoneId: address.deliveryZoneId ?? null,
      deliveryZone: zone ? toDeliveryZoneSummary(zone) : null,
      // A GPS address has no zone by design, so there is nothing for the customer to (re)select.
      zoneStatus: address.mode === AddressMode.GPS ? 'OK' : !address.deliveryZoneId ? 'MISSING' : isZoneServiceable(zone) ? 'OK' : 'UNAVAILABLE',
    };
  }

  private async requireActiveZone(id: string): Promise<DeliveryZone> {
    const zone = await this.zonesRepository.findOne({ where: { id }, relations: { serviceArea: true } });
    if (!isZoneServiceable(zone) || zone?.isSelectable === false) {
      throw new BadRequestException({
        message: 'This delivery area is not available. Please choose another one.',
        details: { code: 'DELIVERY_ZONE_UNAVAILABLE', field: 'deliveryZoneId' },
      });
    }
    return zone!;
  }

  /** Both or neither — a half pin is refused, and nothing is ever invented. */
  private pin(latitude: number | null | undefined, longitude: number | null | undefined): { latitude: number | null; longitude: number | null } {
    const hasLat = latitude !== undefined && latitude !== null;
    const hasLng = longitude !== undefined && longitude !== null;
    if (hasLat !== hasLng) {
      throw new BadRequestException({
        message: 'The map location needs both latitude and longitude.',
        details: { code: 'INVALID_DELIVERY_ADDRESS', field: 'location' },
      });
    }
    return { latitude: hasLat ? latitude! : null, longitude: hasLng ? longitude! : null };
  }

  private async getOwned(customerId: string, addressId: string): Promise<Address> {
    const address = await this.addressesRepository.findOne({
      where: { id: addressId },
      relations: { deliveryZone: { serviceArea: true } },
    });
    if (!address || address.customerId !== customerId) {
      throw new NotFoundException('Address not found.');
    }
    return address;
  }
}
