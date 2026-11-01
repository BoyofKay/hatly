import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { Public } from '../../../common/decorators/public.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Role } from '../../../common/enums/role.enum';
import { ExplicitlyAudited } from '../../audit/admin-mutation-audit.interceptor';
import { AccountDeletionService } from '../account-deletion.service';
import {
  AccountDeletionRequestDto,
  CompleteAccountDeletionRequestDto,
  ListAccountDeletionRequestsQueryDto,
  RejectAccountDeletionRequestDto,
  WebAccountDeletionDto,
} from './account-deletion.dto';

/**
 * PUBLIC account deletion for people who do not have (or cannot use) the app — Google Play's account-deletion policy requires a way to ask
 * for deletion outside the app. Served to the public page `/account-deletion` of the dashboard. Neither route accepts or returns personal
 * data beyond the phone number the requester typed; neither reveals whether a number has an account.
 */
@ApiTags('account-deletion')
@Controller('account-deletion')
export class PublicAccountDeletionController {
  constructor(private readonly accountDeletion: AccountDeletionService) {}

  /** Self-service: phone number + password, deleted at once. Irreversible and password-guessing → a very low ceiling, plus the per-account brake. */
  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('delete')
  @HttpCode(HttpStatus.OK)
  async delete(@Body() dto: WebAccountDeletionDto, @Req() req: Request) {
    await this.accountDeletion.deleteCustomerAccountWithCredentials(dto.phone, dto.password, req.ip);
    return { message: 'Your account has been deleted.' };
  }

  /** "I can't sign in": records a request for staff verification. Always the same 202 answer. */
  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('requests')
  @HttpCode(HttpStatus.ACCEPTED)
  async request(@Body() dto: AccountDeletionRequestDto) {
    return this.accountDeletion.requestDeletion(dto.phone);
  }
}

/** SUPER_ADMIN review of the "I can't sign in" requests. Deletion is irreversible, so it is not delegated through a grantable permission. */
@ApiTags('admin-account-deletion')
@Controller('admin/account-deletion-requests')
@UseGuards(RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminAccountDeletionRequestsController {
  constructor(private readonly accountDeletion: AccountDeletionService) {}

  @Get()
  async list(@Query() query: ListAccountDeletionRequestsQueryDto) {
    return { data: await this.accountDeletion.listRequests(query.status ?? 'PENDING') };
  }

  @Post(':id/complete')
  @ExplicitlyAudited()
  @HttpCode(HttpStatus.OK)
  async complete(@Param('id') id: string, @Body() dto: CompleteAccountDeletionRequestDto, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return { data: await this.accountDeletion.completeRequest(actor, id, dto.verificationMethod, req.ip) };
  }

  @Post(':id/reject')
  @ExplicitlyAudited()
  @HttpCode(HttpStatus.OK)
  async reject(@Param('id') id: string, @Body() dto: RejectAccountDeletionRequestDto, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return { data: await this.accountDeletion.rejectRequest(actor, id, dto.reason, req.ip) };
  }
}
