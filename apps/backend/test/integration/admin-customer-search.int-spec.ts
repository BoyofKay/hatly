import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { createIntegrationApp } from './support/app';
import { TestData } from './support/test-data';
import { AdminCustomersService } from '../../src/modules/admin-customers/admin-customers.service';
import { Role } from '../../src/common/enums/role.enum';
import { Address } from '../../src/modules/addresses/entities/address.entity';
import { WalletTransaction } from '../../src/modules/wallet/entities/wallet-transaction.entity';
import { WalletTransactionType } from '../../src/modules/wallet/wallet-transaction-type.enum';
import { OrderVendorSegment } from '../../src/modules/orders/entities/order-vendor-segment.entity';
import { CartGroupType } from '../../src/modules/cart/cart-group-type.enum';

/**
 * M3c (Launch-Readiness Gap Audit, G-10) — real PostgreSQL coverage for
 * `AdminCustomersService`. Mirrors `admin-order-search.int-spec.ts`'s
 * own reasoning: the mixed raw-column/entity-join query builder can
 * only be genuinely proven correct against a real database.
 */
describe('AdminCustomersService — real PostgreSQL', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let data: TestData;
  let service: AdminCustomersService;

  beforeAll(async () => {
    app = await createIntegrationApp();
    ds = app.get(DataSource);
    data = new TestData(ds);
    service = app.get(AdminCustomersService);
  });
  afterEach(async () => {
    await data.dispose();
  });
  afterAll(async () => {
    await app?.close();
  });

  describe('search', () => {
    it('only ever returns CUSTOMER-role users — never drivers, vendor staff, or admins', async () => {
      const customer = await data.user({ fullName: 'Search Scope Customer', role: Role.CUSTOMER });
      const driver = await data.user({ fullName: 'Search Scope Driver', role: Role.DRIVER });
      const admin = await data.user({ fullName: 'Search Scope Admin', role: Role.ADMIN });

      const result = await service.search({ search: customer.phone });
      expect(result.data.map((c) => c.id)).toEqual([customer.id]);

      const driverSearch = await service.search({ search: driver.phone });
      expect(driverSearch.data).toEqual([]);
      const adminSearch = await service.search({ search: admin.phone });
      expect(adminSearch.data).toEqual([]);
    });

    it('paginates deterministically, newest first, with a stable id tie-break', async () => {
      const base = new Date('2026-02-01T00:00:00.000Z');
      const customers = [];
      for (let i = 0; i < 5; i++) {
        customers.push(await data.user({ fullName: `Pagination Customer ${i}`, role: Role.CUSTOMER, createdAt: new Date(base.getTime() + i * 1000) } as any));
      }
      const searchTerm = 'Pagination Customer';

      const page1 = await service.search({ page: 1, limit: 2, search: searchTerm });
      const page2 = await service.search({ page: 2, limit: 2, search: searchTerm });
      const page3 = await service.search({ page: 3, limit: 2, search: searchTerm });

      expect(page1.total).toBe(5);
      expect(page1.data).toHaveLength(2);
      expect(page1.data[0].id).toBe(customers[4].id); // newest first
      expect(page1.data[1].id).toBe(customers[3].id);
      expect(page3.data).toHaveLength(1);
      const allIds = [...page1.data, ...page2.data, ...page3.data].map((c) => c.id);
      expect(new Set(allIds).size).toBe(5);
    });

    it('searches by phone, full name, or exact UUID', async () => {
      const customer = await data.user({ fullName: 'Findable Unique Name', role: Role.CUSTOMER });

      expect((await service.search({ search: customer.phone })).data.map((c) => c.id)).toEqual([customer.id]);
      expect((await service.search({ search: 'Findable Unique' })).data.map((c) => c.id)).toEqual([customer.id]);
      expect((await service.search({ search: customer.id })).data.map((c) => c.id)).toEqual([customer.id]);
    });

    it('filters by account status (isActive)', async () => {
      const active = await data.user({ fullName: 'Active Status Customer', role: Role.CUSTOMER, isActive: true } as any);
      const inactive = await data.user({ fullName: 'Inactive Status Customer', role: Role.CUSTOMER, isActive: false } as any);

      const activeResult = await service.search({ search: 'Status Customer', isActive: true });
      expect(activeResult.data.map((c) => c.id)).toEqual([active.id]);

      const inactiveResult = await service.search({ search: 'Status Customer', isActive: false });
      expect(inactiveResult.data.map((c) => c.id)).toEqual([inactive.id]);
    });

    it('never exposes passwordHash — not fetched at all (entity-level select: false), confirmed against a customer with a real password set', async () => {
      const customer = await data.user({ fullName: 'Password Set Customer', role: Role.CUSTOMER, passwordHash: 'a-real-bcrypt-hash' } as any);
      const result = await service.search({ search: customer.phone });
      expect((result.data[0] as any).passwordHash).toBeUndefined();
    });

    it('an empty result set is a clean, well-formed page', async () => {
      const result = await service.search({ search: '+201000000099999' });
      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('getOne', () => {
    it('assembles wallet balance, default address, order count, and recent orders — all real, from their own existing services', async () => {
      const customer = await data.user({ fullName: 'Detail View Customer', role: Role.CUSTOMER });
      await data.save<Address>(Address, { customerId: customer.id, line1: 'Old Address', latitude: 30.1, longitude: 31.1, isDefault: false, isActive: true });
      const defaultAddress = await data.save<Address>(Address, {
        customerId: customer.id,
        line1: 'Default Address',
        latitude: 30.2,
        longitude: 31.2,
        isDefault: true,
        isActive: true,
        governorate: 'Cairo',
        city: 'Nasr City',
      });
      await data.save<WalletTransaction>(WalletTransaction, {
        customerId: customer.id,
        amountDeltaMinor: 7500,
        type: WalletTransactionType.ADMIN_CREDIT,
        reason: 'test credit',
        idempotencyKey: `admin-customer-detail-test:${customer.id}`,
      });
      const order = await data.order(customer.id, { orderNumber: 'HT-200001' });
      const branch = await data.vendorBranch();
      await data.save<OrderVendorSegment>(OrderVendorSegment, { orderId: order.id, vendorBranchId: branch.id, groupType: CartGroupType.CATALOG });

      const detail = await service.getOne(customer.id);

      expect(detail.id).toBe(customer.id);
      expect(detail.walletBalanceMinor).toBe(7500);
      expect(detail.address).toMatchObject({ id: defaultAddress.id, line1: 'Default Address', governorate: 'Cairo', city: 'Nasr City' });
      expect(detail.orderCount).toBe(1);
      expect(detail.recentOrders).toHaveLength(1);
      expect(detail.recentOrders[0].orderNumber).toBe('HT-200001');
      expect(detail.recentOrders[0].segmentCount).toBe(1);
      expect((detail as any).passwordHash).toBeUndefined();
    });

    it('a customer with no address, wallet activity, or orders gets clean zero/null values, never an error', async () => {
      const customer = await data.user({ fullName: 'Empty Detail Customer', role: Role.CUSTOMER });
      const detail = await service.getOne(customer.id);
      expect(detail.walletBalanceMinor).toBe(0);
      expect(detail.address).toBeNull();
      expect(detail.orderCount).toBe(0);
      expect(detail.recentOrders).toEqual([]);
    });

    it('a nonexistent customer id is a 404-shaped rejection', async () => {
      await expect(service.getOne('00000000-0000-0000-0000-000000000000')).rejects.toThrow();
    });

    it('rejects a non-CUSTOMER user id (e.g. a driver) — this endpoint is customer management only', async () => {
      const driver = await data.user({ fullName: 'Not A Customer', role: Role.DRIVER });
      await expect(service.getOne(driver.id)).rejects.toThrow();
    });

    it('never mixes up two different customers\' orders — ownership is exact, not fuzzy', async () => {
      const customerA = await data.user({ fullName: 'Owner A' });
      const customerB = await data.user({ fullName: 'Owner B' });
      await data.order(customerA.id, { orderNumber: 'HT-200002' });
      await data.order(customerB.id, { orderNumber: 'HT-200003' });

      const detailA = await service.getOne(customerA.id);
      expect(detailA.recentOrders.map((o) => o.orderNumber)).toEqual(['HT-200002']);
    });
  });
});
