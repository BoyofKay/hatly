import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../../users/users.service';
import { Role } from '../../../common/enums/role.enum';
import { DASHBOARD_COOKIE, parseCookies } from '../dashboard-session';

const STAFF_ROLES: Role[] = [Role.ADMIN, Role.SUPER_ADMIN, Role.VENDOR, Role.VENDOR_MANAGER];

export interface JwtPayload {
  sub: string; // user id
  role: string;
  phone: string;
  /** Signed in with a temporary password set by Hatly staff (see AuthService.issueTokens). */
  pwc?: boolean;
}

/**
 * While a temporary password is in force, only these routes work (owner decision 2026-11-23: change it before anything else).
 * Matched on the path after the API prefix.
 */
const PASSWORD_CHANGE_ROUTES = [
  '/auth/customer/password',
  '/auth/customer/me',
  '/auth/driver/password',
  '/auth/dashboard/password',
  '/auth/dashboard/me',
  '/auth/dashboard/logout',
  '/auth/logout',
];

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      // A bearer header wins (mobile apps, scripts). The dashboard's HttpOnly access cookie is the fallback — see dashboard-session.ts.
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req) => parseCookies(req?.headers?.cookie)[DASHBOARD_COOKIE.access] ?? null,
      ]),
      ignoreExpiration: false,
      algorithms: ['HS256'], // only the HS256 tokens AuthService issues; never `none` or an unexpected algorithm
      secretOrKey: configService.get<string>('auth.accessSecret'),
      passReqToCallback: true,
    });
  }

  // Whatever is returned here becomes `request.user` (see CurrentUser decorator).
  async validate(req: Request, payload: JwtPayload) {
    // Privileged and vendor staff are re-checked against the database on every request: deactivating an account (or removing it) ends
    // its access at once instead of when the 15-minute access token happens to expire. Customers and drivers (high-volume mobile
    // traffic, no admin power) keep the stateless check.
    if (STAFF_ROLES.includes(payload.role as Role)) {
      const user = await this.usersService.findById(payload.sub);
      if (!user || !user.isActive) throw new UnauthorizedException();
    }
    if (payload.pwc) {
      const path = (req?.originalUrl ?? req?.url ?? '').split('?')[0];
      const allowed = PASSWORD_CHANGE_ROUTES.some((r) => path.endsWith(r));
      // Checked against the database: once the password is changed the same token works normally (no new sign-in needed).
      if (!allowed && (await this.usersService.findById(payload.sub))?.mustChangePassword === true) {
        throw new ForbiddenException({ message: 'Choose a new password first.', details: { code: 'PASSWORD_CHANGE_REQUIRED' } });
      }
    }
    return { id: payload.sub, role: payload.role, phone: payload.phone };
  }
}
