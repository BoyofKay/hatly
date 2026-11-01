import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { DataSource, EntityManager } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { AdminAuditAction, AdminAuditService } from '../audit/admin-audit.service';
import { UsersService } from '../users/users.service';
import { UploadsService } from '../uploads/uploads.service';
import { LoginAttemptLimiter } from './login-attempt-limiter';
import { RefreshTokenStore } from './refresh-token.store';
import {
  AccountDeletionRejectionReason,
  AccountDeletionRequest,
  AccountDeletionRequestStatus,
  AccountDeletionVerificationMethod,
} from './deletion/account-deletion-request.entity';

/** Order states with no further movement. Anything else is an order in flight that a deletion would strand. */
const TERMINAL_ORDER_STATUSES = ['DELIVERED', 'CANCELLED', 'FAILED_DELIVERY', 'COLLECTED'];

export const DELETED_CUSTOMER_NAME = 'Deleted customer';

/** How an account deletion was asked for — recorded in the audit entry. */
export type AccountDeletionChannel = 'in_app' | 'web' | 'web_request';

/** The one answer the public "I can't sign in" form ever gives, whether or not the number has an account. */
export const DELETION_REQUEST_ACK =
  'If this number has a Hatly account, our team will contact this number to confirm it is yours before deleting the account. Nothing is deleted until then.';

const maskPhone = (phone: string) => `***${phone.slice(-3)}`;

/**
 * Customer account deletion (Apple App Store guideline 5.1.1(v); Google Play account-deletion policy, which also requires a way to ask for
 * deletion WITHOUT the app). Customers only: vendor staff, drivers and admins are created by an administrator and are off-boarded by
 * deactivating them, never self-service. Three ways in, one erase:
 *  - IN APP: the signed-in customer re-enters the password (`deleteCustomerAccount`).
 *  - WEB, self-service: phone number + password on the public page (`deleteCustomerAccountWithCredentials`) — the same proof as signing in,
 *    under the same per-account failed-attempt brake, and one generic failure that never says whether the number has an account.
 *  - WEB, "I can't sign in": a REQUEST only (`requestDeletion`) — it deletes nothing and never reveals whether the number has an account.
 *    A SUPER_ADMIN verifies the requester controls the number (call-back / WhatsApp from it) and completes or rejects it.
 *
 * What "deleted" means — chosen so that no money record and no other person's record is ever damaged:
 *  - ERASED: name, e-mail, password, phone number (replaced by a unique placeholder, which also frees the number), saved addresses, push
 *    tokens, notifications, favourites, the open cart, review comments; on the customer's orders: the delivery-address snapshot, the order
 *    note, the cancellation reason, the customer's notes to the vendor and per item, custom-request descriptions and photo references, and
 *    the Hatly Service pickup/destination coordinates; and the customer's uploaded photos themselves (upload records + stored files).
 *  - KEPT, unlinked from any identity: order, payment, wallet-ledger, loyalty-ledger and refund records (amounts, items, timestamps, order
 *    numbers), rating stars, the Hatly Service place name, and the driver's proof-of-delivery record. See docs/launch/PRIVACY_AND_COMPLIANCE.md
 *    for the reasons and the open retention decisions.
 *  - REFUSED (409) while it would strand something: an order still in flight, or a non-zero wallet balance. Loyalty points are forfeited.
 * The sign-in is revoked at once (refresh session removed, account deactivated). An access token already issued stays valid until its own
 * short expiry but resolves to an anonymised, inactive account (staff are re-checked per request; customer routes then find nothing).
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly usersService: UsersService,
    private readonly refreshTokenStore: RefreshTokenStore,
    private readonly loginAttemptLimiter: LoginAttemptLimiter,
    private readonly audit: AdminAuditService,
    private readonly uploads: UploadsService,
  ) {}

  // ---- in app ----------------------------------------------------------------------------------------------------------------------

  async deleteCustomerAccount(userId: string, password: string, ipAddress?: string | null): Promise<void> {
    const user = await this.usersService.findByIdWithPasswordHash(userId);
    if (!user || user.role !== Role.CUSTOMER || !user.isActive || !user.passwordHash) {
      throw new UnauthorizedException('Unable to delete this account.');
    }
    if (!password) throw new BadRequestException({ message: 'Enter your password to delete your account.', details: { code: 'PASSWORD_REQUIRED' } });
    await this.loginAttemptLimiter.assertAllowed(user.phone); // the same brake that protects sign-in: this endpoint also guesses the password
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      await this.loginAttemptLimiter.recordFailure(user.phone);
      throw new ForbiddenException({ message: 'The password is incorrect.', details: { code: 'PASSWORD_INVALID' } });
    }
    await this.loginAttemptLimiter.clear(user.phone);
    await this.executeDeletion(userId, { actorUserId: userId, actorRole: Role.CUSTOMER, channel: 'in_app', ipAddress });
  }

  // ---- public web page: self-service with the password --------------------------------------------------------------------------------

  /**
   * The public page's "delete my account" form. Identity = phone number + password (exactly what signing in proves). Every failure that
   * could tell an outsider something — unknown number, not a customer, deactivated, already deleted, wrong password — is the SAME 401 and
   * counts against the number's failed-attempt brake (before any bcrypt work once it is locked). Only after the password is proven can the
   * 409s (order in progress / wallet not empty) be seen, and those concern the requester's own account.
   */
  async deleteCustomerAccountWithCredentials(phone: string, password: string, ipAddress?: string | null): Promise<void> {
    const invalid = () => new UnauthorizedException({ message: 'Invalid phone number or password.', details: { code: 'INVALID_CREDENTIALS' } });
    if (!phone || !password) throw invalid();
    await this.loginAttemptLimiter.assertAllowed(phone);
    const user = await this.usersService.findByPhoneWithPasswordHash(phone);
    if (!user || user.role !== Role.CUSTOMER || !user.isActive || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
      await this.loginAttemptLimiter.recordFailure(phone);
      throw invalid();
    }
    await this.loginAttemptLimiter.clear(phone);
    await this.executeDeletion(user.id, { actorUserId: user.id, actorRole: Role.CUSTOMER, channel: 'web', ipAddress });
  }

  // ---- public web page: "I can't sign in" request --------------------------------------------------------------------------------------

  /**
   * Records a request and nothing else. Deliberately does NOT look the number up (no account-existence oracle, not even by timing): every
   * well-formed number gets the same acknowledgement. At most one PENDING request per number (a partial unique index), so repeats are no-ops.
   */
  async requestDeletion(phone: string): Promise<{ message: string }> {
    await this.dataSource.query(
      `INSERT INTO account_deletion_requests (phone) VALUES ($1) ON CONFLICT (phone) WHERE status = 'PENDING' DO NOTHING`,
      [phone],
    );
    this.logger.log(`account deletion request recorded for ${maskPhone(phone)}`);
    return { message: DELETION_REQUEST_ACK };
  }

  // ---- SUPER_ADMIN review of requests -------------------------------------------------------------------------------------------------

  async listRequests(status: AccountDeletionRequestStatus = 'PENDING'): Promise<AccountDeletionRequest[]> {
    return this.dataSource.getRepository(AccountDeletionRequest).find({ where: { status }, order: { createdAt: 'ASC' }, take: 200 });
  }

  /**
   * Completes a verified request: the SUPER_ADMIN states HOW the requester proved control of the number (recorded), and the account with
   * exactly that phone number is deleted through the same erase, in the same transaction as the request's resolution. The request's phone
   * is masked as it is resolved. Refused while the request is not PENDING, when no active customer has that number (reject it with
   * NO_ACCOUNT_FOR_NUMBER instead), or with the usual 409s (order in progress / wallet not empty — the request then stays PENDING).
   */
  async completeRequest(actor: { id: string; role: string }, requestId: string, verificationMethod: AccountDeletionVerificationMethod, ipAddress?: string | null): Promise<AccountDeletionRequest> {
    let deletedUserId = '';
    let uploadedFiles: string[] = [];
    await this.dataSource.transaction(async (manager) => {
      const request = await this.lockPendingRequest(manager, requestId);
      const users: Array<{ id: string }> = await manager.query(
        'SELECT id FROM users WHERE phone = $1 AND role = $2 AND is_active = true FOR UPDATE',
        [request.phone, Role.CUSTOMER],
      );
      if (users.length === 0) {
        throw new ConflictException({ message: 'No active customer account has this phone number. Reject the request with NO_ACCOUNT_FOR_NUMBER.', details: { code: 'NO_ACTIVE_CUSTOMER_ACCOUNT' } });
      }
      deletedUserId = users[0].id;
      await this.assertNothingInFlight(manager, deletedUserId);
      uploadedFiles = await this.erase(manager, deletedUserId);
      await manager.query(
        `UPDATE account_deletion_requests SET status = 'COMPLETED', phone = $2, resolved_at = now(), resolved_by_user_id = $3, verification_method = $4, updated_at = now() WHERE id = $1`,
        [requestId, maskPhone(request.phone), actor.id, verificationMethod],
      );
    });
    await this.afterErase(deletedUserId, uploadedFiles, { actorUserId: actor.id, actorRole: actor.role, channel: 'web_request', ipAddress, requestId, verificationMethod });
    return (await this.dataSource.getRepository(AccountDeletionRequest).findOne({ where: { id: requestId } }))!;
  }

  async rejectRequest(actor: { id: string; role: string }, requestId: string, reason: AccountDeletionRejectionReason, ipAddress?: string | null): Promise<AccountDeletionRequest> {
    await this.dataSource.transaction(async (manager) => {
      const request = await this.lockPendingRequest(manager, requestId);
      await manager.query(
        `UPDATE account_deletion_requests SET status = 'REJECTED', phone = $2, resolved_at = now(), resolved_by_user_id = $3, rejection_reason = $4, updated_at = now() WHERE id = $1`,
        [requestId, maskPhone(request.phone), actor.id, reason],
      );
    });
    await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.ACCOUNT_DELETION_REQUEST_REJECTED, targetType: 'account_deletion_request', targetId: requestId, metadata: { reason }, ipAddress });
    return (await this.dataSource.getRepository(AccountDeletionRequest).findOne({ where: { id: requestId } }))!;
  }

  // ---- internals ------------------------------------------------------------------------------------------------------------------------

  private async lockPendingRequest(manager: EntityManager, requestId: string): Promise<{ id: string; phone: string }> {
    const rows: Array<{ id: string; phone: string; status: string }> = await manager.query('SELECT id, phone, status FROM account_deletion_requests WHERE id = $1 FOR UPDATE', [requestId]);
    if (rows.length === 0) throw new NotFoundException({ message: 'Deletion request not found.', details: { code: 'DELETION_REQUEST_NOT_FOUND' } });
    if (rows[0].status !== 'PENDING') throw new ConflictException({ message: 'This request has already been resolved.', details: { code: 'DELETION_REQUEST_NOT_PENDING' } });
    return rows[0];
  }

  private async executeDeletion(userId: string, context: { actorUserId: string; actorRole: string; channel: AccountDeletionChannel; ipAddress?: string | null }): Promise<void> {
    let uploadedFiles: string[] = [];
    await this.dataSource.transaction(async (manager) => {
      // Serialise with anything else that is changing this customer (a concurrent checkout re-reads the user row).
      const locked: Array<{ id: string }> = await manager.query('SELECT id FROM users WHERE id = $1 AND role = $2 AND is_active = true FOR UPDATE', [userId, Role.CUSTOMER]);
      if (locked.length === 0) throw new UnauthorizedException('Unable to delete this account.');
      await this.assertNothingInFlight(manager, userId);
      uploadedFiles = await this.erase(manager, userId);
    });
    await this.afterErase(userId, uploadedFiles, context);
  }

  /** After the erase committed: end the sign-in, remove the photo files (best effort), and put the deletion on record. */
  private async afterErase(
    userId: string,
    uploadedFiles: string[],
    context: { actorUserId: string; actorRole: string; channel: AccountDeletionChannel; ipAddress?: string | null; requestId?: string; verificationMethod?: string },
  ): Promise<void> {
    await this.refreshTokenStore.revoke(userId).catch((error) => this.logger.warn(`refresh revoke after deletion failed: ${(error as Error).message}`));
    const files = await this.uploads.removeStoredFiles(uploadedFiles);
    await this.audit.record({
      actorUserId: context.actorUserId,
      actorRole: context.actorRole,
      action: AdminAuditAction.CUSTOMER_ACCOUNT_DELETED,
      targetType: 'user',
      targetId: userId,
      ipAddress: context.ipAddress,
      metadata: {
        channel: context.channel,
        requestId: context.requestId ?? null,
        verificationMethod: context.verificationMethod ?? null,
        filesRemoved: files.removed,
        filesNotRemoved: files.failed,
      },
    });
  }

  private async assertNothingInFlight(manager: EntityManager, userId: string): Promise<void> {
    const inFlight = await manager.query(`SELECT 1 FROM orders WHERE customer_id = $1 AND status::text <> ALL($2::text[]) LIMIT 1`, [userId, TERMINAL_ORDER_STATUSES]);
    if (inFlight.length > 0) {
      throw new ConflictException({ message: 'You have an order in progress. You can delete your account after it is finished.', details: { code: 'ACCOUNT_HAS_ACTIVE_ORDERS' } });
    }
    const [{ balance }] = await manager.query('SELECT COALESCE(SUM(amount_delta_minor), 0)::bigint AS balance FROM wallet_transactions WHERE customer_id = $1', [userId]);
    if (Number(balance) !== 0) {
      throw new ConflictException({ message: 'Your Hatly wallet is not empty. Please contact Hatly support to settle it before deleting your account.', details: { code: 'ACCOUNT_HAS_WALLET_BALANCE' } });
    }
  }

  /** The erase itself, inside the caller's transaction. Returns the customer's uploaded-file references, removed after commit. */
  private async erase(manager: EntityManager, userId: string): Promise<string[]> {
    await manager.query('DELETE FROM device_tokens WHERE user_id = $1', [userId]);
    await manager.query('DELETE FROM customer_notifications WHERE customer_id = $1', [userId]);
    await manager.query('DELETE FROM favorites WHERE customer_id = $1', [userId]);
    await manager.query('DELETE FROM carts WHERE customer_id = $1', [userId]); // groups and items cascade
    await manager.query('DELETE FROM addresses WHERE customer_id = $1', [userId]);
    for (const table of ['vendor_ratings', 'product_ratings', 'driver_ratings']) {
      await manager.query(`UPDATE ${table} SET comment = NULL WHERE customer_id = $1`, [userId]); // the stars stay, the free text goes
    }
    await manager.query(
      `UPDATE orders SET delivery_address_snapshot = CASE WHEN delivery_address_snapshot IS NULL THEN NULL ELSE '{"line1":""}'::jsonb END, order_note = NULL, cancellation_reason = NULL
       WHERE customer_id = $1 AND status::text = ANY($2::text[])`,
      [userId, TERMINAL_ORDER_STATUSES],
    );
    // The customer's own words and photos on their (finished) orders, and where a Hatly Service errand went. Amounts, items, product
    // names and the place name stay (accounting / reimbursement records).
    await manager.query(
      `UPDATE order_items i SET free_text_description_snapshot = NULL, image_urls_snapshot = NULL, notes = NULL
       FROM order_vendor_segments s JOIN orders o ON o.id = s.order_id
       WHERE i.order_vendor_segment_id = s.id AND o.customer_id = $1 AND o.status::text = ANY($2::text[])`,
      [userId, TERMINAL_ORDER_STATUSES],
    );
    await manager.query(
      `UPDATE order_vendor_segments s SET vendor_note_snapshot = NULL, ad_hoc_pickup_latitude_snapshot = NULL, ad_hoc_pickup_longitude_snapshot = NULL,
              ad_hoc_destination_latitude_snapshot = NULL, ad_hoc_destination_longitude_snapshot = NULL
       FROM orders o WHERE o.id = s.order_id AND o.customer_id = $1 AND o.status::text = ANY($2::text[])`,
      [userId, TERMINAL_ORDER_STATUSES],
    );
    const uploadedFiles = await this.uploads.detachAllOwnedBy(userId, manager);
    // 'deleted-' + 11 hex = 19 characters (the column is varchar(20) and unique): a unique, obviously-not-a-number placeholder.
    await manager.query(
      `UPDATE users SET full_name = $2, phone = $3, email = NULL, password_hash = NULL, is_active = false, is_phone_verified = false, updated_at = now() WHERE id = $1`,
      [userId, DELETED_CUSTOMER_NAME, `deleted-${userId.replace(/-/g, '').slice(0, 11)}`],
    );
    return uploadedFiles;
  }
}
