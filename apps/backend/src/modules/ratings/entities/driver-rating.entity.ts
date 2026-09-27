import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { User } from '../../users/entities/user.entity';
import { Delivery } from '../../delivery/entities/delivery.entity';
import { Driver } from '../../delivery/entities/driver.entity';

/**
 * CONFIRMED business decision (Ratings): a Driver rating references
 * the actual `Delivery`, not an arbitrary Driver. `driverId` is
 * denormalized from `Delivery.driverId` at rating time — safe and
 * authoritative because driver reassignment is structurally
 * impossible once the order has reached PICKED_UP (verified against
 * OrderStateMachineService's own transition table: no path leads back
 * from PICKED_UP/ON_THE_WAY/DELIVERED to an earlier status, and
 * AdminDispatchService.reassign() only ever routes back through
 * READY_FOR_PICKUP). By the time an order is DELIVERED,
 * `Delivery.driverId` can never change again — this snapshot and a
 * live read of `Delivery.driverId` will always agree.
 *
 * One row per (customer, delivery) — unique index in the migration.
 * Immutable by construction — no update/delete method exists, same
 * discipline as `VendorRating`/`AdHocPurchaseRecord`.
 */
@Entity({ name: 'driver_ratings' })
export class DriverRating extends BaseEntity {
  @ManyToOne(() => User)
  @JoinColumn({ name: 'customer_id' })
  customer: User;

  @Column({ name: 'customer_id' })
  customerId: string;

  @ManyToOne(() => Delivery)
  @JoinColumn({ name: 'delivery_id' })
  delivery: Delivery;

  @Index({ unique: true })
  @Column({ name: 'delivery_id' })
  deliveryId: string;

  @ManyToOne(() => Driver)
  @JoinColumn({ name: 'driver_id' })
  driver: Driver;

  @Column({ name: 'driver_id' })
  driverId: string;

  /** 1–5, validated at the DTO layer (class-validator) before this row is ever created. */
  @Column({ type: 'smallint' })
  stars: number;

  @Column({ type: 'varchar', nullable: true })
  comment?: string | null;
}
