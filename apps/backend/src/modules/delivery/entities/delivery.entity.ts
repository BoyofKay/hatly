import { Column, Entity, Index, JoinColumn, OneToOne } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { Order } from '../../orders/entities/order.entity';

@Entity({ name: 'deliveries' })
export class Delivery extends BaseEntity {
  @OneToOne(() => Order)
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Column({ name: 'order_id' })
  orderId: string;

  @Index()
  @Column({ name: 'driver_id', type: 'uuid', nullable: true })
  driverId?: string | null;

  @Column({ name: 'assigned_at', type: 'timestamptz', nullable: true })
  assignedAt?: Date | null;

  @Column({ name: 'accept_deadline_at', type: 'timestamptz', nullable: true })
  acceptDeadlineAt?: Date | null;

  /** R16: when the CURRENT driver acknowledged this assignment (null = not yet). Reset on every (re)assignment. */
  @Column({ name: 'acknowledged_at', type: 'timestamptz', nullable: true })
  acknowledgedAt?: Date | null;

  @Column({ name: 'picked_up_at', type: 'timestamptz', nullable: true })
  pickedUpAt?: Date | null;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt?: Date | null;

  /** Assignment offers in a row that nobody answered (reset when a driver acts or an admin assigns) — drives the DRIVER_NOT_RESPONDING alert. */
  @Column({ name: 'consecutive_unanswered', type: 'int', default: 0 })
  consecutiveUnanswered: number;

  @Column({ name: 'reassignment_count', type: 'int', default: 0 })
  reassignmentCount: number;
}
