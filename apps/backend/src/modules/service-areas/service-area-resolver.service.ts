import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ServiceArea } from './entities/service-area.entity';

const EARTH_RADIUS_METERS = 6371000;

/**
 * CONFIRMED (Multi-City / Service Area chunk): straight-line
 * (Haversine) distance — deliberately NOT the real routing-distance
 * `MapProvider` used for pricing/ETA (see ServiceArea entity's own
 * comment for why). Pure math, no external API call — this needs to
 * run cheaply and frequently (every Discovery browse, every dispatch
 * ranking call).
 */
function haversineDistanceMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_METERS * c;
}

/**
 * Shared by Discovery (`MarketplaceVendorsService`) and Dispatch
 * (`DriverRankingService`) — one resolver, reused, not duplicated
 * logic in each caller.
 */
@Injectable()
export class ServiceAreaResolverService {
  constructor(@InjectRepository(ServiceArea) private readonly serviceAreasRepository: Repository<ServiceArea>) {}

  /**
   * Returns the nearest active ServiceArea whose radius contains the
   * given point, or `null` if none does. "Nearest" (by distance to
   * center) is the tie-break if a point somehow falls within more than
   * one active zone's radius — deterministic, not arbitrary.
   */
  async resolveForPoint(latitude: number, longitude: number): Promise<ServiceArea | null> {
    const activeAreas = await this.serviceAreasRepository.find({ where: { isActive: true } });

    let nearest: { area: ServiceArea; distanceMeters: number } | null = null;
    for (const area of activeAreas) {
      const distanceMeters = haversineDistanceMeters(latitude, longitude, area.centerLatitude, area.centerLongitude);
      if (distanceMeters > area.radiusMeters) continue;
      if (!nearest || distanceMeters < nearest.distanceMeters) {
        nearest = { area, distanceMeters };
      }
    }

    return nearest?.area ?? null;
  }
}
