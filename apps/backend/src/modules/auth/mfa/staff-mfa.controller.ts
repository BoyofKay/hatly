import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, NotFoundException, Param, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import * as bcrypt from 'bcrypt';
import type { Request } from 'express';
import { AllowWithoutMfa } from '../../../common/decorators/csrf-mfa.decorators';
import { AuthenticatedUser, CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { UsersService } from '../../users/users.service';
import { MfaCodeDto, MfaDisableDto } from '../dto/dashboard-login.dto';
import { StaffMfaService } from './staff-mfa.service';
import { AuthService } from '../auth.service';
import { ExplicitlyAudited } from '../../audit/admin-mutation-audit.interceptor';

/** Enrolment and removal of the signed-in ADMIN / SUPER_ADMIN's own authenticator. The owner is always the caller (never a request field). */
@Controller('auth/mfa')
@UseGuards(RolesGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
@AllowWithoutMfa()
export class StaffMfaController {
  constructor(
    private readonly mfa: StaffMfaService,
    private readonly users: UsersService,
  ) {}

  @Get('status')
  async status(@CurrentUser() user: AuthenticatedUser) {
    return { data: { enabled: await this.mfa.isEnabledFresh(user.id) } };
  }

  /** Starts (or restarts, while still unconfirmed) enrolment: returns the secret and the otpauth URL ONCE, to be scanned. */
  @Post('setup')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async setup(@CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return { data: await this.mfa.beginSetup({ id: user.id, phone: user.phone ?? '', role: user.role }, req.ip) };
  }

  /** Confirms enrolment with the first code; returns the single-use recovery codes ONCE. */
  @Post('enable')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async enable(@CurrentUser() user: AuthenticatedUser, @Body() dto: MfaCodeDto, @Req() req: Request) {
    return { data: await this.mfa.enable(user, dto.code, req.ip) };
  }

  @Post('disable')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async disable(@CurrentUser() user: AuthenticatedUser, @Body() dto: MfaDisableDto, @Req() req: Request) {
    const row = await this.users.findByIdWithPasswordHash(user.id);
    if (!row?.passwordHash || !(await bcrypt.compare(dto.password, row.passwordHash))) {
      throw new UnauthorizedException({ message: 'Invalid credentials.', details: { code: 'INVALID_PASSWORD' } });
    }
    await this.mfa.disable(user, dto.code, req.ip);
    return { message: 'Authenticator removed.' };
  }
}

/**
 * Break-glass for a locked-out admin (lost device and recovery codes): only a SUPER_ADMIN, never on themselves (they use the normal
 * disable, which proves possession), always audited, and it ends the target's sessions so a stolen session cannot outlive the reset.
 */
@Controller('admin/users/:userId/mfa')
@UseGuards(RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class StaffMfaAdminController {
  constructor(
    private readonly mfa: StaffMfaService,
    private readonly users: UsersService,
    private readonly auth: AuthService,
  ) {}

  @Delete()
  @ExplicitlyAudited()
  @HttpCode(HttpStatus.OK)
  async reset(@Param('userId') userId: string, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    if (userId === actor.id) throw new BadRequestException({ message: 'Use the normal "turn off" for your own account.', details: { code: 'MFA_RESET_SELF' } });
    const target = await this.users.findById(userId);
    if (!target) throw new NotFoundException('User not found.');
    const removed = await this.mfa.resetForUser(actor, target.id, target.role, req.ip);
    await this.auth.logout(target.id); // ends the target's refresh session
    return { data: { removed } };
  }
}
