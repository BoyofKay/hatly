import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { Order } from './order.entity';

/**
 * One row per order status change — the source of the customer-facing timeline. Written by OrderStateMachineService (and
 * at order creation) inside the same transaction as the change, so history can never disagree with the status.
 * `actorRole = 'LEGACY'` marks best-effort rows backfilled for orders that pre-date this table.
 */
@Entity({ name: 'order_status_events' })
@Index(['orderId', 'createdAt'])
export class OrderStatusEvent extends BaseEntity {
  @ManyToOne(() => Order, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ name: 'from_status', type: 'varchar', length: 30, nullable: true })
  fromStatus?: string | null;

  @Column({ name: 'to_status', type: 'varchar', length: 30 })
  toStatus: string;

  @Column({ name: 'actor_role', type: 'varchar', length: 30, nullable: true })
  actorRole?: string | null;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId?: string | null;
}
