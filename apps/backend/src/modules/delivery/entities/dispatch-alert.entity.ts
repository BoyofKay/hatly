import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { Order } from '../../orders/entities/order.entity';

/**
 * The buildable form of "Admin should be notified/alerted" — confirmed
 * by inspection: this codebase has no notification infrastructure at
 * all (`modules/notifications` is an empty directory, no push/SMS/email
 * provider exists anywhere). A durable, queryable record an Admin
 * dashboard can list/poll is the honest minimum here, matching this
 * project's established pattern for "the real integration doesn't
 * exist yet, so build the structurally-real part around where it will
 * plug in" (e.g. OtpService logs instead of sending a real SMS).
 *
 * `resolvedAt` is set once a driver is successfully assigned for this
 * order after the alert was raised — lets an Admin view distinguish
 * "still needs attention" from "resolved itself on retry."
 */
export type DispatchAlertReason = 'NO_ELIGIBLE_DRIVER' | 'AUTO_ASSIGN_DISABLED' | 'ASSIGNMENT_ERROR' | 'DRIVER_NOT_RESPONDING';
export const DISPATCH_ALERT_REASONS: DispatchAlertReason[] = ['NO_ELIGIBLE_DRIVER', 'AUTO_ASSIGN_DISABLED', 'ASSIGNMENT_ERROR', 'DRIVER_NOT_RESPONDING'];

@Entity({ name: 'dispatch_alerts' })
export class DispatchAlert extends BaseEntity {
  @ManyToOne(() => Order)
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Index()
  @Column({ name: 'order_id' })
  orderId: string;

  /** Stable machine-readable code (see DispatchAlertReason). */
  @Column({ type: 'varchar', length: 50 })
  reason: DispatchAlertReason;

  /** Human-readable context for operations (never a secret). */
  @Column({ type: 'varchar', length: 500, nullable: true })
  detail?: string | null;

  @Column({ name: 'resolved_by_user_id', type: 'uuid', nullable: true })
  resolvedByUserId?: string | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt?: Date | null;
}
