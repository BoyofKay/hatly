import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';

/**
 * One privileged, security-sensitive action (who did what to which object, and whether it worked). APPEND-ONLY: a database trigger
 * refuses every UPDATE and DELETE on this table, so history cannot be rewritten through the application or an SQL session without
 * first dropping the trigger. `metadata` is a small, flat, secret-free summary (see AdminAuditService.sanitize) — never a password,
 * token, code, secret or whole request body.
 *
 * `actor_user_id` is a real FK (NO ACTION: users are never deleted); it is null when the actor is unknown (a failed sign-in for a phone
 * that has no account). `target_id` is text, not a uuid FK, because the target may be a user, a config key or a sector.
 */
@Entity({ name: 'admin_audit_logs' })
@Index('IDX_admin_audit_logs_actor_created', ['actorUserId', 'createdAt'])
@Index('IDX_admin_audit_logs_action_created', ['action', 'createdAt'])
export class AdminAuditLog extends BaseEntity {
  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId: string | null;

  @Column({ name: 'actor_role', type: 'varchar', length: 30, nullable: true })
  actorRole: string | null;

  @Column({ type: 'varchar', length: 60 })
  action: string;

  @Column({ name: 'target_type', type: 'varchar', length: 40, nullable: true })
  targetType: string | null;

  /** Free text on purpose (a user id, a setting name, a masked phone) — hence not named `…Id`: it is NOT a uuid reference. */
  @Column({ name: 'target_id', type: 'varchar', length: 120, nullable: true })
  targetRef: string | null;

  /** SUCCESS or FAILURE. */
  @Column({ type: 'varchar', length: 10, default: 'SUCCESS' })
  outcome: string;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata: Record<string, string | number | boolean | null>;

  /** Client address as the server saw it (after the configured proxy rules); useful for investigating a sign-in, never used for decisions. */
  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
  ipAddress: string | null;
}
