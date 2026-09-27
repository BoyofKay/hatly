import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';

/**
 * A driver's vehicle/delivery-tool category (e.g. motorcycle,
 * bicycle) — data-driven per the approved architecture ("vehicle
 * types and capacity rules are not finalized... design as
 * extensible/configurable", Pre-Phase 3 Dispatch review) rather than
 * a hard-coded enum. This phase only scaffolds the entity + basic
 * CRUD; nothing reads or enforces `maxActiveDeliveries` yet — that's
 * the Route/RouteStop + dispatch-engine rework, a later approved
 * phase. No default rows are seeded here — this migration does not
 * invent actual vehicle types or capacity numbers, since those aren't
 * finalized business decisions (see the Phase 2 report).
 */
@Entity({ name: 'vehicle_types' })
export class VehicleType extends BaseEntity {
  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ name: 'name_ar', type: 'varchar', length: 100, nullable: true })
  nameAr?: string | null;

  @Column({ name: 'max_active_deliveries', type: 'int' })
  maxActiveDeliveries: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /**
   * PHASE 4 DISPATCH addition — necessary plumbing for the confirmed
   * "bicycle drivers must not exceed a configurable max pickup
   * distance" rule. A boolean flag rather than hard-coding a name
   * match on "Bicycle" (fragile — this catalog is admin-defined
   * freeform text, e.g. renamed/translated), letting an Admin mark
   * exactly which vehicle type(s) this distance policy applies to.
   * Default false — preserves current behavior for every existing
   * row (nothing was distance-limited before this column existed).
   */
  @Column({ name: 'is_bicycle', type: 'boolean', default: false })
  isBicycle: boolean;
}
