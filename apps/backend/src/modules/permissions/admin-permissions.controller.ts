import { Body, Controller, Delete, Get, NotFoundException, Param, ParseEnumPipe, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PermissionsService } from './permissions.service';
import { GrantPermissionDto } from './dto/grant-permission.dto';
import { Permission } from './permission.enum';
import { UsersService } from '../users/users.service';

/**
 * Granting/revoking permissions is gated by ROLE (@Roles(SUPER_ADMIN)),
 * not by a Permission itself — deliberately, to avoid a chicken-and-egg
 * problem (you'd need a permission to grant permissions). This matches
 * the approved requirement directly: "SUPER_ADMIN decides which
 * permissions each Admin receives" — an authority tied to the
 * SUPER_ADMIN role itself, not delegable to a permission grant.
 *
 * Every OTHER admin-facing controller in the system should prefer
 * @RequiresPermission over @Roles(ADMIN) — this controller is the one
 * deliberate exception, and the reasoning above is why.
 */
@ApiTags('admin-permissions')
@Controller('admin/users/:userId/permissions')
@UseGuards(RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminPermissionsController {
  constructor(
    private readonly permissionsService: PermissionsService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  async list(@Param('userId') userId: string) {
    await this.assertUserExistsAndIsAdmin(userId);
    const permissions = await this.permissionsService.listPermissions(userId);
    return { data: permissions };
  }

  @Post()
  async grant(
    @Param('userId') userId: string,
    @Body() dto: GrantPermissionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    await this.assertUserExistsAndIsAdmin(userId);
    const grant = await this.permissionsService.grant(userId, dto.permission, actor.id);
    return { data: grant };
  }

  @Delete(':permission')
  async revoke(
    @Param('userId') userId: string,
    @Param('permission', new ParseEnumPipe(Permission)) permission: Permission,
  ) {
    await this.assertUserExistsAndIsAdmin(userId);
    await this.permissionsService.revoke(userId, permission);
    return { message: 'Permission revoked.' };
  }

  private async assertUserExistsAndIsAdmin(userId: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    this.permissionsService.assertGrantableRole(user.role);
  }
}
