import 'reflect-metadata';
import { AdminUsersController, AdminPermissionCatalogController } from './admin-permissions.controller';
import { Permission } from './permission.enum';
import { Role } from '../../common/enums/role.enum';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';

describe('AdminUsersController (M3b, G-08)', () => {
  function buildHarness(admins: any[], permissionsByUserId: Record<string, Permission[]> = {}) {
    const usersService = { listAdmins: jest.fn(async () => admins) };
    const permissionsService = {
      listPermissions: jest.fn(async (userId: string) => permissionsByUserId[userId] ?? []),
    };
    const controller = new AdminUsersController(usersService as any, permissionsService as any);
    return { controller, usersService, permissionsService };
  }

  it('lists admin-tier users with their granted permissions attached', async () => {
    const { controller } = buildHarness(
      [
        {
          id: 'admin-1',
          fullName: 'Admin One',
          phone: '+201000000001',
          role: Role.ADMIN,
          isActive: true,
          createdAt: new Date('2026-01-01'),
        },
      ],
      { 'admin-1': [Permission.MANAGE_VENDORS, Permission.VIEW_ORDERS] },
    );

    const result = await controller.list();

    expect(result.data).toEqual([
      expect.objectContaining({
        id: 'admin-1',
        fullName: 'Admin One',
        phone: '+201000000001',
        role: Role.ADMIN,
        isActive: true,
        permissions: [Permission.MANAGE_VENDORS, Permission.VIEW_ORDERS],
      }),
    ]);
  });

  it('never fabricates permissions for a SUPER_ADMIN — always an empty list (bypass-by-role, no explicit grants)', async () => {
    const { controller, permissionsService } = buildHarness([
      {
        id: 'super-1',
        fullName: 'Super Admin',
        phone: '+201000000002',
        role: Role.SUPER_ADMIN,
        isActive: true,
        createdAt: new Date(),
      },
    ]);

    const result = await controller.list();

    expect(result.data[0].permissions).toEqual([]);
    expect(permissionsService.listPermissions).not.toHaveBeenCalled(); // never even queried for a SUPER_ADMIN
  });

  it('never exposes passwordHash or any field beyond the safe DTO shape', async () => {
    const { controller } = buildHarness([
      {
        id: 'admin-1',
        fullName: 'Admin One',
        phone: '+201000000001',
        role: Role.ADMIN,
        isActive: true,
        createdAt: new Date(),
        passwordHash: 'secret-hash',
      },
    ]);

    const result = await controller.list();

    expect((result.data[0] as any).passwordHash).toBeUndefined();
  });

  it('is restricted to SUPER_ADMIN only', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, AdminUsersController);
    expect(roles).toEqual([Role.SUPER_ADMIN]);
  });
});

describe('AdminPermissionCatalogController (M3b, G-08)', () => {
  it('returns the REAL Permission enum values — the single source of truth, never a hardcoded second list', () => {
    const controller = new AdminPermissionCatalogController();
    const result = controller.list();
    expect(result.data).toEqual(Object.values(Permission));
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('is restricted to SUPER_ADMIN only', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, AdminPermissionCatalogController);
    expect(roles).toEqual([Role.SUPER_ADMIN]);
  });
});

describe('AdminMePermissionsController (Hatly Service pricing Admin UI)', () => {
  const { AdminMePermissionsController } = jest.requireActual('./admin-permissions.controller');

  it('returns an ADMIN its explicit grants only', async () => {
    const permissionsService = {
      listPermissions: jest.fn(async () => [Permission.VIEW_ORDERS]),
    };
    const controller = new AdminMePermissionsController(permissionsService as any);
    const result = await controller.mine({
      id: 'admin-1',
      role: Role.ADMIN,
    } as any);
    expect(result.data).toEqual({
      role: Role.ADMIN,
      permissions: [Permission.VIEW_ORDERS],
    });
    expect(permissionsService.listPermissions).toHaveBeenCalledWith('admin-1');
  });

  it('returns a SUPER_ADMIN the whole catalog (it bypasses every check by role) without a grants lookup', async () => {
    const permissionsService = { listPermissions: jest.fn() };
    const controller = new AdminMePermissionsController(permissionsService as any);
    const result = await controller.mine({
      id: 'super-1',
      role: Role.SUPER_ADMIN,
    } as any);
    expect(result.data.permissions).toEqual(Object.values(Permission));
    expect(permissionsService.listPermissions).not.toHaveBeenCalled();
  });

  it('is restricted to admin-tier roles', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminMePermissionsController)).toEqual([Role.ADMIN, Role.SUPER_ADMIN]);
  });
});
