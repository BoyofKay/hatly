import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { DeviceToken } from './entities/device-token.entity';

/**
 * Driver Push Notifications. `userId` is ALWAYS supplied by the
 * caller from the authenticated session (@CurrentUser(), never a
 * request body field) — see DeviceTokensController. This service
 * itself never trusts a client-supplied user id.
 */
@Injectable()
export class DeviceTokensService {
  constructor(
    @InjectRepository(DeviceToken)
    private readonly deviceTokensRepository: Repository<DeviceToken>,
  ) {}

  /**
   * Upsert by token — CONFIRMED: re-registering the same token (a
   * Driver reopening the app, or a token-refresh event resending the
   * same value) updates the existing row's `userId`/`platform` and
   * reactivates it if it had been deactivated, rather than creating a
   * duplicate row. Re-associating `userId` here is also what makes
   * login/registration "re-establish the authenticated Driver
   * ownership correctly" (Section 7) — if a stale token somehow still
   * belonged to a different user, a fresh registration call
   * immediately corrects that.
   */
  async registerToken(params: { userId: string; token: string; platform: string }): Promise<void> {
    const existing = await this.deviceTokensRepository.findOne({ where: { token: params.token } });
    if (existing) {
      existing.userId = params.userId;
      existing.platform = params.platform;
      existing.isActive = true;
      await this.deviceTokensRepository.save(existing);
      return;
    }
    await this.deviceTokensRepository.save(
      this.deviceTokensRepository.create({
        userId: params.userId,
        token: params.token,
        platform: params.platform,
        isActive: true,
      }),
    );
  }

  async getActiveTokensForUser(userId: string): Promise<string[]> {
    const rows = await this.deviceTokensRepository.find({ where: { userId, isActive: true } });
    return rows.map((r) => r.token);
  }

  /**
   * CONFIRMED: deactivates ONLY the specific tokens reported invalid
   * by the provider — never a blanket clear of every token for a
   * user. A no-op if the list is empty (the common case).
   */
  async deactivateTokens(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;
    await this.deviceTokensRepository.update({ token: In(tokens) }, { isActive: false });
  }
}
