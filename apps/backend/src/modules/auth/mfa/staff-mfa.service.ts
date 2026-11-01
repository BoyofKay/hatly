import { BadRequestException, ConflictException, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { StaffMfaCredential } from './staff-mfa.entity';
import { base32Decode, base32Encode, generateSecret, matchTotp, otpauthUrl } from './totp';
import { LoginAttemptLimiter } from '../login-attempt-limiter';
import { AdminAuditAction, AdminAuditService } from '../../audit/admin-audit.service';
import { Role } from '../../../common/enums/role.enum';

export const MFA_ISSUER = 'Hatly Admin';
const RECOVERY_CODE_COUNT = 8;
/** Roles that may (and, when the policy is on, must) use an authenticator. */
export const MFA_ROLES: Role[] = [Role.ADMIN, Role.SUPER_ADMIN];

/**
 * TOTP second factor for privileged accounts. Rules: the secret is encrypted at rest (AES-256-GCM) and shown to the user ONCE at setup;
 * a code is accepted once (replay protection via the newest accepted step, updated atomically); wrong codes are rate-limited per account
 * (the same brake as passwords) regardless of source IP; recovery codes are single-use and shown once; and every change/use is audited
 * (never the secret, a code or a hash).
 */
@Injectable()
export class StaffMfaService {
  private readonly logger = new Logger(StaffMfaService.name);
  private readonly cache = new Map<string, { enabled: boolean; expires: number }>();

  constructor(
    @InjectRepository(StaffMfaCredential) private readonly repo: Repository<StaffMfaCredential>,
    private readonly config: ConfigService,
    private readonly limiter: LoginAttemptLimiter,
    private readonly audit: AdminAuditService,
  ) {}

  // ---- state -------------------------------------------------------------------------------------------------------------------

  /** Whether the account has a CONFIRMED authenticator (cached ~30 s for the per-request enrolment policy; changes clear it at once). */
  async isEnabled(userId: string): Promise<boolean> {
    const hit = this.cache.get(userId);
    if (hit && hit.expires > Date.now()) return hit.enabled;
    const row = await this.repo.findOne({ where: { userId } });
    const enabled = !!row?.enabledAt;
    this.cache.set(userId, { enabled, expires: Date.now() + 30_000 });
    return enabled;
  }

  /** Uncached: the sign-in decision must see an authenticator the instant it is enabled or removed. */
  async isEnabledFresh(userId: string): Promise<boolean> {
    this.cache.delete(userId);
    return this.isEnabled(userId);
  }

  // ---- enrolment ---------------------------------------------------------------------------------------------------------------

  async beginSetup(user: { id: string; phone: string; role: string }, ip?: string): Promise<{ secret: string; otpauthUrl: string }> {
    this.assertEligible(user.role);
    const existing = await this.repo.findOne({ where: { userId: user.id } });
    if (existing?.enabledAt) throw new ConflictException({ message: 'An authenticator is already enabled. Disable it first to enrol a new one.', details: { code: 'MFA_ALREADY_ENABLED' } });
    const secret = generateSecret();
    const encrypted = this.encrypt(secret);
    if (existing) {
      existing.secretEncrypted = encrypted;
      existing.lastUsedStep = 0;
      await this.repo.save(existing);
    } else {
      await this.repo.save(this.repo.create({ userId: user.id, secretEncrypted: encrypted, enabledAt: null, lastUsedStep: 0, recoveryCodeHashes: [] }));
    }
    await this.audit.record({ actorUserId: user.id, actorRole: user.role, action: AdminAuditAction.MFA_SETUP_STARTED, targetType: 'user', targetId: user.id, ipAddress: ip });
    const base32 = base32Encode(secret);
    return { secret: base32, otpauthUrl: otpauthUrl({ secretBase32: base32, accountName: user.phone, issuer: MFA_ISSUER }) };
  }

  /** Confirms enrolment with a first valid code; returns the single-use recovery codes (shown once). */
  async enable(user: { id: string; role: string }, code: string, ip?: string): Promise<{ recoveryCodes: string[] }> {
    this.assertEligible(user.role);
    const row = await this.repo.findOne({ where: { userId: user.id } });
    if (!row) throw new BadRequestException({ message: 'Start the setup first.', details: { code: 'MFA_SETUP_REQUIRED' } });
    if (row.enabledAt) throw new ConflictException({ message: 'An authenticator is already enabled.', details: { code: 'MFA_ALREADY_ENABLED' } });
    await this.limiter.assertAllowed(this.limiterKey(user.id));
    const step = matchTotp(this.decrypt(row.secretEncrypted, user.id), code, Date.now());
    if (step === null) {
      await this.limiter.recordFailure(this.limiterKey(user.id));
      await this.audit.record({ actorUserId: user.id, actorRole: user.role, action: AdminAuditAction.MFA_VERIFY_FAILED, targetType: 'user', targetId: user.id, outcome: 'FAILURE', metadata: { stage: 'enrol' }, ipAddress: ip });
      throw new UnauthorizedException({ message: 'That code is not valid.', details: { code: 'MFA_CODE_INVALID' } });
    }
    await this.limiter.clear(this.limiterKey(user.id));
    const { codes, hashes } = this.newRecoveryCodes();
    row.enabledAt = new Date();
    row.lastUsedStep = step;
    row.recoveryCodeHashes = hashes;
    await this.repo.save(row);
    this.cache.delete(user.id);
    await this.audit.record({ actorUserId: user.id, actorRole: user.role, action: AdminAuditAction.MFA_ENABLED, targetType: 'user', targetId: user.id, ipAddress: ip });
    return { recoveryCodes: codes };
  }

  /** Disabling needs the account password (checked by the caller) AND a current code or recovery code. */
  async disable(user: { id: string; role: string }, code: string, ip?: string): Promise<void> {
    const row = await this.repo.findOne({ where: { userId: user.id } });
    if (!row?.enabledAt) throw new BadRequestException({ message: 'No authenticator is enabled.', details: { code: 'MFA_NOT_ENABLED' } });
    await this.verifyLoginCode(user, code, ip, 'disable');
    await this.repo.delete({ userId: user.id });
    this.cache.delete(user.id);
    await this.audit.record({ actorUserId: user.id, actorRole: user.role, action: AdminAuditAction.MFA_DISABLED, targetType: 'user', targetId: user.id, ipAddress: ip });
  }

  /**
   * Break-glass: a SUPER_ADMIN removes ANOTHER admin's authenticator (lost device AND recovery codes). Audited with who did it to whom; the
   * caller revokes the target's sessions. The account is then password-only until the person enrols again (or the policy forces them to).
   */
  async resetForUser(actor: { id: string; role: string }, targetUserId: string, targetRole: string, ip?: string): Promise<boolean> {
    if (!MFA_ROLES.includes(targetRole as Role)) throw new BadRequestException({ message: 'An authenticator is only used by admin accounts.', details: { code: 'MFA_NOT_APPLICABLE' } });
    const result = await this.repo.delete({ userId: targetUserId });
    this.cache.delete(targetUserId);
    const removed = (result.affected ?? 0) > 0;
    await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.MFA_RESET_BY_ADMIN, targetType: 'user', targetId: targetUserId, metadata: { hadAuthenticator: removed }, ipAddress: ip });
    return removed;
  }

  // ---- verification (sign-in) --------------------------------------------------------------------------------------------------

  /**
   * Accepts a current authenticator code OR an unused recovery code. Throws 401 `MFA_CODE_INVALID` otherwise (and counts the failure
   * against the account). A time step can be used once; a recovery code is consumed.
   */
  async verifyLoginCode(user: { id: string; role: string }, rawCode: string, ip?: string, stage = 'login'): Promise<void> {
    const code = (rawCode ?? '').trim();
    await this.limiter.assertAllowed(this.limiterKey(user.id));
    const row = await this.repo.findOne({ where: { userId: user.id } });
    if (!row?.enabledAt) throw new UnauthorizedException({ message: 'Invalid credentials.', details: { code: 'MFA_CODE_INVALID' } });

    if (/^\d{6}$/.test(code)) {
      const step = matchTotp(this.decrypt(row.secretEncrypted, user.id), code, Date.now());
      if (step !== null) {
        // Atomic replay guard: only one request can advance last_used_step past this step.
        const advanced = await this.repo
          .createQueryBuilder()
          .update(StaffMfaCredential)
          .set({ lastUsedStep: step })
          .where('user_id = :userId AND last_used_step < :step', { userId: user.id, step })
          .execute();
        if ((advanced.affected ?? 0) > 0) {
          await this.limiter.clear(this.limiterKey(user.id));
          return;
        }
      }
    } else if (/^[0-9a-f]{20}$/.test(code.toLowerCase().replace(/-/g, ''))) {
      const hash = this.hashRecovery(code);
      if (row.recoveryCodeHashes.includes(hash)) {
        const remaining = row.recoveryCodeHashes.filter((h) => h !== hash);
        // Compare-and-set so two concurrent uses of the same recovery code cannot both succeed.
        const consumed = await this.repo
          .createQueryBuilder()
          .update(StaffMfaCredential)
          .set({ recoveryCodeHashes: remaining })
          .where('user_id = :userId AND recovery_code_hashes @> :one::jsonb', { userId: user.id, one: JSON.stringify([hash]) })
          .execute();
        if ((consumed.affected ?? 0) > 0) {
          await this.limiter.clear(this.limiterKey(user.id));
          await this.audit.record({ actorUserId: user.id, actorRole: user.role, action: AdminAuditAction.MFA_RECOVERY_CODE_USED, targetType: 'user', targetId: user.id, metadata: { remaining: remaining.length }, ipAddress: ip });
          return;
        }
      }
    }
    await this.limiter.recordFailure(this.limiterKey(user.id));
    await this.audit.record({ actorUserId: user.id, actorRole: user.role, action: AdminAuditAction.MFA_VERIFY_FAILED, targetType: 'user', targetId: user.id, outcome: 'FAILURE', metadata: { stage }, ipAddress: ip });
    throw new UnauthorizedException({ message: 'Invalid credentials.', details: { code: 'MFA_CODE_INVALID' } });
  }

  // ---- internals ---------------------------------------------------------------------------------------------------------------

  private assertEligible(role: string): void {
    if (!MFA_ROLES.includes(role as Role)) throw new BadRequestException({ message: 'An authenticator is only used by admin accounts.', details: { code: 'MFA_NOT_APPLICABLE' } });
  }

  private limiterKey(userId: string): string {
    return `mfa:${userId}`;
  }

  private key(): Buffer {
    const dedicated = this.config.get<string>('auth.mfaEncryptionKey');
    if (dedicated) {
      const raw = Buffer.from(dedicated, 'base64');
      if (raw.length !== 32) throw new Error('MFA_ENCRYPTION_KEY must be 32 bytes, base64-encoded.');
      return raw;
    }
    const refreshSecret = this.config.get<string>('auth.refreshSecret') ?? '';
    return Buffer.from(hkdfSync('sha256', refreshSecret, 'hatly-mfa', 'staff-mfa-secret-encryption', 32));
  }

  private encrypt(plain: Buffer): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
  }

  /**
   * Fails SAFE when a stored secret cannot be decrypted — the encryption key changed (MFA_ENCRYPTION_KEY introduced/changed after
   * enrolment, or JWT_REFRESH_SECRET rotated without a dedicated key; see docs/security/mfa-rollout.md) or the row is corrupt. That is
   * an operator problem, not a wrong code: the request is refused with 503 `MFA_UNAVAILABLE` (never a 500, never a bypass, never counted
   * against the account's brake), recovery codes keep working (they are hashes), and an operational error is logged without any secret.
   */
  private decrypt(stored: string, userId?: string): Buffer {
    try {
      const [version, iv, tag, body] = stored.split('.');
      if (version !== 'v1') throw new Error('Unknown MFA secret format');
      const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]);
    } catch (error) {
      if ((error as Error).message?.startsWith('MFA_ENCRYPTION_KEY must be')) throw error; // a malformed key is a boot/config error
      this.logger.error(
        `mfa.secret_undecryptable user=${userId ?? 'unknown'}: the stored authenticator secret cannot be decrypted with the configured key ` +
          '(MFA_ENCRYPTION_KEY changed/introduced after enrolment, or JWT_REFRESH_SECRET rotated without a dedicated key). Restore the original ' +
          'key, or have the admin sign in with a recovery code and re-enrol (or a SUPER_ADMIN reset). See docs/security/mfa-rollout.md.',
      );
      throw new ServiceUnavailableException({
        message: 'Two-factor verification is temporarily unavailable. Use a recovery code, or contact a super admin.',
        details: { code: 'MFA_UNAVAILABLE' },
      });
    }
  }

  private newRecoveryCodes(): { codes: string[]; hashes: string[] } {
    const codes: string[] = [];
    for (let i = 0; i < RECOVERY_CODE_COUNT; i += 1) {
      const hex = randomBytes(10).toString('hex'); // 80 bits
      codes.push(`${hex.slice(0, 5)}-${hex.slice(5, 10)}-${hex.slice(10, 15)}-${hex.slice(15, 20)}`);
    }
    return { codes, hashes: codes.map((c) => this.hashRecovery(c)) };
  }

  private hashRecovery(code: string): string {
    return createHash('sha256').update(code.toLowerCase().replace(/-/g, '')).digest('hex');
  }
}
