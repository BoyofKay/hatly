import { Column, Entity, JoinColumn, ManyToOne, OneToOne } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { User } from '../../users/entities/user.entity';
import { VehicleType } from '../../business-config/entities/vehicle-type.entity';

@Entity({ name: 'drivers' })
export class Driver extends BaseEntity {
  @OneToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id' })
  userId: string;

  /**
   * PHASE 4 DISPATCH addition — necessary plumbing, no prior link
   * existed between Driver and VehicleType at all (confirmed by
   * inspection during the Phase D design review). Nullable: a driver
   * may exist without a vehicle type assigned yet, in which case
   * DriverRankingService cannot apply the bicycle-distance rule to
   * them (they're simply not treated as a bicycle).
   */
  @ManyToOne(() => VehicleType, { nullable: true })
  @JoinColumn({ name: 'vehicle_type_id' })
  vehicleType?: VehicleType | null;

  @Column({ type: 'uuid', name: 'vehicle_type_id', nullable: true })
  vehicleTypeId?: string | null;

  @Column({ name: 'is_online', type: 'boolean', default: false })
  isOnline: boolean;

  // R18: true while the driver has spare capacity (active orders < capacity) — recomputed by driver-capacity.ts whenever
  // their active deliveries or capacity change.
  @Column({ name: 'is_available', type: 'boolean', default: false })
  isAvailable: boolean;

  /** R18: an Admin override of this driver's capacity (active orders at once); null = the vehicle type's capacity. Audited. */
  @Column({ name: 'capacity_override', type: 'int', nullable: true })
  capacityOverride?: number | null;

  @Column({ name: 'verification_status', type: 'varchar', length: 20, default: 'PENDING' })
  verificationStatus: 'PENDING' | 'APPROVED' | 'REJECTED';

  @Column({ name: 'last_latitude', type: 'double precision', nullable: true })
  lastLatitude?: number | null;

  @Column({ name: 'last_longitude', type: 'double precision', nullable: true })
  lastLongitude?: number | null;

  @Column({ name: 'last_location_at', type: 'timestamptz', nullable: true })
  lastLocationAt?: Date | null;

  /** Presence (2026-11-13): the last time the driver's app called the API (written at most every 30 s). Not GPS. */
  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
  lastSeenAt?: Date | null;

  /** Presence (2026-11-13): when the driver last switched their own online/offline toggle. */
  @Column({ name: 'online_changed_at', type: 'timestamptz', nullable: true })
  onlineChangedAt?: Date | null;

  /**
   * PHASE F addition. CONFIRMED: driver commission is NOT one global
   * fixed percentage — each driver has their own configurable rate.
   * Same basis-points representation and same fail-closed nullability
   * as VendorBranch.commissionRateBasisPoints — see that field's own
   * comment for the full reasoning.
   */
  @Column({ name: 'commission_rate_basis_points', type: 'int', nullable: true })
  commissionRateBasisPoints?: number | null;

  /**
   * PHASE G addition (Ratings). Derived/recomputable cache — see
   * VendorBranch.ratingCount's own comment for the full reasoning;
   * applies identically here.
   */
  @Column({ name: 'rating_count', type: 'int', default: 0 })
  ratingCount: number;

  @Column({ name: 'rating_sum_stars', type: 'int', default: 0 })
  ratingSumStars: number;
}
