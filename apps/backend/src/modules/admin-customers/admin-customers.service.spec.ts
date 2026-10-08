import { NotFoundException } from '@nestjs/common';
import { AdminCustomersService } from './admin-customers.service';
import { User } from '../users/entities/user.entity';
import { Role } from '../../common/enums/role.enum';

function buildQueryBuilder(rows: any[]) {
  const qb: any = {
    where: () => qb,
    andWhere: () => qb,
    orderBy: () => qb,
    addOrderBy: () => qb,
    skip: () => qb,
    take: () => qb,
    getManyAndCount: async () => [rows, rows.length],
  };
  return qb;
}

function buildHarness(seed: { users?: any[]; customer?: any; addresses?: any[]; walletBalanceMinor?: number; recentOrders?: any } = {}) {
  const dataSource = {
    getRepository: (EntityClass: any) => {
      if (EntityClass === User) {
        return {
          createQueryBuilder: () => buildQueryBuilder(seed.users ?? []),
          findOne: async (opts: any) => (seed.customer && opts.where.id === seed.customer.id ? seed.customer : null),
        };
      }
      throw new Error(`unhandled getRepository ${EntityClass.name}`);
    },
  };
  const addressesService = { listForCustomer: jest.fn(async () => seed.addresses ?? []) };
  const walletService = { getBalance: jest.fn(async () => seed.walletBalanceMinor ?? 0) };
  const adminOrdersService = { search: jest.fn(async () => seed.recentOrders ?? { data: [], page: 1, limit: 5, total: 0 }) };

  const service = new AdminCustomersService(dataSource as any, addressesService as any, walletService as any, adminOrdersService as any);
  return { service, addressesService, walletService, adminOrdersService };
}

function makeCustomer(overrides: Partial<any> = {}) {
  return {
    id: 'customer-1',
    fullName: 'Sara Customer',
    phone: '+201111111111',
    role: Role.CUSTOMER,
    isActive: true,
    isPhoneVerified: true,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('AdminCustomersService.search (M3c, G-10)', () => {
  it('returns the safe list DTO shape, never passwordHash or any other field', async () => {
    const { service } = buildHarness({ users: [makeCustomer({ passwordHash: 'secret-hash' })] });
    const result = await service.search({});
    expect(result.data[0]).toEqual({
      id: 'customer-1',
      fullName: 'Sara Customer',
      phone: '+201111111111',
      isActive: true,
      isPhoneVerified: true,
      createdAt: new Date('2026-01-01'),
    });
    expect((result.data[0] as any).passwordHash).toBeUndefined();
  });

  it('clamps an over-large limit to MAX_LIMIT, defaults page/limit when unset', async () => {
    const { service } = buildHarness({ users: [] });
    const result = await service.search({ limit: 500 });
    expect(result.limit).toBe(50);
    expect(result.page).toBe(1);
  });

  it('an empty result is a clean, well-formed page', async () => {
    const { service } = buildHarness({ users: [] });
    const result = await service.search({ search: 'nobody' });
    expect(result.data).toEqual([]);
    expect(result.total).toBe(0);
  });
});

describe('AdminCustomersService.getOne (M3c, G-10)', () => {
  it('an unknown customer id throws NotFoundException', async () => {
    const { service } = buildHarness({ customer: null });
    await expect(service.getOne('missing')).rejects.toThrow(NotFoundException);
  });

  it('assembles the detail view from the address/wallet/order services, never duplicating their queries', async () => {
    const customer = makeCustomer();
    const { service, addressesService, walletService, adminOrdersService } = buildHarness({
      customer,
      addresses: [{ id: 'addr-1', label: 'Home', line1: '1 Test St', governorate: 'Cairo', city: 'Cairo', isDefault: true }],
      walletBalanceMinor: 5000,
      recentOrders: { data: [{ id: 'order-1', orderNumber: 'HT-100001' }], page: 1, limit: 5, total: 7 },
    });

    const result = await service.getOne('customer-1');

    expect(addressesService.listForCustomer).toHaveBeenCalledWith('customer-1');
    expect(walletService.getBalance).toHaveBeenCalledWith('customer-1');
    expect(adminOrdersService.search).toHaveBeenCalledWith({ customerId: 'customer-1', limit: 5 });

    expect(result.walletBalanceMinor).toBe(5000);
    expect(result.address).toEqual({ id: 'addr-1', label: 'Home', line1: '1 Test St', governorate: 'Cairo', city: 'Cairo', isDefault: true });
    expect(result.orderCount).toBe(7); // the TOTAL, not just the 5 recent rows returned
    expect(result.recentOrders).toEqual([{ id: 'order-1', orderNumber: 'HT-100001' }]);
  });

  it('falls back to the most recent address when none is marked default', async () => {
    const { service } = buildHarness({
      customer: makeCustomer(),
      addresses: [{ id: 'addr-recent', line1: 'Newest', isDefault: false }, { id: 'addr-older', line1: 'Older', isDefault: false }],
    });
    const result = await service.getOne('customer-1');
    expect(result.address?.id).toBe('addr-recent'); // listForCustomer's own ordering is newest-first
  });

  it('returns a null address when the customer has none', async () => {
    const { service } = buildHarness({ customer: makeCustomer(), addresses: [] });
    const result = await service.getOne('customer-1');
    expect(result.address).toBeNull();
  });

  it('never leaks passwordHash in the detail view either', async () => {
    const { service } = buildHarness({ customer: makeCustomer({ passwordHash: 'secret-hash' }) });
    const result = await service.getOne('customer-1');
    expect((result as any).passwordHash).toBeUndefined();
  });
});
