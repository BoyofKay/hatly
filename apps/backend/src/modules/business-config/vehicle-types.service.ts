import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VehicleType } from './entities/vehicle-type.entity';
import { CreateVehicleTypeDto, UpdateVehicleTypeDto } from './dto/vehicle-type.dto';

/**
 * Plain CRUD only — no capacity enforcement, no dispatch integration.
 * `maxActiveDeliveries` is stored but not read by anything yet; the
 * Route/RouteStop + dispatch-engine rework (a later approved phase)
 * is what will actually consume it.
 */
@Injectable()
export class VehicleTypesService {
  constructor(
    @InjectRepository(VehicleType)
    private readonly repo: Repository<VehicleType>,
  ) {}

  async list(includeInactive = false): Promise<VehicleType[]> {
    if (includeInactive) {
      return this.repo.find({ order: { name: 'ASC' } });
    }
    return this.repo.find({ where: { isActive: true }, order: { name: 'ASC' } });
  }

  async findById(id: string): Promise<VehicleType | null> {
    return this.repo.findOne({ where: { id } });
  }

  async create(dto: CreateVehicleTypeDto): Promise<VehicleType> {
    return this.repo.save(this.repo.create(dto));
  }

  async update(id: string, dto: UpdateVehicleTypeDto): Promise<VehicleType> {
    const existing = await this.repo.findOne({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Vehicle type not found.');
    }
    Object.assign(existing, dto);
    return this.repo.save(existing);
  }
}
