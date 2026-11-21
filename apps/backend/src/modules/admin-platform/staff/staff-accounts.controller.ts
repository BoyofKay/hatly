import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ArrayMaxSize, IsArray, IsEmail, IsIn, IsOptional, IsPhoneNumber, IsString, MaxLength, MinLength } from 'class-validator';
import { AuthenticatedUser, CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { STAFF_LEVELS, StaffAccountsService, StaffLevel } from './staff-accounts.service';

class CreateStaffDto {
  @IsString() @MinLength(2) @MaxLength(150) fullName: string;
  @IsPhoneNumber() phone: string;
  @IsOptional() @IsEmail() @MaxLength(255) email?: string;
  @IsString() @MinLength(10) @MaxLength(128) password: string;
  @IsIn(STAFF_LEVELS) level: StaffLevel;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) permissions?: string[];
  /** Optional preset (e.g. OPS_TEAM, OPS_SUPERVISOR, ADMIN_GENERAL) whose permissions are added to `permissions`. */
  @IsOptional() @IsString() @MaxLength(39) templateKey?: string;
}

class UpdateStaffDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(150) fullName?: string;
  @IsOptional() @IsPhoneNumber() phone?: string;
  @IsOptional() @IsEmail() @MaxLength(255) email?: string;
  @IsOptional() @IsIn(STAFF_LEVELS) level?: StaffLevel;
}

class ResetStaffPasswordDto {
  @IsString() @MinLength(10) @MaxLength(128) newPassword: string;
}

class SetStaffPermissionsDto {
  @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) permissions: string[];
}

/**
 * Staff accounts (Super admin > Admin > Operations supervisor > Operations team). Open to ADMIN and SUPER_ADMIN by role; every action
 * is then decided by StaffAccountsService (MANAGE_STAFF_ACCOUNTS + strictly-below-your-level + only-permissions-you-hold). Every mutation
 * is recorded by the global admin mutation audit interceptor.
 */
@ApiTags('admin-staff')
@Controller('admin/staff')
@UseGuards(RolesGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
export class StaffAccountsController {
  constructor(private readonly staff: StaffAccountsService) {}

  @Get()
  async list(@CurrentUser() actor: AuthenticatedUser) {
    const [data, creatableLevels, options] = await Promise.all([this.staff.list(actor), this.staff.creatableLevels(actor), this.staff.formOptions(actor)]);
    return { data, meta: { creatableLevels, ...options } };
  }

  @Get(':id')
  async get(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.staff.get(actor, id) };
  }

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateStaffDto) {
    return { data: await this.staff.create(actor, dto) };
  }

  @Patch(':id')
  async update(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStaffDto) {
    return { data: await this.staff.update(actor, id, dto) };
  }

  @Patch(':id/activate')
  async activate(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.staff.setActive(actor, id, true) };
  }

  @Patch(':id/deactivate')
  async deactivate(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.staff.setActive(actor, id, false) };
  }

  @Post(':id/reset-password')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async resetPassword(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResetStaffPasswordDto) {
    await this.staff.resetPassword(actor, id, dto.newPassword);
    return { message: 'Password reset. The account must sign in again with the new password.' };
  }

  @Put(':id/permissions')
  async setPermissions(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetStaffPermissionsDto) {
    return { data: await this.staff.setPermissions(actor, id, dto.permissions) };
  }

  @Delete(':id')
  async remove(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.staff.remove(actor, id);
    return { message: 'Staff account deleted.' };
  }
}
