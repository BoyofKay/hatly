import { NotFoundException } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { Permission } from './permission.enum';
import { Role } from '../../common/enums/role.enum';

/**
 * Plain mock repository rather than a full TypeORM test module — these
 * tests exercise PermissionsService's own logic (idempotency, the
 * not-found path, the role-assertion guard) in isolation, not TypeORM
 * itself. See the Phase 1 report for the caveat that none of this has
 * actually been run (no toolchain in this environment).
 */
function buildMockRepo(initial: Array<{ id: string; userId: string; permission: Permission }> = []) {
  const rows = [...initial];
  return {
    findOne: jest.fn(async ({ where }: { where: { userId: string; permission?: Permission } }) => {
      return rows.find((r) => r.userId === where.userId && (!where.permission || r.permission === where.permission)) ?? null;
    }),
    find: jest.fn(async ({ where }: { where: { userId: string } }) => rows.filter((r) => r.userId === where.userId)),
    create: jest.fn((data: any) => ({ id: `new-${rows.length}`, ...data })),
    save: jest.fn(async (row: any) => {
      rows.push(row);
      return row;
    }),
    remove: jest.fn(async (row: any) => {
      const index = rows.indexOf(row);
      if (index >= 0) rows.splice(index, 1);
    }),
  };
}

describe('PermissionsService', () => {
  it('hasPermission returns false when no grant exists', async () => {
    const repo = buildMockRepo();
    const service = new PermissionsService(repo as any);
    await expect(service.hasPermission('user-1', Permission.CLOSE_VENDOR_SETTLEMENTS)).resolves.toBe(false);
  });

  it('hasPermission returns true once granted', async () => {
    const repo = buildMockRepo([{ id: 'p1', userId: 'user-1', permission: Permission.ASSIGN_REASSIGN_ORDERS }]);
    const service = new PermissionsService(repo as any);
    await expect(service.hasPermission('user-1', Permission.ASSIGN_REASSIGN_ORDERS)).resolves.toBe(true);
  });

  it('grant is idempotent — granting an already-granted permission does not create a duplicate', async () => {
    const repo = buildMockRepo();
    const service = new PermissionsService(repo as any);

    const first = await service.grant('user-1', Permission.OVERRIDE_DISPATCH, 'super-admin-1');
    const second = await service.grant('user-1', Permission.OVERRIDE_DISPATCH, 'super-admin-1');

    expect(repo.save).toHaveBeenCalledTimes(1); // second call short-circuited, no second insert
    expect(second).toEqual(first);
  });

  it('grant survives a concurrent-race unique-constraint violation by returning the row the other request just inserted', async () => {
    const repo = buildMockRepo();
    const service = new PermissionsService(repo as any);

    // Simulate: our own findOne-before-insert check sees nothing yet
    // (repo starts empty), but a concurrent request wins the race and
    // inserts first, so our save() hits the DB's unique constraint.
    const raceWinnerRow = { id: 'race-winner', userId: 'user-1', permission: Permission.MANAGE_BUSINESS_CONFIG };
    repo.save.mockImplementationOnce(async () => {
      throw new Error('duplicate key value violates unique constraint');
    });
    // The post-failure re-check finds the concurrent insert.
    repo.findOne.mockImplementationOnce(async () => null); // pre-insert check: nothing yet
    repo.findOne.mockImplementationOnce(async () => raceWinnerRow); // post-failure re-check: found it

    const result = await service.grant('user-1', Permission.MANAGE_BUSINESS_CONFIG, 'super-admin-1');

    expect(result).toEqual(raceWinnerRow);
    expect(repo.save).toHaveBeenCalledTimes(1); // our own insert attempt, which failed
  });

  it('revoke throws NotFoundException when the permission was never granted', async () => {
    const repo = buildMockRepo();
    const service = new PermissionsService(repo as any);
    await expect(service.revoke('user-1', Permission.CHANGE_DRIVER_ONLINE_STATUS)).rejects.toThrow(NotFoundException);
  });

  it('revoke succeeds when the grant exists', async () => {
    const repo = buildMockRepo([{ id: 'p1', userId: 'user-1', permission: Permission.CHANGE_DRIVER_ONLINE_STATUS }]);
    const service = new PermissionsService(repo as any);
    await expect(service.revoke('user-1', Permission.CHANGE_DRIVER_ONLINE_STATUS)).resolves.toBeUndefined();
    await expect(service.hasPermission('user-1', Permission.CHANGE_DRIVER_ONLINE_STATUS)).resolves.toBe(false);
  });

  it('assertGrantableRole rejects any role other than ADMIN', () => {
    const service = new PermissionsService(buildMockRepo() as any);
    expect(() => service.assertGrantableRole(Role.ADMIN)).not.toThrow();
    expect(() => service.assertGrantableRole(Role.SUPER_ADMIN)).toThrow();
    expect(() => service.assertGrantableRole(Role.CUSTOMER)).toThrow();
    expect(() => service.assertGrantableRole(Role.DRIVER)).toThrow();
  });
});
