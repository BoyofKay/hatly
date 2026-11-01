import { Column, Entity, JoinColumn, OneToOne } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { User } from '../../users/entities/user.entity';

/**
 * A privileged (ADMIN / SUPER_ADMIN) account's TOTP second factor. One row per user. `secretEncrypted` is AES-256-GCM ciphertext (the
 * plain secret is never stored or logged); the row is PENDING until the first valid code is presented (`enabledAt` null), so a half-finished
 * enrolment can never lock anybody out. `lastUsedStep` is the newest accepted time step — a code can be used once (replay protection).
 * `recoveryCodeHashes` holds SHA-256 hashes of single-use recovery codes (high-entropy, so a fast hash is appropriate); a used one is removed.
 */
@Entity({ name: 'staff_mfa_credentials' })
export class StaffMfaCredential extends BaseEntity {
  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId: string;

  @Column({ name: 'secret_encrypted', type: 'text' })
  secretEncrypted: string;

  @Column({ name: 'enabled_at', type: 'timestamptz', nullable: true })
  enabledAt: Date | null;

  @Column({ name: 'last_used_step', type: 'bigint', default: 0 })
  lastUsedStep: number;

  @Column({ name: 'recovery_code_hashes', type: 'jsonb', default: () => "'[]'" })
  recoveryCodeHashes: string[];
}
