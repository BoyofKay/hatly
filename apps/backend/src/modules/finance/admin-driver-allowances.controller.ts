import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { DriverAllowanceService } from './driver-allowance.service';

class HandAllowanceDto {
  @Type(() => Number) @IsInt() @Min(1) amountMinor: number;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}
class CancelAllowanceDto {
  @IsString() @MaxLength(200) reason: string;
}

/** Daily driver allowance (owner decision 2026-11-23) — the office that closes couriers hands it out and takes it back. */
@ApiTags('admin-driver-allowances')
@Controller('admin')
export class AdminDriverAllowancesController {
  constructor(private readonly allowances: DriverAllowanceService) {}

  @Get('drivers/:id/allowances')
  @RequiresPermission(Permission.CLOSE_DRIVER_SETTLEMENTS)
  async list(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.allowances.list(id) };
  }

  @Post('drivers/:id/allowances')
  @RequiresPermission(Permission.CLOSE_DRIVER_SETTLEMENTS)
  async hand(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: HandAllowanceDto) {
    return { data: await this.allowances.hand(id, dto.amountMinor, user.id, dto.note) };
  }

  @Post('driver-allowances/:id/return')
  @RequiresPermission(Permission.CLOSE_DRIVER_SETTLEMENTS)
  async returned(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.allowances.markReturned(id, user.id) };
  }

  @Post('driver-allowances/:id/cancel')
  @RequiresPermission(Permission.CLOSE_DRIVER_SETTLEMENTS)
  async cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelAllowanceDto) {
    return { data: await this.allowances.cancel(id, user.id, dto.reason) };
  }
}
