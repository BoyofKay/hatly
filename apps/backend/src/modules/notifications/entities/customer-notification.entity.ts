import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { User } from '../../users/entities/user.entity';
import { Order } from '../../orders/entities/order.entity';

/**
 * A customer's in-app notification about one of THEIR orders. Written in the same transaction as the real order event it reports
 * (order created, a status transition), never invented: `type` is derived from the order lifecycle that already exists.
 *
 * (order_id, type) is unique for lifecycle notifications (no event key), and (order_id, type, event_key) is unique for notifications that
 * belong to one EVENT — e.g. each unavailable-items case of an order notifies once. Either way a retried or concurrently-processed event can
 * never produce a second row — the insert is `ON CONFLICT DO NOTHING` (see recordOrderNotification). The customer-facing wording is rendered by the app from `type`
 * (+ `orderNumber`); the server never stores localized text.
 *
 * Both foreign keys CASCADE: a notification is a convenience view over an order, with no audit or financial value of its own.
 */
@Entity({ name: 'customer_notifications' })
@Index('IDX_customer_notifications_customer_created', ['customerId', 'createdAt'])
@Index('UQ_customer_notifications_order_type', ['orderId', 'type'], { unique: true, where: '"event_key" IS NULL' })
@Index('UQ_customer_notifications_order_type_event', ['orderId', 'type', 'eventKey'], { unique: true, where: '"event_key" IS NOT NULL' })
export class CustomerNotification extends BaseEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer: User;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @ManyToOne(() => Order, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  /** One of CustomerNotificationType. */
  @Column({ type: 'varchar', length: 40 })
  type: string;

  /** Frozen copy of the customer-facing order reference (HT-100234) so the list renders without joining orders. */
  @Column({ name: 'order_number', type: 'varchar', length: 20 })
  orderNumber: string;

  /** Set for notifications that belong to one event of an order (e.g. `exception:<id>`); null for the once-per-order lifecycle ones. */
  @Column({ name: 'event_key', type: 'varchar', length: 120, nullable: true })
  eventKey: string | null;

  @Column({ name: 'is_read', type: 'boolean', default: false })
  isRead: boolean;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt: Date | null;
}
