import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Vendor } from './entities/vendor.entity';
import { VendorBranch } from './entities/vendor-branch.entity';
import { ServiceArea } from '../service-areas/entities/service-area.entity';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { UpdateVendorDto } from './dto/update-vendor.dto';
import { CreateVendorBranchDto } from './dto/create-vendor-branch.dto';
import { UpdateVendorBranchDto } from './dto/update-vendor-branch.dto';

/**
 * CONFIRMED business decisions (Phase I-A, Chunk 1 — do not reopen):
 * Vendor and VendorBranch creation are two explicit operations (a
 * Vendor may temporarily exist with zero branches); every newly
 * created Vendor/VendorBranch starts `isActive: false` — Admin must
 * explicitly activate via the dedicated endpoints below; no separate
 * Draft status was invented, `isActive` alone carries this.
 * `Vendor.category`/`commissionPercent` are never read or written
 * here — both remain untouched legacy columns. Sector assignment
 * stays on its own existing, untouched endpoint
 * (`PATCH admin/vendor-branches/:id/sector`), not duplicated here.
 */
@Injectable()
export class AdminVendorsService {
  constructor(
    @InjectRepository(Vendor) private readonly vendorsRepository: Repository<Vendor>,
    @InjectRepository(VendorBranch) private readonly branchesRepository: Repository<VendorBranch>,
    @InjectRepository(ServiceArea) private readonly serviceAreasRepository: Repository<ServiceArea>,
  ) {}

  async createVendor(dto: CreateVendorDto): Promise<Vendor> {
    return this.vendorsRepository.save(
      this.vendorsRepository.create({
        name: dto.name,
        nameAr: dto.nameAr ?? null,
        logoUrl: dto.logoUrl ?? null,
        isActive: false,
      }),
    );
  }

  async listVendors(): Promise<Vendor[]> {
    return this.vendorsRepository.find({ order: { createdAt: 'DESC' } });
  }

  async getVendor(id: string): Promise<Vendor> {
    const vendor = await this.vendorsRepository.findOne({ where: { id } });
    if (!vendor) {
      throw new NotFoundException('Vendor not found.');
    }
    return vendor;
  }

  async updateVendor(id: string, dto: UpdateVendorDto): Promise<Vendor> {
    const vendor = await this.getVendor(id);
    if (dto.name !== undefined) vendor.name = dto.name;
    if (dto.nameAr !== undefined) vendor.nameAr = dto.nameAr;
    if (dto.logoUrl !== undefined) vendor.logoUrl = dto.logoUrl;
    return this.vendorsRepository.save(vendor);
  }

  async activateVendor(id: string): Promise<Vendor> {
    const vendor = await this.getVendor(id);
    vendor.isActive = true;
    return this.vendorsRepository.save(vendor);
  }

  async deactivateVendor(id: string): Promise<Vendor> {
    const vendor = await this.getVendor(id);
    vendor.isActive = false;
    return this.vendorsRepository.save(vendor);
  }

  async createVendorBranch(dto: CreateVendorBranchDto): Promise<VendorBranch> {
    const vendor = await this.vendorsRepository.findOne({ where: { id: dto.vendorId } });
    if (!vendor) {
      throw new BadRequestException({
        message: 'The specified Vendor does not exist.',
        details: { code: 'VENDOR_NOT_FOUND' },
      });
    }

    return this.branchesRepository.save(
      this.branchesRepository.create({
        vendorId: dto.vendorId,
        name: dto.name,
        address: dto.address,
        latitude: dto.latitude,
        longitude: dto.longitude,
        serviceAreaId: dto.serviceAreaId ?? null,
        openingHours: dto.openingHours ?? {},
        deliveryEnabled: dto.deliveryEnabled ?? true,
        pickupEnabled: dto.pickupEnabled ?? true,
        commissionRateBasisPoints: dto.commissionRateBasisPoints ?? null,
        isActive: false,
        isOpen: false,
      }),
    );
  }

  async listVendorBranches(vendorId?: string): Promise<VendorBranch[]> {
    return this.branchesRepository.find({
      where: vendorId ? { vendorId } : {},
      order: { createdAt: 'DESC' },
    });
  }

  async getVendorBranch(id: string): Promise<VendorBranch> {
    const branch = await this.branchesRepository.findOne({ where: { id } });
    if (!branch) {
      throw new NotFoundException('Vendor branch not found.');
    }
    return branch;
  }

  async updateVendorBranch(id: string, dto: UpdateVendorBranchDto): Promise<VendorBranch> {
    const branch = await this.getVendorBranch(id);
    if (dto.name !== undefined) branch.name = dto.name;
    if (dto.address !== undefined) branch.address = dto.address;
    if (dto.latitude !== undefined) branch.latitude = dto.latitude;
    if (dto.longitude !== undefined) branch.longitude = dto.longitude;
    if (dto.openingHours !== undefined) branch.openingHours = dto.openingHours;
    if (dto.deliveryEnabled !== undefined) branch.deliveryEnabled = dto.deliveryEnabled;
    if (dto.pickupEnabled !== undefined) branch.pickupEnabled = dto.pickupEnabled;
    if (dto.preparationTimeMinutes !== undefined) {
      branch.preparationTimeMinutes = dto.preparationTimeMinutes;
    }
    if (dto.commissionRateBasisPoints !== undefined) {
      branch.commissionRateBasisPoints = dto.commissionRateBasisPoints;
    }
    if (dto.serviceAreaId !== undefined) {
      const serviceArea = await this.serviceAreasRepository.findOne({ where: { id: dto.serviceAreaId } });
      if (!serviceArea || !serviceArea.isActive) {
        throw new BadRequestException({
          message: 'The specified ServiceArea does not exist or is not active.',
          details: { code: 'SERVICE_AREA_NOT_ACTIVE' },
        });
      }
      branch.serviceAreaId = dto.serviceAreaId;
    }
    return this.branchesRepository.save(branch);
  }

  async activateVendorBranch(id: string): Promise<VendorBranch> {
    const branch = await this.getVendorBranch(id);
    branch.isActive = true;
    return this.branchesRepository.save(branch);
  }

  async deactivateVendorBranch(id: string): Promise<VendorBranch> {
    const branch = await this.getVendorBranch(id);
    branch.isActive = false;
    return this.branchesRepository.save(branch);
  }
}
