import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { Role } from '../../common/enums/role.enum';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  findByPhone(phone: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { phone } });
  }

  /**
   * PHASE I-A, CHUNK 5 addition (Driver password login). `passwordHash`
   * has `select: false` on the entity (never returned by default —
   * confirmed by inspection) — this is the one, explicit, narrowly-
   * scoped method that opts back in, used only by
   * `AuthService.loginDriverWithPassword`.
   *
   * Customer Authentication Modes addition: `isPhoneVerified` added to
   * the select list — needed by the passwordless-attach check
   * (AuthService) to read a Customer's current password/verification
   * state in one query rather than two.
   */
  findByPhoneWithPasswordHash(phone: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { phone },
      select: ['id', 'phone', 'fullName', 'role', 'passwordHash', 'isActive', 'isPhoneVerified', 'mustChangePassword'],
    });
  }

  /** The same narrow select as `findByPhoneWithPasswordHash`, by id — used to check a customer's CURRENT password. */
  findByIdWithPasswordHash(id: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { id },
      select: ['id', 'phone', 'fullName', 'role', 'passwordHash', 'isActive', 'isPhoneVerified', 'mustChangePassword'],
    });
  }

  findById(id: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { id } });
  }

  /** Customer-only name update. Never writes phone, role, auth state or orders. */
  async updateCustomerName(id: string, fullName: string): Promise<string> {
    const result = await this.usersRepository.update(
      { id, role: Role.CUSTOMER, isActive: true }, { fullName },
    );
    if (!result.affected) throw new UnauthorizedException('Customer account unavailable.');
    return fullName;
  }

  /**
   * M3b (Launch-Readiness Gap Audit, G-08) — Admin User/Permission
   * Management. Scoped to admin-tier roles only (ADMIN + SUPER_ADMIN) —
   * this is the roster a SUPER_ADMIN manages permissions against, never
   * a general user directory (Customers/Drivers/Vendor staff are
   * explicitly out of scope — see the audit's own G-10 exclusion).
   * `passwordHash` has `select: false` on the entity itself (see
   * User's own doc comment) — never fetched here, not just hidden
   * after the fact.
   */
  listAdmins(): Promise<User[]> {
    return this.usersRepository.find({ where: { role: In([Role.ADMIN, Role.SUPER_ADMIN]) }, order: { createdAt: 'ASC' } });
  }

  /**
   * The ONLY way a customer account is created. A persistent customer account ALWAYS has a password: `passwordHash` is
   * required, and an empty value is refused here as a last line of defence (callers validate and hash the password first), so
   * no code path can create a passwordless customer. Guests who only browse have no account at all. The phone starts
   * UNVERIFIED unless `phoneVerified` is passed — which only AuthService does, right after it has consumed a valid one-time
   * code for this exact phone (never from request data). `id` lets the caller store the session before this irreversible write
   * (see AuthService.registerCustomerWithPassword).
   */
  async createCustomer(params: { phone: string; fullName: string; passwordHash: string; id?: string; phoneVerified?: boolean }): Promise<User> {
    if (!params.passwordHash) {
      throw new Error('A customer account cannot be created without a password hash.');
    }
    const user = this.usersRepository.create({
      ...(params.id ? { id: params.id } : {}),
      phone: params.phone,
      fullName: params.fullName,
      passwordHash: params.passwordHash,
      role: Role.CUSTOMER,
      isPhoneVerified: params.phoneVerified === true,
    });
    return this.usersRepository.save(user);
  }

  /**
   * Sets `passwordHash` for a given user id (the authenticated password CHANGE flow in AuthService, which has already
   * verified the current password). Does NOT touch `isPhoneVerified` or any other field.
   */
  /** An open "forgot password" request for Hatly operations (one per account; a repeat keeps the first). */
  async recordPasswordResetRequest(userId: string): Promise<void> {
    await this.usersRepository.query(`INSERT INTO password_reset_requests (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]);
  }

  /** The person's OWN password change — it also ends a temporary password (must_change_password). */
  async setPasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.usersRepository.update({ id: userId }, { passwordHash, mustChangePassword: false });
  }

  /**
   * Customer Authentication Modes addition. Sets `isPhoneVerified =
   * true` — the ONLY method in this codebase that does so (see
   * AuthService.verifyOtpAndIssueTokens's own now-active call, and
   * the new authenticated post-login verification flow). Never
   * touches `passwordHash` or any other field.
   */
  async markPhoneVerified(userId: string): Promise<void> {
    await this.usersRepository.update({ id: userId }, { isPhoneVerified: true });
  }
}
