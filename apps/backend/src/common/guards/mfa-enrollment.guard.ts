import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ALLOW_WITHOUT_MFA_KEY } from '../decorators/csrf-mfa.decorators';
import { MFA_ROLES, StaffMfaService } from '../../modules/auth/mfa/staff-mfa.service';

/**
 * The second-factor ENROLMENT policy (`DASHBOARD_ADMIN_MFA_REQUIRED=true`). While it is on, an ADMIN / SUPER_ADMIN with no enabled
 * authenticator is signed in but can reach nothing except the routes marked @AllowWithoutMfa (enrolling, and keeping/ending the session) —
 * for ANY credential (cookie or bearer), so it cannot be sidestepped by calling the API directly. Off (the default): no effect.
 */
@Injectable()
export class MfaEnrollmentGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
    private readonly mfa: StaffMfaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.config.get<boolean>('auth.adminMfaRequired')) return true;
    const user = context.switchToHttp().getRequest().user as { id: string; role: string } | undefined;
    if (!user || !MFA_ROLES.includes(user.role as never)) return true;
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_WITHOUT_MFA_KEY, [context.getHandler(), context.getClass()])) return true;
    if (await this.mfa.isEnabled(user.id)) return true;
    throw new ForbiddenException({ message: 'Two-factor authentication must be set up before this account can be used.', details: { code: 'MFA_ENROLLMENT_REQUIRED' } });
  }
}
