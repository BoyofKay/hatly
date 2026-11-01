import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';

export type AccountDeletionRequestStatus = 'PENDING' | 'COMPLETED' | 'REJECTED';
export const ACCOUNT_DELETION_VERIFICATION_METHODS = ['CALLBACK_TO_ACCOUNT_PHONE', 'WHATSAPP_FROM_ACCOUNT_PHONE'] as const;
export type AccountDeletionVerificationMethod = (typeof ACCOUNT_DELETION_VERIFICATION_METHODS)[number];
export const ACCOUNT_DELETION_REJECTION_REASONS = ['COULD_NOT_VERIFY', 'WITHDRAWN_BY_REQUESTER', 'NO_ACCOUNT_FOR_NUMBER', 'DUPLICATE'] as const;
export type AccountDeletionRejectionReason = (typeof ACCOUNT_DELETION_REJECTION_REASONS)[number];

/**
 * A deletion request made WITHOUT signing in (the public web page's "I can't sign in" path). It deletes nothing by itself: a SUPER_ADMIN
 * verifies that the requester controls the phone number (call-back to, or a WhatsApp message from, that number) and only then completes it.
 *
 * Holds as little as possible: the phone number as typed (normalised E.164) while PENDING; on resolution the number is replaced by a
 * masked form (`***123`) so the request log can never re-identify a deleted account. No name, no free text, no IP.
 */
@Entity({ name: 'account_deletion_requests' })
@Index('IDX_account_deletion_requests_status_created', ['status', 'createdAt'])
export class AccountDeletionRequest extends BaseEntity {
  @Column({ type: 'varchar', length: 20 })
  phone: string;

  @Column({ type: 'varchar', length: 10, default: 'PENDING' })
  status: AccountDeletionRequestStatus;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @Column({ name: 'resolved_by_user_id', type: 'uuid', nullable: true })
  resolvedByUserId: string | null;

  /** COMPLETED: how the requester's control of the number was verified. */
  @Column({ name: 'verification_method', type: 'varchar', length: 40, nullable: true })
  verificationMethod: AccountDeletionVerificationMethod | null;

  /** REJECTED: why. */
  @Column({ name: 'rejection_reason', type: 'varchar', length: 40, nullable: true })
  rejectionReason: AccountDeletionRejectionReason | null;
}
