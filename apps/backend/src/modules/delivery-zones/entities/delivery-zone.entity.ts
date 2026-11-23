import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { ServiceArea } from '../../service-areas/entities/service-area.entity';

/**
 * PD-009 — a Delivery Zone is a named local delivery area inside an existing ServiceArea (e.g. "بلبيس — أبو نصيب").
 *
 * In V1 the zone the customer SELECTS on their address is the authoritative serviceability boundary, and its
 * `deliveryFeeMinor` is the authoritative base delivery fee (see DeliveryFeeCalculationService.calculateForZone — the
 * additional-vendor fee still composes on top through the one `composeDeliveryFee` formula). Nothing here is derived from,
 * or checked against, a map position: `representativeLatitude/Longitude` are optional METADATA for future map work and are
 * never used for pricing or containment.
 *
 * Belonging to a ServiceArea keeps the existing branch restriction (`VendorBranch.serviceAreaId`) meaningful without a
 * coordinate. Deactivated, never deleted: addresses and historical order snapshots keep pointing at it.
 */
@Entity({ name: 'delivery_zones' })
export class DeliveryZone extends BaseEntity {
  @ManyToOne(() => ServiceArea)
  @JoinColumn({ name: 'service_area_id' })
  serviceArea?: ServiceArea;

  @Index()
  @Column({ name: 'service_area_id', type: 'uuid' })
  serviceAreaId: string;

  @Column({ type: 'varchar', length: 80 })
  governorate: string;

  @Column({ name: 'governorate_ar', type: 'varchar', length: 80 })
  governorateAr: string;

  @Column({ type: 'varchar', length: 80 })
  city: string;

  @Column({ name: 'city_ar', type: 'varchar', length: 80 })
  cityAr: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ name: 'name_ar', type: 'varchar', length: 150 })
  nameAr: string;

  /** Integer minor units (piastres). The V1 base delivery fee for an address in this zone. */
  @Column({ name: 'delivery_fee_minor', type: 'bigint' })
  deliveryFeeMinor: number;

  /** Villages / neighbourhoods inside the zone (owner decision 2026-11-23) — the customer picks one; the fee is the zone's. */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  areas: string[];

  @Column({ name: 'display_order', type: 'int', default: 0 })
  displayOrder: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /** Metadata only — never a pricing/serviceability input. Both null or both set. */
  @Column({ name: 'representative_latitude', type: 'double precision', nullable: true })
  representativeLatitude?: number | null;

  @Column({ name: 'representative_longitude', type: 'double precision', nullable: true })
  representativeLongitude?: number | null;
}

/** What a customer (and an order snapshot) may know about a zone: names and its base fee. Never internal admin metadata. */
export interface DeliveryZoneSummary {
  id: string;
  name: string;
  nameAr: string;
  city: string;
  cityAr: string;
  governorate: string;
  governorateAr: string;
}

export function toDeliveryZoneSummary(zone: DeliveryZone): DeliveryZoneSummary {
  return {
    id: zone.id,
    name: zone.name,
    nameAr: zone.nameAr,
    city: zone.city,
    cityAr: zone.cityAr,
    governorate: zone.governorate,
    governorateAr: zone.governorateAr,
  };
}
