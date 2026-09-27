import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
      select: ['id', 'phone', 'fullName', 'role', 'passwordHash', 'isActive', 'isPhoneVerified'],
    });
  }

  findById(id: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { id } });
  }

  async createCustomer(params: {
    phone: string;
    fullName: string;
    passwordHash?: string;
  }): Promise<User> {
    const user = this.usersRepository.create({
      phone: params.phone,
      fullName: params.fullName,
      passwordHash: params.passwordHash,
      role: Role.CUSTOMER,
    });
    return this.usersRepository.save(user);
  }

  /**
   * Customer Authentication Modes addition. Generic — sets/overwrites
   * `passwordHash` for a given user id. Used by both the passwordless-
   * attach flow and the authenticated password setup/change flow
   * (AuthService). Does NOT touch `isPhoneVerified` or any other
   * field — a plain, minimal, single-column update, matching this
   * class's existing convention of small, purpose-specific methods.
   */
  async setPasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.usersRepository.update({ id: userId }, { passwordHash });
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
