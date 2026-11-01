import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One row per vendor-segment transition, written in the SAME transaction as the transition: who did it, in what role, whether Hatly
 * operations acted on the vendor's behalf, and the rejection reason. Append-only — never updated.
 */
@Entity({ name: 'order_vendor_segment_events' })
export class OrderVendorSegmentEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'segment_id', type: 'uuid' })
  segmentId: string;

  @Index()
  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ name: 'from_status', type: 'varchar', length: 30, nullable: true })
  fromStatus?: string | null;

  @Column({ name: 'to_status', type: 'varchar', length: 30 })
  toStatus: string;

  /** Null for a system transition (automatic acceptance, Hatly/Wasally readiness). */
  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId?: string | null;

  @Column({ name: 'actor_role', type: 'varchar', length: 30, nullable: true })
  actorRole?: string | null;

  @Column({ name: 'on_behalf_of_vendor', type: 'boolean', default: false })
  onBehalfOfVendor: boolean;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason?: string | null;

  @Column({ name: 'correlation_id', type: 'varchar', length: 100, nullable: true })
  correlationRef?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
