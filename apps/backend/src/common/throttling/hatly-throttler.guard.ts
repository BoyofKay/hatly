import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectThrottlerOptions, InjectThrottlerStorage, ThrottlerGuard, ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';

/**
 * The app-wide throttler guard (M5 Batch 4): identical to @nestjs/throttler's, except WHO is limited.
 *
 * The default tracker is the client IP. Behind one office/family router every tester shares an IP, so the IP is a poor identity
 * for logged-in traffic. The limit therefore follows the USER whenever the request is authenticated:
 *  - on protected routes JwtAuthGuard has already run (see app.module.ts) and set `req.user`;
 *  - on @Public() routes (search, browsing) JwtAuthGuard is skipped, so a bearer token, if present, is verified here with the
 *    exact rules of the real JWT strategy (HS256 only, same secret, expiry enforced) — used ONLY to choose the bucket, never to
 *    authorise anything.
 * Anonymous traffic (browsing without a session, login, OTP) is keyed by IP. A bad/expired/forged token is simply anonymous, so
 * attaching one cannot escape IP-based limiting.
 */
@Injectable()
export class HatlyThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {
    super(options, storageService, reflector);
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const userId = this.userIdOf(req);
    return userId ? `u:${userId}` : `ip:${req?.ip ?? 'unknown'}`;
  }

  private userIdOf(req: Record<string, any>): string | null {
    const fromGuard = req?.user?.id;
    if (typeof fromGuard === 'string' && fromGuard.length > 0) return fromGuard;
    const header = req?.headers?.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
    try {
      const payload = this.jwtService.verify<{ sub?: unknown }>(header.slice(7), {
        secret: this.config.get<string>('auth.accessSecret'),
        algorithms: ['HS256'],
      });
      return typeof payload.sub === 'string' && payload.sub.length > 0 ? payload.sub : null;
    } catch {
      return null;
    }
  }
}
