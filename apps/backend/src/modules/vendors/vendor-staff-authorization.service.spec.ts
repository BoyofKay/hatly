import { ForbiddenException } from '@nestjs/common';
import { VendorStaffAuthorizationService } from './vendor-staff-authorization.service';

function buildRepo(rows: any[]) {
  return {
    find: jest.fn(async ({ where }: any) => rows.filter((r) => r.userId === where.userId)),
    findOne: jest.fn(async ({ where }: any) =>
      rows.find((r) => r.userId === where.userId && r.vendorBranchId === where.vendorBranchId) ?? null,
    ),
  };
}

describe('VendorStaffAuthorizationService', () => {
  it('getOwnedBranchIds returns every branch linked to the user', async () => {
    const repo = buildRepo([
      { userId: 'user-1', vendorBranchId: 'branch-1' },
      { userId: 'user-1', vendorBranchId: 'branch-2' },
      { userId: 'user-2', vendorBranchId: 'branch-3' },
    ]);
    const service = new VendorStaffAuthorizationService(repo as any);

    const branches = await service.getOwnedBranchIds('user-1');
    expect(branches).toEqual(['branch-1', 'branch-2']);
  });

  it('getOwnedBranchIds returns an empty array for a user with no links', async () => {
    const service = new VendorStaffAuthorizationService(buildRepo([]) as any);
    expect(await service.getOwnedBranchIds('user-1')).toEqual([]);
  });

  it('assertOwnsBranch passes silently when the link exists', async () => {
    const repo = buildRepo([{ userId: 'user-1', vendorBranchId: 'branch-1' }]);
    const service = new VendorStaffAuthorizationService(repo as any);
    await expect(service.assertOwnsBranch('user-1', 'branch-1')).resolves.toBeUndefined();
  });

  it('assertOwnsBranch throws ForbiddenException when the user owns other branches but not this one', async () => {
    const repo = buildRepo([{ userId: 'user-1', vendorBranchId: 'branch-1' }]);
    const service = new VendorStaffAuthorizationService(repo as any);
    await expect(service.assertOwnsBranch('user-1', 'branch-99')).rejects.toThrow(ForbiddenException);
  });

  it("assertOwnsBranch throws for a different user's branch — the core cross-vendor isolation guarantee", async () => {
    const repo = buildRepo([
      { userId: 'user-1', vendorBranchId: 'branch-1' },
      { userId: 'user-2', vendorBranchId: 'branch-2' },
    ]);
    const service = new VendorStaffAuthorizationService(repo as any);
    await expect(service.assertOwnsBranch('user-1', 'branch-2')).rejects.toThrow(ForbiddenException);
  });
});

describe('VendorStaffAuthorizationService.getOwnedBranches (Chunk 12B-3-A)', () => {
  // Separate local harness (rather than extending buildRepo above) —
  // these rows need a `vendorBranch` relation object that the
  // existing tests' rows don't have, and this keeps the two test
  // groups fully isolated with zero risk to the five tests above.
  function buildRepoWithBranches(rows: any[]) {
    return {
      find: jest.fn(async ({ where }: any) => rows.filter((r) => r.userId === where.userId)),
    };
  }

  it('returns every owned branch with only id/name — VENDOR', async () => {
    const repo = buildRepoWithBranches([
      { userId: 'user-1', vendorBranchId: 'branch-1', vendorBranch: { id: 'branch-1', name: 'Downtown' } },
    ]);
    const service = new VendorStaffAuthorizationService(repo as any);
    const branches = await service.getOwnedBranches('user-1');
    expect(branches).toEqual([{ id: 'branch-1', name: 'Downtown' }]);
  });

  it('returns every owned branch — VENDOR_MANAGER (identical treatment, same method, no role distinction)', async () => {
    const repo = buildRepoWithBranches([
      { userId: 'manager-1', vendorBranchId: 'branch-1', vendorBranch: { id: 'branch-1', name: 'Downtown' } },
    ]);
    const service = new VendorStaffAuthorizationService(repo as any);
    expect(await service.getOwnedBranches('manager-1')).toEqual([{ id: 'branch-1', name: 'Downtown' }]);
  });

  it('returns ALL owned branches when the user has multiple', async () => {
    const repo = buildRepoWithBranches([
      { userId: 'user-1', vendorBranchId: 'branch-1', vendorBranch: { id: 'branch-1', name: 'Downtown' } },
      { userId: 'user-1', vendorBranchId: 'branch-2', vendorBranch: { id: 'branch-2', name: 'Uptown' } },
    ]);
    const service = new VendorStaffAuthorizationService(repo as any);
    const branches = await service.getOwnedBranches('user-1');
    expect(branches.map((b) => b.id).sort()).toEqual(['branch-1', 'branch-2']);
  });

  it('returns [] for a user with zero owned branches', async () => {
    const service = new VendorStaffAuthorizationService(buildRepoWithBranches([]) as any);
    expect(await service.getOwnedBranches('user-with-no-branches')).toEqual([]);
  });

  it("CRITICAL: never returns another user's branch — the core cross-vendor isolation guarantee, same as assertOwnsBranch", async () => {
    const repo = buildRepoWithBranches([
      { userId: 'user-1', vendorBranchId: 'branch-1', vendorBranch: { id: 'branch-1', name: 'Downtown' } },
      { userId: 'user-2', vendorBranchId: 'branch-2', vendorBranch: { id: 'branch-2', name: 'Secret Branch' } },
    ]);
    const service = new VendorStaffAuthorizationService(repo as any);
    const branches = await service.getOwnedBranches('user-1');
    expect(branches.map((b) => b.id)).not.toContain('branch-2');
    expect(branches.map((b) => b.name)).not.toContain('Secret Branch');
  });

  it('returned objects contain ONLY id and name — no other VendorBranch field is exposed', async () => {
    const repo = buildRepoWithBranches([
      {
        userId: 'user-1',
        vendorBranchId: 'branch-1',
        vendorBranch: {
          id: 'branch-1',
          name: 'Downtown',
          commissionRateBasisPoints: 1500,
          latitude: 30.1,
          longitude: 31.1,
          isActive: true,
        },
      },
    ]);
    const service = new VendorStaffAuthorizationService(repo as any);
    const branches = await service.getOwnedBranches('user-1');
    expect(Object.keys(branches[0]).sort()).toEqual(['id', 'name']);
  });
});
