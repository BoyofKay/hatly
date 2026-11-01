import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** The outcome of one automatic dispatch attempt — what the dispatcher tried and what happened (investigation trail; append-only). */
export type DispatchAttemptOutcome =
  | 'ASSIGNED'
  | 'NO_ELIGIBLE_DRIVER'
  | 'AUTO_ASSIGN_DISABLED'
  | 'ASSIGNMENT_ERROR'
  | 'DRIVER_TIMED_OUT'
  | 'DRIVER_NOT_RESPONDING'
  | 'DRIVER_RELEASED';

@Entity({ name: 'dispatch_attempts' })
export class DispatchAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ type: 'varchar', length: 40 })
  outcome: DispatchAttemptOutcome;

  @Column({ name: 'driver_id', type: 'uuid', nullable: true })
  driverId?: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  detail?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
