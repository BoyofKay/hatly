import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { DeliveryZone } from './entities/delivery-zone.entity';
import { ServiceArea } from '../service-areas/entities/service-area.entity';
import { CreateDeliveryZoneDto } from './dto/create-delivery-zone.dto';
import { UpdateDeliveryZoneDto } from './dto/update-delivery-zone.dto';

/** Admin management + customer listing of Delivery Zones (PD-009). Deactivation, never deletion. */
@Injectable()
export class DeliveryZonesService {
  constructor(
    @InjectRepository(DeliveryZone) private readonly zonesRepository: Repository<DeliveryZone>,
    @InjectRepository(ServiceArea) private readonly serviceAreasRepository: Repository<ServiceArea>,
  ) {}

  /** Customer-facing: active zones of active service areas, in display order. */
  async listActive(): Promise<DeliveryZone[]> {
    const zones = await this.zonesRepository.find({
      where: { isActive: true },
      relations: { serviceArea: true },
      order: { governorateAr: 'ASC', cityAr: 'ASC', displayOrder: 'ASC', nameAr: 'ASC' },
    });
    return zones.filter((z) => z.serviceArea?.isActive);
  }

  async listAll(): Promise<DeliveryZone[]> {
    return this.zonesRepository.find({ order: { cityAr: 'ASC', displayOrder: 'ASC', nameAr: 'ASC' } });
  }

  async getOne(id: string): Promise<DeliveryZone> {
    const zone = await this.zonesRepository.findOne({ where: { id } });
    if (!zone) throw new NotFoundException({ message: 'Delivery zone not found.', details: { code: 'DELIVERY_ZONE_NOT_FOUND' } });
    return zone;
  }

  async create(dto: CreateDeliveryZoneDto): Promise<DeliveryZone> {
    await this.assertServiceArea(dto.serviceAreaId);
    const point = this.point(dto.representativeLatitude, dto.representativeLongitude);
    return this.save(
      this.zonesRepository.create({
        serviceAreaId: dto.serviceAreaId,
        governorate: dto.governorate.trim(),
        governorateAr: dto.governorateAr.trim(),
        city: dto.city.trim(),
        cityAr: dto.cityAr.trim(),
        name: dto.name.trim(),
        nameAr: dto.nameAr.trim(),
        zoneName: dto.zoneName.trim(),
        zoneNameAr: dto.zoneNameAr.trim(),
        deliveryFeeMinor: dto.deliveryFeeMinor,
        displayOrder: dto.displayOrder ?? 0,
        isActive: true,
        representativeLatitude: point.latitude,
        representativeLongitude: point.longitude,
      }),
    );
  }

  async update(id: string, dto: UpdateDeliveryZoneDto): Promise<DeliveryZone> {
    const zone = await this.getOne(id);
    if (dto.serviceAreaId !== undefined) {
      await this.assertServiceArea(dto.serviceAreaId);
      zone.serviceAreaId = dto.serviceAreaId;
    }
    for (const key of ['governorate', 'governorateAr', 'city', 'cityAr', 'name', 'nameAr', 'zoneName', 'zoneNameAr'] as const) {
      if (dto[key] !== undefined) zone[key] = dto[key]!.trim();
    }
    if (dto.displayOrder !== undefined) zone.displayOrder = dto.displayOrder;
    if (dto.representativeLatitude !== undefined || dto.representativeLongitude !== undefined) {
      const point = this.point(dto.representativeLatitude, dto.representativeLongitude);
      zone.representativeLatitude = point.latitude;
      zone.representativeLongitude = point.longitude;
    }
    return this.save(zone);
  }

  /** Only future quotes/orders see the new fee: every order froze its own fee + zone snapshot. */
  async updateFee(id: string, deliveryFeeMinor: number): Promise<DeliveryZone> {
    const zone = await this.getOne(id);
    zone.deliveryFeeMinor = deliveryFeeMinor;
    return this.save(zone);
  }

  async setActive(id: string, isActive: boolean): Promise<DeliveryZone> {
    const zone = await this.getOne(id);
    zone.isActive = isActive;
    return this.save(zone);
  }

  private async assertServiceArea(id: string): Promise<void> {
    if (!(await this.serviceAreasRepository.findOne({ where: { id } }))) {
      throw new BadRequestException({ message: 'Service area not found.', details: { code: 'SERVICE_AREA_NOT_FOUND' } });
    }
  }

  /** Both or neither — a half point is never stored, and nothing is ever invented. */
  private point(latitude: number | null | undefined, longitude: number | null | undefined) {
    const hasLat = latitude !== undefined && latitude !== null;
    const hasLng = longitude !== undefined && longitude !== null;
    if (hasLat !== hasLng) {
      throw new BadRequestException({
        message: 'Representative latitude and longitude must be set (or removed) together.',
        details: { code: 'INVALID_REPRESENTATIVE_POINT' },
      });
    }
    return { latitude: hasLat ? latitude! : null, longitude: hasLng ? longitude! : null };
  }

  private async save(zone: DeliveryZone): Promise<DeliveryZone> {
    try {
      return await this.zonesRepository.save(zone);
    } catch (error) {
      if (error instanceof QueryFailedError && (error as any).code === '23505') {
        throw new ConflictException({
          message: 'A neighborhood/village with this name already exists under this delivery zone.',
          details: { code: 'DELIVERY_ZONE_NAME_TAKEN' },
        });
      }
      throw error;
    }
  }
}
