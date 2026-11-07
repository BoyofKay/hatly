import { recomputeDriversOfVehicleType } from '../delivery/driver-capacity';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VehicleType } from './entities/vehicle-type.entity';
import { CreateVehicleTypeDto, UpdateVehicleTypeDto } from './dto/vehicle-type.dto';

/**
 * Plain CRUD. R18: `maxActiveDeliveries` is the capacity of every driver
 * on the type; changing it recomputes their availability (driver-capacity.ts).
 * (Historical note:) the Route/RouteStop + dispatch-engine rework (a later approved phase)
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
    const saved = await this.repo.save(existing);
    // R18: max_active_deliveries is each driver's capacity — recompute who has room now.
    if (dto.maxActiveDeliveries !== undefined) await recomputeDriversOfVehicleType(this.repo.manager, id);
    return saved;
  }
}
