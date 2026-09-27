import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Address } from './entities/address.entity';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

/**
 * CONFIRMED business decision (Checkout / Address chunk): minimum
 * complete Saved Address functionality — create/list/update/deactivate,
 * customer ownership enforced server-side throughout, matching the
 * "don't leak which case" convention already established everywhere
 * else in this codebase (a non-existent address and someone else's
 * address both surface as `NotFoundException`).
 *
 * Deliberately NOT connected to Order creation here — a Saved Address
 * is read by the customer/Checkout UI to prefill the EXISTING raw
 * `deliveryAddress` fields already accepted by `CreateOrderDto`; this
 * service never creates, mutates, or is read by `OrderCreationService`
 * itself. See Address entity's own comment for why this is what keeps
 * historical Order snapshots correctly immutable with zero other
 * changes required.
 */
@Injectable()
export class AddressesService {
  constructor(@InjectRepository(Address) private readonly addressesRepository: Repository<Address>) {}

  async create(customerId: string, dto: CreateAddressDto): Promise<Address> {
    // The customer's FIRST address becomes their default (checkout preselects the default when it is serviceable).
    const isDefault = dto.isDefault ?? (await this.addressesRepository.count({ where: { customerId, isActive: true } })) === 0;
    if (isDefault) await this.clearDefault(customerId);
    return this.addressesRepository.save(
      this.addressesRepository.create({
        customerId,
        label: dto.label ?? null,
        line1: dto.line1,
        latitude: dto.latitude,
        longitude: dto.longitude,
        instructions: dto.instructions ?? null,
        governorate: dto.governorate ?? null,
        city: dto.city ?? null,
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

  private async clearDefault(customerId: string): Promise<void> {
    await this.addressesRepository.update({ customerId, isDefault: true }, { isDefault: false });
  }

  async listForCustomer(customerId: string): Promise<Address[]> {
    return this.addressesRepository.find({
      where: { customerId, isActive: true },
      order: { createdAt: 'DESC' },
    });
  }

  async update(customerId: string, addressId: string, dto: UpdateAddressDto): Promise<Address> {
    const address = await this.getOwned(customerId, addressId);
    if (dto.label !== undefined) address.label = dto.label;
    if (dto.line1 !== undefined) address.line1 = dto.line1;
    if (dto.latitude !== undefined) address.latitude = dto.latitude;
    if (dto.longitude !== undefined) address.longitude = dto.longitude;
    if (dto.instructions !== undefined) address.instructions = dto.instructions;
    if (dto.governorate !== undefined) address.governorate = dto.governorate;
    if (dto.city !== undefined) address.city = dto.city;
    if (dto.street !== undefined) address.street = dto.street;
    if (dto.buildingNumber !== undefined) address.buildingNumber = dto.buildingNumber;
    if (dto.floor !== undefined) address.floor = dto.floor;
    if (dto.apartment !== undefined) address.apartment = dto.apartment;
    if (dto.landmark !== undefined) address.landmark = dto.landmark;
    if (dto.formattedAddress !== undefined) address.formattedAddress = dto.formattedAddress;
    if (dto.isDefault !== undefined) {
      if (dto.isDefault) await this.clearDefault(customerId);
      address.isDefault = dto.isDefault;
    }
    return this.addressesRepository.save(address);
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

  private async getOwned(customerId: string, addressId: string): Promise<Address> {
    const address = await this.addressesRepository.findOne({ where: { id: addressId } });
    if (!address || address.customerId !== customerId) {
      throw new NotFoundException('Address not found.');
    }
    return address;
  }
}
