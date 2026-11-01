import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ANY_PERMISSIONS_KEY, REQUIRED_PERMISSIONS_KEY } from './decorators/requires-permission.decorator';
import { PermissionsService } from './permissions.service';
import { Permission } from './permission.enum';
import { Role } from '../../common/enums/role.enum';

/**
 * Enforces @RequiresPermission(...) — the ONLY place permission
 * decisions are actually made.
 *
 * Deliberately checks the caller's role itself (must be ADMIN or
 * SUPER_ADMIN) rather than relying on a separate @Roles(...) decorator
 * also being present on the same endpoint. This is a direct response
 * to the single risk flagged as most dangerous in the approved
 * implementation plan: "a new admin endpoint shipped without a
 * permission check defaults to open, not closed... every new
 * Admin-facing endpoint needs an explicit check from day one, never
 * 'add it later.'" Making @RequiresPermission alone sufficient (no
 * second decorator to remember) removes one whole class of "forgot to
 * also add @Roles" mistake.
 *
 * SUPER_ADMIN short-circuits to true immediately, no DB lookup — "has
 * all permissions automatically" (approved requirement 7). An ADMIN's
 * grants are checked against PermissionsService; every listed
 * permission must be present (AND semantics — see the decorator's own
 * doc comment).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const anyOf = this.reflector.getAllAndOverride<Permission[]>(ANY_PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);

    if ((!requiredPermissions || requiredPermissions.length === 0) && (!anyOf || anyOf.length === 0)) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();

    if (!user || (user.role !== Role.ADMIN && user.role !== Role.SUPER_ADMIN)) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    if (user.role === Role.SUPER_ADMIN) {
      return true;
    }

    for (const permission of requiredPermissions ?? []) {
      const granted = await this.permissionsService.hasPermission(user.id, permission);
      if (!granted) {
        throw new ForbiddenException('You do not have permission to perform this action.');
      }
    }

    if (anyOf && anyOf.length > 0) {
      let any = false;
      for (const permission of anyOf) {
        if (await this.permissionsService.hasPermission(user.id, permission)) {
          any = true;
          break;
        }
      }
      if (!any) {
        throw new ForbiddenException('You do not have permission to perform this action.');
      }
    }

    return true;
  }
}
