import { randomUUID } from 'crypto';
import { runBootstrap } from './bootstrap-admin';
import { Role } from '../common/enums/role.enum';

function buildRepository(seed: { users?: any[] } = {}) {
  const users = new Map((seed.users ?? []).map((u) => [u.id, u]));

  const repository = {
    findOne: jest.fn(async (opts: any) => {
      if (opts.where.role) {
        return [...users.values()].find((u) => u.role === opts.where.role) ?? null;
      }
      if (opts.where.phone) {
        return [...users.values()].find((u) => u.phone === opts.where.phone) ?? null;
      }
      return null;
    }),
    create: (data: any) => ({ ...data }),
    save: jest.fn(async (entity: any) => {
      const withId = { id: entity.id ?? randomUUID(), ...entity };
      users.set(withId.id, withId);
      return withId;
    }),
  };

  return { repository, users };
}

describe('runBootstrap', () => {
  it('creates exactly one SUPER_ADMIN with a hashed password when none exists', async () => {
    const { repository, users } = buildRepository();

    const result = await runBootstrap(repository as any, {
      phone: '+201000000001',
      fullName: 'Ops Admin',
      password: 'a-secure-password',
    });

    expect(result.created).toBe(true);
    const created = [...users.values()][0];
    expect(created.role).toBe(Role.SUPER_ADMIN);
    expect(created.phone).toBe('+201000000001');
    expect(created.isPhoneVerified).toBe(true);
    expect(created.isActive).toBe(true);
    // Never the plaintext — always a bcrypt hash.
    expect(created.passwordHash).not.toBe('a-secure-password');
    expect(created.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it('does not include the password or hash in the returned message', async () => {
    const { repository } = buildRepository();
    const result = await runBootstrap(repository as any, {
      phone: '+201000000002',
      fullName: 'Ops Admin',
      password: 'a-secure-password',
    });
    expect(result.message).not.toContain('a-secure-password');
  });

  it('refuses to create a second SUPER_ADMIN — existing account untouched', async () => {
    const existing = { id: 'existing-1', role: Role.SUPER_ADMIN, phone: '+201000000003', fullName: 'Original Admin' };
    const { repository, users } = buildRepository({ users: [existing] });

    const result = await runBootstrap(repository as any, {
      phone: '+201000000099',
      fullName: 'New Admin',
      password: 'another-password',
    });

    expect(result.created).toBe(false);
    expect(users.size).toBe(1);
    expect(users.get('existing-1')).toEqual(existing); // byte-for-byte untouched
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('rejects a duplicate phone even when no SUPER_ADMIN exists yet', async () => {
    const existingCustomer = { id: 'cust-1', role: Role.CUSTOMER, phone: '+201000000004', fullName: 'A Customer' };
    const { repository, users } = buildRepository({ users: [existingCustomer] });

    const result = await runBootstrap(repository as any, {
      phone: '+201000000004',
      fullName: 'New Admin',
      password: 'another-password',
    });

    expect(result.created).toBe(false);
    expect(users.size).toBe(1);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('running twice in sequence is safe — the second call is a clean no-op', async () => {
    const { repository, users } = buildRepository();

    const first = await runBootstrap(repository as any, {
      phone: '+201000000005',
      fullName: 'Ops Admin',
      password: 'a-secure-password',
    });
    expect(first.created).toBe(true);

    const second = await runBootstrap(repository as any, {
      phone: '+201000000006',
      fullName: 'Someone Else',
      password: 'different-password',
    });

    expect(second.created).toBe(false);
    expect(users.size).toBe(1); // still only the one from the first call
  });
});
