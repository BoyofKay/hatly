import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import ms = require('ms');
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AllowWithoutMfa, CsrfMode } from '../../common/decorators/csrf-mfa.decorators';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthService, TokenPair } from './auth.service';
import { DashboardLoginDto } from './dto/dashboard-login.dto';
import { DASHBOARD_COOKIE, clearCookie, csrfTokenFor, newSessionId, parseCookies, serializeCookie } from './dashboard-session';
import { AdminAuditAction, AdminAuditService } from '../audit/admin-audit.service';
import { StaffMfaService, MFA_ROLES } from './mfa/staff-mfa.service';
import { UsersService } from '../users/users.service';

const STAFF_ROLES = [Role.VENDOR, Role.VENDOR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN];

/**
 * The dashboard's browser session (see dashboard-session.ts for the cookie + CSRF design). Tokens are NEVER in a response body: they are
 * set as HttpOnly cookies. The response carries only what the page may know — the signed-in staff member and the CSRF token to echo.
 * The bearer-token routes (`auth/password/login`, `auth/refresh`, …) are unchanged for the mobile apps and scripts.
 */
@ApiTags('auth-dashboard')
@Controller('auth/dashboard')
export class DashboardSessionController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly audit: AdminAuditService,
    private readonly mfa: StaffMfaService,
    private readonly users: UsersService,
  ) {}

  @Public()
  @CsrfMode('skip') // no session exists yet; the Origin check still applies
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: DashboardLoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    let tokens: TokenPair;
    try {
      tokens = await this.auth.loginStaffWithPassword(dto.phone, dto.password, { mfaCode: dto.mfaCode, ip: req.ip });
    } catch (error) {
      const code = (error as { getResponse?: () => { details?: { code?: string } } })?.getResponse?.()?.details?.code;
      if (code !== 'MFA_REQUIRED') {
        await this.audit.record({
          action: AdminAuditAction.DASHBOARD_LOGIN_FAILED,
          targetType: 'phone',
          targetId: `***${dto.phone.slice(-3)}`,
          outcome: 'FAILURE',
          metadata: { reason: code ?? 'INVALID_CREDENTIALS' },
          ipAddress: req.ip,
        });
      }
      throw error;
    }
    const user = await this.setSession(req, res, tokens, newSessionId());
    await this.audit.record({ actorUserId: user.id, actorRole: user.role, action: AdminAuditAction.DASHBOARD_LOGIN, targetType: 'user', targetId: user.id, ipAddress: req.ip });
    return { data: await this.sessionView(user, res) };
  }

  /** Rotates the session. Cookie-driven and public (the access cookie has expired); protected by SameSite + origin + the custom header. */
  @Public()
  @CsrfMode('custom-header')
  @AllowWithoutMfa()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookies = parseCookies(req.headers.cookie);
    const refreshToken = cookies[DASHBOARD_COOKIE.refresh];
    if (!refreshToken) throw new UnauthorizedException('Invalid or expired session.');
    let tokens: TokenPair;
    try {
      tokens = await this.auth.refresh(refreshToken);
    } catch (error) {
      this.clearCookies(req, res);
      throw error;
    }
    const sid = cookies[DASHBOARD_COOKIE.session] ?? newSessionId();
    const user = await this.setSession(req, res, tokens, sid);
    if (!STAFF_ROLES.includes(user.role as Role)) {
      this.clearCookies(req, res);
      throw new UnauthorizedException('Invalid or expired session.'); // a non-staff refresh token never yields a dashboard session
    }
    return { data: await this.sessionView(user, res) };
  }

  @Public()
  @CsrfMode('custom-header')
  @AllowWithoutMfa()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = parseCookies(req.headers.cookie)[DASHBOARD_COOKIE.refresh];
    if (refreshToken) {
      try {
        const payload = this.jwt.verify(refreshToken, { secret: this.config.get<string>('auth.refreshSecret'), algorithms: ['HS256'] }) as { sub: string; role: string };
        await this.auth.logout(payload.sub); // revokes the refresh session server-side, not just the browser's copy
        await this.audit.record({ actorUserId: payload.sub, actorRole: payload.role, action: AdminAuditAction.DASHBOARD_LOGOUT, targetType: 'user', targetId: payload.sub, ipAddress: req.ip });
      } catch {
        /* an invalid/expired cookie: nothing to revoke, the cookies are cleared below */
      }
    }
    this.clearCookies(req, res);
    return { message: 'Logged out.' };
  }

  /** The signed-in staff member (and a fresh CSRF token) — how the page learns who it is after a reload, without ever seeing a token. */
  @UseGuards(RolesGuard)
  @Roles(...STAFF_ROLES)
  @AllowWithoutMfa()
  @Get('me')
  async me(@CurrentUser() current: AuthenticatedUser, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.users.findById(current.id);
    if (!user || !user.isActive) throw new UnauthorizedException();
    const cookies = parseCookies(req.headers.cookie);
    if (!cookies[DASHBOARD_COOKIE.session]) throw new UnauthorizedException('Sign in again.'); // a bearer-only caller has no dashboard session
    return { data: await this.sessionView({ id: user.id, role: user.role, phone: user.phone, fullName: user.fullName }, res, cookies[DASHBOARD_COOKIE.session]) };
  }

  // ---- internals ---------------------------------------------------------------------------------------------------------------

  /** `Secure` on every deployed (strict) environment AND whenever the request really arrived over HTTPS (behind the configured proxy). */
  private cookieBase(req: Request) {
    const apiPrefix = this.config.get<string>('apiPrefix') ?? 'api/v1';
    const secure = (this.config.get<boolean>('http.strict') ?? false) || req.secure === true;
    return { secure, path: `/${apiPrefix.replace(/^\/|\/$/g, '')}` };
  }

  private async setSession(req: Request, res: Response, tokens: TokenPair, sessionId: string): Promise<{ id: string; role: string; phone: string; fullName?: string | null }> {
    const base = this.cookieBase(req);
    const accessSeconds = Math.floor(ms(this.config.get<string>('auth.accessExpiresIn') ?? '15m') / 1000);
    const idleSeconds = this.config.get<number>('auth.dashboardSessionSeconds') ?? 43_200;
    res.append('Set-Cookie', serializeCookie(DASHBOARD_COOKIE.access, tokens.accessToken, { ...base, maxAgeSeconds: accessSeconds }));
    res.append('Set-Cookie', serializeCookie(DASHBOARD_COOKIE.refresh, tokens.refreshToken, { ...base, path: `${base.path}/auth/dashboard`, maxAgeSeconds: idleSeconds }));
    res.append('Set-Cookie', serializeCookie(DASHBOARD_COOKIE.session, sessionId, { ...base, maxAgeSeconds: idleSeconds }));
    const payload = this.jwt.decode(tokens.accessToken) as { sub: string; role: string; phone: string };
    const row = await this.users.findById(payload.sub);
    return { id: payload.sub, role: payload.role, phone: payload.phone, fullName: row?.fullName ?? null };
  }

  private clearCookies(req: Request, res: Response): void {
    const base = this.cookieBase(req);
    res.append('Set-Cookie', clearCookie(DASHBOARD_COOKIE.access, base));
    res.append('Set-Cookie', clearCookie(DASHBOARD_COOKIE.refresh, { ...base, path: `${base.path}/auth/dashboard` }));
    res.append('Set-Cookie', clearCookie(DASHBOARD_COOKIE.session, base));
  }

  private async sessionView(user: { id: string; role: string; phone: string; fullName?: string | null }, res: Response, knownSessionId?: string) {
    const setCookie = res.getHeader('Set-Cookie');
    const fromThisResponse = (Array.isArray(setCookie) ? setCookie : []).map((c) => parseCookies(String(c).split(';')[0])[DASHBOARD_COOKIE.session]).find(Boolean);
    const sid = fromThisResponse ?? knownSessionId ?? '';
    const isAdmin = MFA_ROLES.includes(user.role as Role);
    const mfaEnabled = isAdmin ? await this.mfa.isEnabledFresh(user.id) : false;
    return {
      user: { id: user.id, role: user.role, phone: user.phone, fullName: user.fullName ?? null },
      csrfToken: csrfTokenFor(sid, this.config.get<string>('auth.accessSecret') ?? ''),
      mfa: { eligible: isAdmin, enabled: mfaEnabled, enrollmentRequired: isAdmin && !mfaEnabled && (this.config.get<boolean>('auth.adminMfaRequired') ?? false) },
    };
  }
}
