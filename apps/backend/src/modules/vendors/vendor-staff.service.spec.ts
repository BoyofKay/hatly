import { ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { VendorStaffService } from './vendor-staff.service';
import { User } from '../users/entities/user.entity';
import { VendorBranch } from './entities/vendor-branch.entity';
import { VendorStaff } from './entities/vendor-staff.entity';
import { Role } from '../../common/enums/role.enum';

function buildHarness(seed: { branches?: any[]; users?: any[] } = {}) {
  const branches = new Map((seed.branches ?? []).map((b) => [b.id, b]));
  const users = new Map((seed.users ?? []).map((u) => [u.phone, u]));
  const staffRows: any[] = [];

  const manager = {
    findOne: async (EntityClass: any, opts: any) => {
      if (EntityClass === VendorBranch) return branches.get(opts.where.id) ?? null;
      if (EntityClass === User) return users.get(opts.where.phone) ?? null;
      throw new Error(`unhandled findOne ${EntityClass.name}`);
    },
    create: (_EntityClass: any, data: any) => ({ ...data }),
    save: async (EntityClass: any, entity: any) => {
      const withId = { id: entity.id ?? randomUUID(), ...entity };
      if (EntityClass === User) users.set(withId.phone, withId);
      else if (EntityClass === VendorStaff) staffRows.push(withId);
      return withId;
    },
  };

  const dataSource = { transaction: async (cb: any) => cb(manager) };
  const service = new VendorStaffService(dataSource as any);
  return { service, users, staffRows };
}

describe('VendorStaffService', () => {
  it('creates a VENDOR user and links them to the given branch', async () => {
    const { service, users, staffRows } = buildHarness({ branches: [{ id: 'branch-1' }] });

    const staff = await service.create({
      phone: '+201000000001',
      fullName: 'Vendor Owner',
      vendorBranchId: 'branch-1',
      password: 'a-secure-password',
    });

    expect(users.get('+201000000001').role).toBe(Role.VENDOR);
    expect(staff.vendorBranchId).toBe('branch-1');
    expect(staffRows).toHaveLength(1);
  });

  it('creates a VENDOR_MANAGER when explicitly requested', async () => {
    const { service, users } = buildHarness({ branches: [{ id: 'branch-1' }] });

    await service.create({
      phone: '+201000000002',
      fullName: 'Manager',
      vendorBranchId: 'branch-1',
      password: 'a-secure-password',
      role: Role.VENDOR_MANAGER,
    });

    expect(users.get('+201000000002').role).toBe(Role.VENDOR_MANAGER);
  });

  it('rejects when the branch does not exist', async () => {
    const { service } = buildHarness({ branches: [] });

    await expect(
      service.create({ phone: '+201000000003', fullName: 'X', vendorBranchId: 'missing-branch', password: 'a-secure-password' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects when the phone number is already registered — never silently promotes an existing account', async () => {
    const { service } = buildHarness({
      branches: [{ id: 'branch-1' }],
      users: [{ id: 'existing-1', phone: '+201000000004', role: Role.CUSTOMER }],
    });

    await expect(
      service.create({ phone: '+201000000004', fullName: 'X', vendorBranchId: 'branch-1', password: 'a-secure-password' }),
    ).rejects.toThrow(ConflictException);
  });

  it('hashes the password before persistence — plaintext is never stored or returned', async () => {
    const { service, users } = buildHarness({ branches: [{ id: 'branch-1' }] });

    await service.create({
      phone: '+201000000005',
      fullName: 'Vendor Owner',
      vendorBranchId: 'branch-1',
      password: 'a-secure-password',
    });

    const stored = users.get('+201000000005');
    expect(stored.passwordHash).not.toBe('a-secure-password');
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$/);
  });
});

describe('VendorStaffService.listAll (Chunk 10)', () => {
  it('maps VendorStaff+User+VendorBranch+Vendor into the flat AdminVendorStaffView shape', async () => {
    const rows = [
      {
        id: 'staff-1',
        createdAt: new Date('2026-01-01'),
        user: { fullName: 'Sara Ali', phone: '+201000000009', role: Role.VENDOR_MANAGER, isActive: true },
        vendorBranch: { id: 'branch-1', name: 'Downtown Branch', vendor: { id: 'vendor-1', name: 'Pizza House' } },
      },
    ];
    const dataSource = { getRepository: () => ({ find: async () => rows }) };
    const service = new VendorStaffService(dataSource as any);

    const result = await service.listAll();

    expect(result).toEqual([
      {
        id: 'staff-1',
        fullName: 'Sara Ali',
        phone: '+201000000009',
        role: Role.VENDOR_MANAGER,
        isActive: true,
        vendorId: 'vendor-1',
        vendorName: 'Pizza House',
        vendorBranchId: 'branch-1',
        vendorBranchName: 'Downtown Branch',
        createdAt: rows[0].createdAt,
      },
    ]);
    // Never exposes a password field of any kind.
    expect(JSON.stringify(result)).not.toContain('password');
  });
});

describe('VendorStaffService activate/deactivate (Chunk 11)', () => {
  function buildActivationHarness(row: any) {
    const staffRows = new Map([[row.id, row]]);
    const staffRepository = {
      findOne: jest.fn(async (o: any) => staffRows.get(o.where.id) ?? null),
    };
    const usersRepository = { save: jest.fn(async (u: any) => u) };
    const dataSource = {
      getRepository: (EntityClass: any) => {
        if (EntityClass === VendorStaff) return staffRepository;
        if (EntityClass === User) return usersRepository;
        throw new Error(`unhandled getRepository ${EntityClass.name}`);
      },
    };
    const service = new VendorStaffService(dataSource as any);
    return { service, usersRepository };
  }

  function makeStaffRow(overrides: Partial<any> = {}) {
    return {
      id: 'staff-1',
      createdAt: new Date(),
      user: { fullName: 'Sara Ali', phone: '+201000000009', role: Role.VENDOR, isActive: true },
      vendorBranch: { id: 'branch-1', name: 'Downtown Branch', vendor: { id: 'vendor-1', name: 'Pizza House' } },
      ...overrides,
    };
  }

  it('activates a Vendor Staff account', async () => {
    const { service, usersRepository } = buildActivationHarness(
      makeStaffRow({ user: { fullName: 'Sara Ali', phone: '+201000000009', role: Role.VENDOR, isActive: false } }),
    );
    const result = await service.activate('staff-1');
    expect(result.isActive).toBe(true);
    expect(usersRepository.save).toHaveBeenCalled();
  });

  it('deactivates a Vendor Staff account', async () => {
    const { service, usersRepository } = buildActivationHarness(makeStaffRow());
    const result = await service.deactivate('staff-1');
    expect(result.isActive).toBe(false);
    expect(usersRepository.save).toHaveBeenCalled();
  });

  it('rejects a nonexistent VendorStaff id', async () => {
    const { service } = buildActivationHarness(makeStaffRow());
    await expect(service.activate('missing-id')).rejects.toThrow(NotFoundException);
  });

  it('CRITICAL: fails closed if the linked user is somehow not VENDOR/VENDOR_MANAGER — never modifies a Customer/Driver/Admin account', async () => {
    const { service, usersRepository } = buildActivationHarness(
      makeStaffRow({ user: { fullName: 'X', phone: '+201000000099', role: Role.ADMIN, isActive: true } }),
    );
    await expect(service.deactivate('staff-1')).rejects.toThrow(NotFoundException);
    expect(usersRepository.save).not.toHaveBeenCalled();
  });

  it('never returns passwordHash in the activate/deactivate response', async () => {
    const { service } = buildActivationHarness(makeStaffRow());
    const result = await service.deactivate('staff-1');
    expect(JSON.stringify(result)).not.toContain('password');
  });

  it('does not modify vendor/branch assignment', async () => {
    const { service } = buildActivationHarness(makeStaffRow());
    const result = await service.deactivate('staff-1');
    expect(result.vendorBranchId).toBe('branch-1');
    expect(result.vendorId).toBe('vendor-1');
  });
});
