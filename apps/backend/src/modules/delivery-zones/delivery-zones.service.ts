import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { DeliveryZone } from './entities/delivery-zone.entity';
import { ServiceArea } from '../service-areas/entities/service-area.entity';
import { CreateDeliveryZoneDto } from './dto/create-delivery-zone.dto';
import { UpdateDeliveryZoneDto } from './dto/update-delivery-zone.dto';
import { SaveDeliveryZoneGroupDto } from './dto/save-delivery-zone-group.dto';

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
      where: { isActive: true, isSelectable: true },
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
    // Legacy rows have no parent. A partial parent update would violate
    // the DB's bilingual-pair invariant, so return a clear validation error.
    if ((dto.zoneName !== undefined) !== (dto.zoneNameAr !== undefined)) {
      throw new BadRequestException({
        message: 'Provide both English and Arabic parent delivery-zone names together.',
        details: { code: 'DELIVERY_ZONE_BILINGUAL_PARENT_REQUIRED' },
      });
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

  /**
   * One transaction for parent metadata, child fees, statuses and removal.
   * Rows referenced by saved addresses are preserved; a removed child becomes unselectable.
   * Location labels are copied from existing records in the selected Service Area,
   * never accepted as editable input from the client.
   */
  async saveGroup(dto: SaveDeliveryZoneGroupDto): Promise<DeliveryZone[]> {
    const originalProvided = !!dto.originalServiceAreaId;
    if (originalProvided !== !!dto.originalZoneName || originalProvided !== !!dto.originalZoneNameAr) {
      throw new BadRequestException('Original delivery zone identity is incomplete.');
    }
    const childNames = new Set<string>();
    const childNamesAr = new Set<string>();
    for (const row of dto.neighborhoods) {
      const en = row.name.trim().toLocaleLowerCase();
      const ar = row.nameAr.trim().toLocaleLowerCase();
      if (childNames.has(en) || childNamesAr.has(ar)) throw new BadRequestException('Duplicate neighborhood/village in the same delivery zone.');
      childNames.add(en); childNamesAr.add(ar);
    }
    try {
      return await this.zonesRepository.manager.transaction(async (manager) => {
        const zones = manager.getRepository(DeliveryZone);
        const area = await manager.getRepository(ServiceArea).findOne({where:{id:dto.serviceAreaId}});
        if (!area) throw new BadRequestException('Selected Service Area does not exist.');
        const originals = originalProvided
          ? await zones.find({where:{serviceAreaId:dto.originalServiceAreaId!,zoneName:dto.originalZoneName!,zoneNameAr:dto.originalZoneNameAr!}})
          : [];
        if (originalProvided && originals.filter(z => z.isSelectable).length === 0) {
          throw new NotFoundException('Delivery Zone not found or already removed.');
        }
        // Existing children in this service area are the established authoritative labels.
        // ServiceArea itself stores a name/radius, not governorate/city fields.
        const exemplar = originals.find(z=>z.serviceAreaId === dto.serviceAreaId)
          ?? (await zones.findOne({where:{serviceAreaId:dto.serviceAreaId}}));
        if (!exemplar) throw new BadRequestException('Selected Service Area has no configured governorate/city information. Configure its location first.');
        const ids = new Set(originals.map(z=>z.id));
        const suppliedIds = dto.neighborhoods.filter(z=>!!z.id).map(z=>z.id!);
        if (new Set(suppliedIds).size !== suppliedIds.length || suppliedIds.some(id=>!ids.has(id))) {
          throw new BadRequestException('Neighborhood record does not belong to this Delivery Zone.');
        }
        const results: DeliveryZone[] = [];
        for (const entry of dto.neighborhoods) {
          let zone = entry.id ? originals.find(z=>z.id===entry.id)! : zones.create({
            serviceAreaId:dto.serviceAreaId, governorate:exemplar.governorate,
            governorateAr:exemplar.governorateAr,city:exemplar.city,cityAr:exemplar.cityAr,
            representativeLatitude:null,representativeLongitude:null,areas:[],
          });
          zone.serviceAreaId = dto.serviceAreaId;
          zone.governorate = exemplar.governorate; zone.governorateAr = exemplar.governorateAr;
          zone.city = exemplar.city; zone.cityAr = exemplar.cityAr;
          zone.zoneName = dto.zoneName.trim(); zone.zoneNameAr = dto.zoneNameAr.trim();
          zone.name = entry.name.trim(); zone.nameAr = entry.nameAr.trim();
          zone.deliveryFeeMinor = entry.deliveryFeeMinor;
          zone.displayOrder = dto.displayOrder;
          zone.isActive = entry.isActive && dto.isActive;
          zone.isSelectable = true;
          results.push(await zones.save(zone));
        }
        const retainedIds = new Set(suppliedIds);
        for (const old of originals) {
          if (!retainedIds.has(old.id) && old.isSelectable) {
            old.isActive = false;
            old.isSelectable = false;
            await zones.save(old);
          }
        }
        return results;
      });
    } catch (error) {
      if (error instanceof QueryFailedError && (error as any).code === '23505') {
        throw new ConflictException('A neighborhood/village name is already used in this delivery zone.');
      }
      throw error;
    }
  }

  /** Remove a parent from new selections without deleting linked addresses or historical orders. */
  async removeGroup(serviceAreaId: string, zoneName: string, zoneNameAr: string): Promise<void> {
    await this.zonesRepository.manager.transaction(async manager => {
      const repo = manager.getRepository(DeliveryZone);
      const rows = await repo.find({where:{serviceAreaId,zoneName,zoneNameAr}});
      if (!rows.some(z=>z.isSelectable)) throw new NotFoundException('Delivery Zone not found.');
      for (const row of rows) {
        row.isActive = false;
        row.isSelectable = false;
        await repo.save(row);
      }
    });
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
