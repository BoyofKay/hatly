import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Address } from './entities/address.entity';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { DeliveryZone, DeliveryZoneSummary, toDeliveryZoneSummary } from '../delivery-zones/entities/delivery-zone.entity';

/**
 * Where an address stands with respect to Delivery Zones (PD-009), so the app can ask the customer to (re)select one:
 *  - OK          the address has an active zone (of an active service area);
 *  - MISSING     no zone yet (an address saved before zones existed) — never guessed, the customer chooses;
 *  - UNAVAILABLE its zone was deactivated (or its service area was).
 */
export type AddressZoneStatus = 'OK' | 'MISSING' | 'UNAVAILABLE';

export interface AddressView {
  id: string;
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
  return !!zone && zone.isActive && !zone.deletedAt && zone.serviceArea?.isActive !== false;
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
  ) {}

  async create(customerId: string, dto: CreateAddressDto): Promise<Address> {
    const zone = await this.requireActiveZone(dto.deliveryZoneId);
    const pin = this.pin(dto.latitude, dto.longitude);
    // The customer's FIRST address becomes their default (checkout preselects the default when it is serviceable).
    const isDefault = dto.isDefault ?? (await this.addressesRepository.count({ where: { customerId, isActive: true } })) === 0;
    if (isDefault) await this.clearDefault(customerId);
    const saved = await this.addressesRepository.save(
      this.addressesRepository.create({
        customerId,
        label: dto.label ?? null,
        line1: dto.line1.trim(),
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
      zoneStatus: !address.deliveryZoneId ? 'MISSING' : isZoneServiceable(zone) ? 'OK' : 'UNAVAILABLE',
    };
  }

  private async requireActiveZone(id: string): Promise<DeliveryZone> {
    const zone = await this.zonesRepository.findOne({ where: { id }, relations: { serviceArea: true } });
    if (!isZoneServiceable(zone)) {
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
