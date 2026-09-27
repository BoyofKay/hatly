import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';

/**
 * CONFIRMED business decisions (Multi-City / Service Area chunk — do
 * not reopen): a ServiceArea is an operational delivery zone, NOT a
 * bare city-name field — a city may contain several ServiceAreas.
 * Deliberately no separate `City` entity — confirmed by inspection
 * that nothing in this codebase requires one; a ServiceArea's own
 * `name`/`nameAr` already carries whatever human-readable label
 * (a city name, a district name, a zone number) an Admin wants.
 *
 * Represented as a center point + radius, NOT a polygon — this
 * codebase has no PostGIS/geometry column type anywhere (confirmed by
 * inspection: every other geographic field in this project is a plain
 * `double precision` lat/lng pair, e.g. VendorBranch, Address,
 * Delivery). A radius-based zone is the standard, minimal
 * representation for this without introducing a new geometry
 * dependency. Containment/resolution uses straight-line (Haversine)
 * distance — deliberately NOT the real routing-distance
 * `MapProvider.distanceAndEta` (which remains exclusively for
 * pricing/ETA, untouched) — a delivery-zone boundary is a
 * geometric/administrative concept, not a "how would a car drive
 * there" one, and a zone-containment check needs to run cheaply and
 * frequently (every Discovery browse), unlike the existing per-driver
 * ranking calls.
 */
@Entity({ name: 'service_areas' })
export class ServiceArea extends BaseEntity {
  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ name: 'name_ar', type: 'varchar', length: 150, nullable: true })
  nameAr?: string | null;

  @Column({ name: 'center_latitude', type: 'double precision' })
  centerLatitude: number;

  @Column({ name: 'center_longitude', type: 'double precision' })
  centerLongitude: number;

  @Column({ name: 'radius_meters', type: 'int' })
  radiusMeters: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;
}
