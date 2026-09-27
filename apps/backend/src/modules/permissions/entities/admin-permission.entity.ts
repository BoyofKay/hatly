import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { User } from '../../users/entities/user.entity';
import { Permission } from '../permission.enum';

/**
 * One explicit grant of one permission to one ADMIN user. SUPER_ADMIN
 * never needs rows here — PermissionsGuard short-circuits for that
 * role (see permissions.guard.ts) — this table only ever holds
 * ADMIN-tier grants, per requirement 8 (doc 14): "ADMIN users only
 * receive the permissions explicitly granted to them by SUPER_ADMIN."
 *
 * `grantedByUserId` exists purely for audit ("who gave this admin this
 * permission, and when") — never read for authorization decisions,
 * only for the historical record.
 */
@Entity({ name: 'admin_permissions' })
export class AdminPermission extends BaseEntity {
  // Matches the migration (ON DELETE CASCADE) — entity metadata previously omitted it.
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Index()
  @Column({ name: 'user_id' })
  userId: string;

  @Column({ type: 'varchar', length: 64 })
  permission: Permission;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'granted_by_user_id' })
  grantedBy?: User | null;

  @Column({ type: 'uuid', name: 'granted_by_user_id', nullable: true })
  grantedByUserId?: string | null;
}
