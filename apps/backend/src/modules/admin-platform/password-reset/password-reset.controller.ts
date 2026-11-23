import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { Public } from '../../../common/decorators/public.decorator';
import { CsrfMode } from '../../../common/decorators/csrf-mfa.decorators';
import { AuthenticatedUser, CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequiresAnyPermission } from '../../permissions/decorators/requires-permission.decorator';
import { Permission } from '../../permissions/permission.enum';
import { PasswordResetService } from './password-reset.service';

class ResetRequestDto {
  @IsString() @MinLength(6) @MaxLength(20) phone: string;
}
class ResetCompleteDto {
  @IsString() @MinLength(6) @MaxLength(20) phone: string;
  @IsString() @MinLength(1) @MaxLength(64) tempPassword: string;
  @IsString() @MinLength(1) @MaxLength(128) newPassword: string;
}

const ANSWER = 'If this number has a Hatly account, your request reached Hatly operations. They will give you a temporary password.';

/** Public side of the request-based "Forgot password?" (every app and the dashboard). */
@ApiTags('auth-password-reset')
@Controller('auth/password-reset')
export class PasswordResetPublicController {
  constructor(private readonly resets: PasswordResetService) {}

  @Public()
  @CsrfMode('skip') // no session is involved (a leftover sign-in cookie must not block it); the origin check still applies
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('request')
  @HttpCode(HttpStatus.ACCEPTED)
  async request(@Body() dto: ResetRequestDto) {
    await this.resets.request(dto.phone);
    return { message: ANSWER };
  }

  @Public()
  @CsrfMode('skip')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('complete')
  @HttpCode(HttpStatus.OK)
  async complete(@Body() dto: ResetCompleteDto) {
    await this.resets.complete(dto.phone, dto.tempPassword, dto.newPassword);
    return { message: 'Your password was changed. Sign in with it now.' };
  }
}

/** Admin side: the open requests (yellow notice + page), issue a temporary password, dismiss. Level/permission checked per request. */
@ApiTags('admin-password-reset')
@Controller('admin/password-reset-requests')
export class PasswordResetAdminController {
  constructor(private readonly resets: PasswordResetService) {}

  @Get()
  @RequiresAnyPermission(Permission.MANAGE_CUSTOMERS, Permission.MANAGE_DRIVERS, Permission.CHANGE_DRIVER_ONLINE_STATUS, Permission.MANAGE_VENDOR_STAFF, Permission.MANAGE_STAFF_ACCOUNTS)
  async list(@CurrentUser() user: AuthenticatedUser, @Query('actionable') actionable?: string) {
    return { data: await this.resets.list(user, actionable === 'true') };
  }

  @Post(':id/issue')
  @RequiresAnyPermission(Permission.MANAGE_CUSTOMERS, Permission.MANAGE_DRIVERS, Permission.CHANGE_DRIVER_ONLINE_STATUS, Permission.MANAGE_VENDOR_STAFF, Permission.MANAGE_STAFF_ACCOUNTS)
  async issue(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.resets.issue(user, id) };
  }

  @Post(':id/dismiss')
  @HttpCode(204)
  @RequiresAnyPermission(Permission.MANAGE_CUSTOMERS, Permission.MANAGE_DRIVERS, Permission.CHANGE_DRIVER_ONLINE_STATUS, Permission.MANAGE_VENDOR_STAFF, Permission.MANAGE_STAFF_ACCOUNTS)
  async dismiss(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.resets.dismiss(user, id);
  }
}
