import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { Order } from '../../orders/entities/order.entity';
import { Delivery } from './delivery.entity';
import { Driver } from './driver.entity';

/**
 * M4 — Proof of Delivery. Mirrors DriverCashRemainder's own shape and
 * discipline exactly: its own dedicated, append-only table (never a
 * loosely-typed JSON blob on Delivery/Order), created by the driver
 * exactly once per delivery, never updated or deleted afterward —
 * "preserve historical evidence" means literally that: once written,
 * this row is never mutated.
 *
 * `photoUrl` MUST be a real Hatly upload already owned by the
 * submitting driver (verified via UploadsService.findOwnedUrls before
 * this row is ever created — see ProofOfDeliveryService) — never an
 * arbitrary external URL a client could point anywhere.
 *
 * The real duplicate-submission guard is the DB-level UNIQUE index on
 * `delivery_id` (see the migration), not an application-level check —
 * same reasoning as DriverCashRemainder's own `order_id` unique index.
 */
@Entity({ name: 'proof_of_deliveries' })
export class ProofOfDelivery extends BaseEntity {
  @ManyToOne(() => Order)
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Index()
  @Column({ name: 'order_id' })
  orderId: string;

  @ManyToOne(() => Delivery)
  @JoinColumn({ name: 'delivery_id' })
  delivery: Delivery;

  @Column({ name: 'delivery_id' })
  deliveryId: string;

  @ManyToOne(() => Driver)
  @JoinColumn({ name: 'driver_id' })
  driver: Driver;

  @Index()
  @Column({ name: 'driver_id' })
  driverId: string;

  /** A real, already-uploaded (`POST uploads`) photo URL owned by this driver — never client-asserted content. */
  @Column({ name: 'photo_url', type: 'varchar' })
  photoUrl: string;

  /** Optional recipient/customer confirmation (e.g. who accepted the delivery at the door). Free text, never validated against a customer record — purely operational evidence. */
  @Column({ name: 'recipient_name', type: 'varchar', nullable: true })
  recipientName?: string | null;

  @Column({ name: 'submitted_at', type: 'timestamptz' })
  submittedAt: Date;
}
