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
  async grant(@Param('userId') userId: string, @Body() dto: GrantPermissionDto, @CurrentUser() actor: AuthenticatedUser) {
    await this.assertUserExistsAndIsAdmin(userId);
    const grant = await this.permissionsService.grant(userId, dto.permission, actor.id);
    return { data: grant };
  }

  @Delete(':permission')
  async revoke(@Param('userId') userId: string, @Param('permission', new ParseEnumPipe(Permission)) permission: Permission) {
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

/**
 * M3b (Launch-Readiness Gap Audit, G-08). Same SUPER_ADMIN-only gate as
 * `AdminPermissionsController` above, and for the exact same reason —
 * this is the roster that controller's own grant/revoke endpoints act
 * on, so nobody who couldn't reach those endpoints needs to reach this
 * one either. A safe, purpose-built view: `User.passwordHash` is never
 * selected (the entity's own `select: false` — see User's doc comment)
 * and no other secret/token field exists on this entity at all.
 */
@ApiTags('admin-users')
@Controller('admin/users')
@UseGuards(RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminUsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly permissionsService: PermissionsService,
  ) {}

  @Get()
  async list() {
    const admins = await this.usersService.listAdmins();
    const data = await Promise.all(
      admins.map(async (admin) => ({
        id: admin.id,
        fullName: admin.fullName,
        phone: admin.phone,
        role: admin.role,
        isActive: admin.isActive,
        createdAt: (admin as any).createdAt,
        // SUPER_ADMIN bypasses every permission check by role alone (see PermissionsGuard) — it
        // never holds explicit grants, so this is always `[]` for one; never fabricated as "all".
        permissions: admin.role === Role.SUPER_ADMIN ? [] : await this.permissionsService.listPermissions(admin.id),
      })),
    );
    return { data };
  }
}

/**
 * M3b (Launch-Readiness Gap Audit, G-08). The Permission enum IS the
 * source of truth (permission.enum.ts's own doc comment) — this just
 * exposes it over HTTP so the Dashboard never hardcodes a second,
 * divergent list of permission names. Read-only, no grant/revoke
 * capability here — those remain on `AdminPermissionsController`.
 */
@ApiTags('admin-permissions-catalog')
@Controller('admin/permissions')
@UseGuards(RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminPermissionCatalogController {
  @Get()
  list() {
    return { data: Object.values(Permission) };
  }
}

/**
 * The CALLING admin's own effective permissions, so the Dashboard can decide which controls to enable instead of letting the
 * admin click into a 403. Display aid only — `PermissionsGuard` still enforces every endpoint. SUPER_ADMIN bypasses every check
 * by role (see `PermissionsGuard`), so its effective set is the whole catalog; an ADMIN gets exactly its explicit grants.
 */
@ApiTags('admin-me')
@Controller('admin/me')
@UseGuards(RolesGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
export class AdminMePermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get('permissions')
  async mine(@CurrentUser() user: AuthenticatedUser) {
    const isSuperAdmin = user.role === Role.SUPER_ADMIN;
    const permissions = isSuperAdmin ? Object.values(Permission) : await this.permissionsService.listPermissions(user.id);
    return { data: { role: user.role, permissions } };
  }
}
