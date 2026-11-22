import { NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { FavoritesService } from './favorites.service';

/**
 * Direct-instantiation harness (this repo's established pattern for
 * focused service tests — see e.g. vendor-orders.service.spec.ts) —
 * both repositories are hand-built fakes, not a real database or a
 * DI container.
 */
function buildHarness(options: {
  vendors?: Record<string, { id: string; name: string; nameAr?: string | null; logoUrl?: string | null; isActive: boolean }>;
  existingFavorites?: Array<{ customerId: string; vendorId: string; createdAt: Date }>;
}) {
  const vendors = options.vendors ?? {};
  const rows = [...(options.existingFavorites ?? [])].map((f, i) => ({ ...f, id: `fav-${i}` }));

  const vendorRepository = {
    findOne: jest.fn(async ({ where: { id } }: any) => {
      const v = vendors[id];
      return v ?? null;
    }),
  };

  const favoritesRepository = {
    findOne: jest.fn(async ({ where: { customerId, vendorId } }: any) =>
      rows.find((r) => r.customerId === customerId && r.vendorId === vendorId) ?? null,
    ),
    insert: jest.fn(async ({ customerId, vendorId }: any) => {
      const duplicate = rows.some((r) => r.customerId === customerId && r.vendorId === vendorId);
      if (duplicate) {
        // Simulates the real UNIQUE constraint violation Postgres
        // would raise. CRITICAL: FavoritesService's own catch block
        // checks `error instanceof QueryFailedError` (not just
        // `.code`) — a plain Error with a `.code`/`.name` bolted on is
        // NOT an instance of the real TypeORM class and would fail
        // that check, so this constructs an actual `QueryFailedError`
        // (same class the real TypeORM driver throws), the same way
        // `new QueryFailedError(query, parameters, driverError)` is
        // built internally — `driverError` here mirrors the shape of
        // node-postgres's own real unique-violation error object.
        throw new QueryFailedError(
          'INSERT INTO "favorite" ("customer_id", "vendor_id") VALUES ($1, $2)',
          [customerId, vendorId],
          { code: '23505', toString: () => 'duplicate key value violates unique constraint' } as any,
        );
      }
      rows.push({ id: `fav-${rows.length}`, customerId, vendorId, createdAt: new Date() });
    }),
    delete: jest.fn(async ({ customerId, vendorId }: any) => {
      const idx = rows.findIndex((r) => r.customerId === customerId && r.vendorId === vendorId);
      if (idx !== -1) rows.splice(idx, 1);
    }),
    createQueryBuilder: jest.fn(() => {
      let whereCustomerId: string | undefined;
      const builder: any = {
        innerJoinAndSelect: () => builder,
        where: (_clause: string, params: any) => {
          whereCustomerId = params.customerId;
          return builder;
        },
        orderBy: () => builder,
        getMany: async () =>
          rows
            .filter((r) => r.customerId === whereCustomerId)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .map((r) => ({ ...r, vendor: vendors[r.vendorId] })),
      };
      return builder;
    }),
  };

  const service = new FavoritesService(favoritesRepository as any, vendorRepository as any);
  return { service, rows, vendorRepository, favoritesRepository };
}

describe('FavoritesService', () => {
  it('CRITICAL: a customer can create a Favorite for a real, active Vendor', async () => {
    const { service, rows } = buildHarness({
      vendors: { 'vendor-1': { id: 'vendor-1', name: 'Test Vendor', isActive: true } },
    });

    await service.create('customer-1', 'vendor-1');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ customerId: 'customer-1', vendorId: 'vendor-1' });
  });

  it('CRITICAL: duplicate POST is idempotent — no duplicate row, no error', async () => {
    const { service, rows } = buildHarness({
      vendors: { 'vendor-1': { id: 'vendor-1', name: 'Test Vendor', isActive: true } },
      existingFavorites: [{ customerId: 'customer-1', vendorId: 'vendor-1', createdAt: new Date() }],
    });

    await expect(service.create('customer-1', 'vendor-1')).resolves.toBeUndefined();
    expect(rows).toHaveLength(1);
  });

  it('CRITICAL: a genuine race (concurrent duplicate insert) is turned into idempotent success by the unique-constraint catch, not a pre-check', async () => {
    const { service, favoritesRepository, rows } = buildHarness({
      vendors: { 'vendor-1': { id: 'vendor-1', name: 'Test Vendor', isActive: true } },
    });
    // Simulate the pre-check racing: findOne returns null (nothing
    // exists yet from this call's point of view), but insert() itself
    // discovers a row was already committed by a concurrent request.
    favoritesRepository.findOne.mockResolvedValueOnce(null);
    rows.push({ id: 'fav-race', customerId: 'customer-1', vendorId: 'vendor-1', createdAt: new Date() });

    await expect(service.create('customer-1', 'vendor-1')).resolves.toBeUndefined();
    expect(rows).toHaveLength(1);
  });

  it('creating a Favorite for a non-existent Vendor throws NotFoundException', async () => {
    const { service } = buildHarness({ vendors: {} });
    await expect(service.create('customer-1', 'no-such-vendor')).rejects.toThrow(NotFoundException);
  });

  it('CRITICAL: a customer can delete their own Favorite', async () => {
    const { service, rows } = buildHarness({
      vendors: { 'vendor-1': { id: 'vendor-1', name: 'Test Vendor', isActive: true } },
      existingFavorites: [{ customerId: 'customer-1', vendorId: 'vendor-1', createdAt: new Date() }],
    });

    await service.remove('customer-1', 'vendor-1');
    expect(rows).toHaveLength(0);
  });

  it('re-favoriting the same Vendor after a hard delete works normally', async () => {
    const { service, rows } = buildHarness({
      vendors: { 'vendor-1': { id: 'vendor-1', name: 'Test Vendor', isActive: true } },
      existingFavorites: [{ customerId: 'customer-1', vendorId: 'vendor-1', createdAt: new Date() }],
    });

    await service.remove('customer-1', 'vendor-1');
    expect(rows).toHaveLength(0);
    await service.create('customer-1', 'vendor-1');
    expect(rows).toHaveLength(1);
  });

  it('CRITICAL: deleting a non-existing Favorite is a safe no-op', async () => {
    const { service, rows } = buildHarness({
      vendors: { 'vendor-1': { id: 'vendor-1', name: 'Test Vendor', isActive: true } },
    });

    await expect(service.remove('customer-1', 'vendor-1')).resolves.toBeUndefined();
    expect(rows).toHaveLength(0);
  });

  it('CRITICAL: Customer A cannot see Customer B\'s Favorite via list', async () => {
    const { service } = buildHarness({
      vendors: { 'vendor-1': { id: 'vendor-1', name: 'Test Vendor', isActive: true } },
      existingFavorites: [{ customerId: 'customer-b', vendorId: 'vendor-1', createdAt: new Date() }],
    });

    const result = await service.listForCustomer('customer-a');
    expect(result).toHaveLength(0);
  });

  it('CRITICAL: Customer A cannot delete Customer B\'s Favorite', async () => {
    const { service, rows } = buildHarness({
      vendors: { 'vendor-1': { id: 'vendor-1', name: 'Test Vendor', isActive: true } },
      existingFavorites: [{ customerId: 'customer-b', vendorId: 'vendor-1', createdAt: new Date() }],
    });

    await service.remove('customer-a', 'vendor-1');
    // Customer B's row must remain untouched.
    expect(rows).toHaveLength(1);
    expect(rows[0].customerId).toBe('customer-b');
  });

  it('GET returns only the authenticated customer\'s Favorites, joined with real Vendor data', async () => {
    const { service } = buildHarness({
      vendors: {
        'vendor-1': { id: 'vendor-1', name: 'Vendor One', nameAr: 'فيندور واحد', logoUrl: 'https://x/logo.png', isActive: true },
      },
      existingFavorites: [{ customerId: 'customer-1', vendorId: 'vendor-1', createdAt: new Date('2026-01-01') }],
    });

    const result = await service.listForCustomer('customer-1');
    expect(result).toEqual([
      {
        vendorId: 'vendor-1',
        name: 'Vendor One',
        nameAr: 'فيندور واحد',
        logoUrl: 'https://x/logo.png',
        coverImageUrl: null,
        isActive: true,
        favoritedAt: new Date('2026-01-01'),
      },
    ]);
  });

  it('CRITICAL: an inactive Vendor remains favorited — isActive read live, not hidden or removed', async () => {
    const { service } = buildHarness({
      vendors: { 'vendor-1': { id: 'vendor-1', name: 'Test Vendor', isActive: false } },
      existingFavorites: [{ customerId: 'customer-1', vendorId: 'vendor-1', createdAt: new Date() }],
    });

    const result = await service.listForCustomer('customer-1');
    expect(result).toHaveLength(1);
    expect(result[0].isActive).toBe(false);
  });
});
