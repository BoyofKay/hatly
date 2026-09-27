import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { User } from '../../users/entities/user.entity';

/**
 * Driver Push Notifications. One row per registered device/token —
 * a Driver may have multiple active rows (multiple devices) or the
 * same device may re-register with a rotated token (Firebase token
 * refresh), which is handled as an upsert-by-(userId, token) in
 * DeviceTokensService, not by this entity itself.
 *
 * `isActive` (not a hard delete) is how an invalid/unregistered token
 * reported by Firebase gets retired — CONFIRMED: never delete all of
 * a user's tokens on one invalid-token report, only the specific row.
 *
 * `user_id` is a real FK with ON DELETE CASCADE (migration
 * LedgerReferentialIntegrity): a token is a push address owned by
 * exactly one user with no audit/financial value, so it must not
 * outlive its user. Users are never deleted today, and a user with
 * ledger history cannot be deleted at all (those FKs are NO ACTION).
 */
@Entity({ name: 'device_tokens' })
export class DeviceToken extends BaseEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Index()
  @Column({ name: 'user_id' })
  userId: string;

  @Index({ unique: true })
  @Column({ type: 'varchar' })
  token: string;

  @Column({ type: 'varchar' })
  platform: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;
}
