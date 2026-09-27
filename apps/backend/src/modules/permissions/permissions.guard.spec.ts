import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { Permission } from './permission.enum';
import { Role } from '../../common/enums/role.enum';

function buildContext(user: { id: string; role: string } | undefined) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as any;
}

describe('PermissionsGuard', () => {
  it('allows the request through when the endpoint requires no permissions', async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) } as unknown as Reflector;
    const permissionsService = { hasPermission: jest.fn() } as any;
    const guard = new PermissionsGuard(reflector, permissionsService);

    await expect(guard.canActivate(buildContext({ id: 'u1', role: Role.CUSTOMER }))).resolves.toBe(true);
    expect(permissionsService.hasPermission).not.toHaveBeenCalled();
  });

  it('regression check for global registration: an unauthenticated request on a @Public() route (no user at all) with no permission metadata still passes through untouched', async () => {
    // This is the scenario that matters once PermissionsGuard is
    // registered globally (APP_GUARD) rather than per-controller: every
    // existing @Public() route (e.g. /auth/login) has no user on the
    // request and no @RequiresPermission metadata. The guard must never
    // even look at `user` in this case — confirmed by the no-op
    // returning true before the user/role check is reached.
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) } as unknown as Reflector;
    const permissionsService = { hasPermission: jest.fn() } as any;
    const guard = new PermissionsGuard(reflector, permissionsService);

    await expect(guard.canActivate(buildContext(undefined))).resolves.toBe(true);
    expect(permissionsService.hasPermission).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated request on a permission-gated endpoint', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([Permission.CLOSE_VENDOR_SETTLEMENTS]),
    } as unknown as Reflector;
    const permissionsService = { hasPermission: jest.fn() } as any;
    const guard = new PermissionsGuard(reflector, permissionsService);

    await expect(guard.canActivate(buildContext(undefined))).rejects.toThrow(ForbiddenException);
  });

  it('rejects a non-admin role even if (implausibly) a grant row existed', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([Permission.ASSIGN_REASSIGN_ORDERS]),
    } as unknown as Reflector;
    const permissionsService = { hasPermission: jest.fn().mockResolvedValue(true) } as any;
    const guard = new PermissionsGuard(reflector, permissionsService);

    // CUSTOMER, DRIVER, VENDOR, VENDOR_MANAGER must all be rejected outright —
    // this is the base admin-tier check that exists independently of any grant.
    for (const role of [Role.CUSTOMER, Role.DRIVER, Role.VENDOR, Role.VENDOR_MANAGER]) {
      await expect(guard.canActivate(buildContext({ id: 'u1', role }))).rejects.toThrow(ForbiddenException);
    }
    expect(permissionsService.hasPermission).not.toHaveBeenCalled();
  });

  it('SUPER_ADMIN bypasses the permission check entirely, no DB lookup', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([Permission.MANAGE_VENDOR_COMMISSION]),
    } as unknown as Reflector;
    const permissionsService = { hasPermission: jest.fn() } as any;
    const guard = new PermissionsGuard(reflector, permissionsService);

    await expect(
      guard.canActivate(buildContext({ id: 'super-1', role: Role.SUPER_ADMIN })),
    ).resolves.toBe(true);
    expect(permissionsService.hasPermission).not.toHaveBeenCalled();
  });

  it('ADMIN without the required grant is rejected', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([Permission.MANAGE_DRIVER_COMMISSION]),
    } as unknown as Reflector;
    const permissionsService = { hasPermission: jest.fn().mockResolvedValue(false) } as any;
    const guard = new PermissionsGuard(reflector, permissionsService);

    await expect(
      guard.canActivate(buildContext({ id: 'admin-1', role: Role.ADMIN })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('ADMIN with the required grant is allowed', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([Permission.MANAGE_DRIVER_COMMISSION]),
    } as unknown as Reflector;
    const permissionsService = { hasPermission: jest.fn().mockResolvedValue(true) } as any;
    const guard = new PermissionsGuard(reflector, permissionsService);

    await expect(
      guard.canActivate(buildContext({ id: 'admin-1', role: Role.ADMIN })),
    ).resolves.toBe(true);
  });

  it('ADMIN must hold EVERY listed permission, not just one, when multiple are required', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([
        Permission.ASSIGN_REASSIGN_ORDERS,
        Permission.OVERRIDE_DISPATCH,
      ]),
    } as unknown as Reflector;
    // Has the first permission but not the second.
    const permissionsService = {
      hasPermission: jest.fn(async (_userId: string, permission: Permission) =>
        permission === Permission.ASSIGN_REASSIGN_ORDERS,
      ),
    } as any;
    const guard = new PermissionsGuard(reflector, permissionsService);

    await expect(
      guard.canActivate(buildContext({ id: 'admin-1', role: Role.ADMIN })),
    ).rejects.toThrow(ForbiddenException);
  });
});
