import { Injectable, UnauthorizedException } from '@nestjs/common';
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
}

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
    });
  }

  // Whatever is returned here becomes `request.user` (see CurrentUser decorator).
  async validate(payload: JwtPayload) {
    // Privileged and vendor staff are re-checked against the database on every request: deactivating an account (or removing it) ends
    // its access at once instead of when the 15-minute access token happens to expire. Customers and drivers (high-volume mobile
    // traffic, no admin power) keep the stateless check.
    if (STAFF_ROLES.includes(payload.role as Role)) {
      const user = await this.usersService.findById(payload.sub);
      if (!user || !user.isActive) throw new UnauthorizedException();
    }
    return { id: payload.sub, role: payload.role, phone: payload.phone };
  }
}
