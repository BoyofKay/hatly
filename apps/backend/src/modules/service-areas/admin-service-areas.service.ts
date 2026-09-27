import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ServiceArea } from './entities/service-area.entity';
import { CreateServiceAreaDto } from './dto/create-service-area.dto';
import { UpdateServiceAreaDto } from './dto/update-service-area.dto';

@Injectable()
export class AdminServiceAreasService {
  constructor(@InjectRepository(ServiceArea) private readonly serviceAreasRepository: Repository<ServiceArea>) {}

  async create(dto: CreateServiceAreaDto): Promise<ServiceArea> {
    return this.serviceAreasRepository.save(
      this.serviceAreasRepository.create({
        name: dto.name,
        nameAr: dto.nameAr ?? null,
        centerLatitude: dto.centerLatitude,
        centerLongitude: dto.centerLongitude,
        radiusMeters: dto.radiusMeters,
        isActive: true,
      }),
    );
  }

  async listAll(): Promise<ServiceArea[]> {
    return this.serviceAreasRepository.find({ order: { createdAt: 'DESC' } });
  }

  async getOne(id: string): Promise<ServiceArea> {
    const area = await this.serviceAreasRepository.findOne({ where: { id } });
    if (!area) {
      throw new NotFoundException('Service area not found.');
    }
    return area;
  }

  async update(id: string, dto: UpdateServiceAreaDto): Promise<ServiceArea> {
    const area = await this.getOne(id);
    if (dto.name !== undefined) area.name = dto.name;
    if (dto.nameAr !== undefined) area.nameAr = dto.nameAr;
    if (dto.centerLatitude !== undefined) area.centerLatitude = dto.centerLatitude;
    if (dto.centerLongitude !== undefined) area.centerLongitude = dto.centerLongitude;
    if (dto.radiusMeters !== undefined) area.radiusMeters = dto.radiusMeters;
    return this.serviceAreasRepository.save(area);
  }

  async activate(id: string): Promise<ServiceArea> {
    const area = await this.getOne(id);
    area.isActive = true;
    return this.serviceAreasRepository.save(area);
  }

  /** Prefer safe deactivation over destructive deletion — matches the established Sector/Vendor convention. A branch pointed at a since-deactivated area keeps its FK exactly as-is, never nulled. */
  async deactivate(id: string): Promise<ServiceArea> {
    const area = await this.getOne(id);
    area.isActive = false;
    return this.serviceAreasRepository.save(area);
  }
}
