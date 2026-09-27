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

  @Column({ name: 'picked_up_at', type: 'timestamptz', nullable: true })
  pickedUpAt?: Date | null;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt?: Date | null;

  @Column({ name: 'reassignment_count', type: 'int', default: 0 })
  reassignmentCount: number;
}
