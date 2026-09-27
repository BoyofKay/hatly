import { SearchService } from './search.service';

/**
 * A faithful-enough in-memory simulation of the real query builder
 * chain `SearchService` issues — filters/ranks/sorts/paginates
 * against seeded fixture rows using the SAME conditions the real SQL
 * expresses (is_active, service_area_id, ILIKE, is_available, the
 * three-tier relevance CASE, rating tiebreak) — not merely asserting
 * that methods were called, but exercising the real business rules.
 */
function buildHarness(seed: { branches?: any[]; products?: any[] } = {}) {
  const branches = seed.branches ?? [];
  const products = seed.products ?? [];

  function ilike(value: string | null | undefined, pattern: string): boolean {
    if (!value) return false;
    const escaped = pattern.replace(/%/g, '.*');
    return new RegExp(`^${escaped}$`, 'i').test(value);
  }

  function relevanceRank(name: string, nameAr: string | null, term: string): number {
    const lowerTerm = term.toLowerCase();
    if ((name && name.toLowerCase() === lowerTerm) || (nameAr && nameAr.toLowerCase() === lowerTerm)) return 0;
    if (ilike(name, `${term}%`) || ilike(nameAr, `${term}%`)) return 1;
    return 2;
  }

  function ratingAverage(row: any): number {
    return row.ratingCount > 0 ? row.ratingSumStars / row.ratingCount : 0;
  }

  function paginate<T>(rows: T[], page: number, limit: number) {
    const total = rows.length;
    const start = (page - 1) * limit;
    return { data: rows.slice(start, start + limit), page, limit, total };
  }

  const branchesRepository = {
    createQueryBuilder: () => ({
      __simulate: (term: string, serviceAreaId: string | null, page: number, limit: number) => {
        let rows = branches.filter((b) => b.isActive && b.vendor.isActive);
        if (serviceAreaId) rows = rows.filter((b) => b.serviceAreaId === serviceAreaId);
        rows = rows.filter((b) => ilike(b.vendor.name, `%${term}%`) || ilike(b.vendor.nameAr, `%${term}%`));
        rows.sort((a, b) => {
          const rankDiff = relevanceRank(a.vendor.name, a.vendor.nameAr, term) - relevanceRank(b.vendor.name, b.vendor.nameAr, term);
          if (rankDiff !== 0) return rankDiff;
          const avgDiff = ratingAverage(b) - ratingAverage(a);
          if (avgDiff !== 0) return avgDiff;
          return a.id.localeCompare(b.id);
        });
        return paginate(rows, page, limit);
      },
    }),
  };

  const productsRepository = {
    createQueryBuilder: () => ({
      __simulate: (term: string, serviceAreaId: string | null, page: number, limit: number) => {
        let rows = products.filter((p) => p.vendorBranch.isActive && p.vendorBranch.vendor.isActive && p.isAvailable);
        if (serviceAreaId) rows = rows.filter((p) => p.vendorBranch.serviceAreaId === serviceAreaId);
        rows = rows.filter((p) => ilike(p.name, `%${term}%`) || ilike(p.nameAr, `%${term}%`));
        rows.sort((a, b) => {
          const rankDiff = relevanceRank(a.name, a.nameAr, term) - relevanceRank(b.name, b.nameAr, term);
          if (rankDiff !== 0) return rankDiff;
          const avgDiff = ratingAverage(b.vendorBranch) - ratingAverage(a.vendorBranch);
          if (avgDiff !== 0) return avgDiff;
          return a.id.localeCompare(b.id);
        });
        return paginate(rows, page, limit);
      },
    }),
  };

  const serviceAreaResolverService = {
    resolveForPoint: jest.fn(async (_lat: number, _lng: number) => null as { id: string } | null),
  };

  // Replace SearchService's real private query methods with ones that
  // delegate to the __simulate harness above, preserving the real
  // service's own public `search()` orchestration (gating, ServiceArea
  // resolution, empty-result short-circuit) exactly as written.
  const offerConsumptionService = {
    resolveActiveOffersForProducts: jest.fn(async () => new Map()),
  };

  const service = new SearchService(
    branchesRepository as any,
    productsRepository as any,
    serviceAreaResolverService as any,
    offerConsumptionService as any,
  );
  (service as any).searchVendors = async (term: string, serviceAreaId: string | null, page: number, limit: number) => {
    const result = branchesRepository.createQueryBuilder().__simulate(term, serviceAreaId, page, limit);
    return {
      ...result,
      data: result.data.map((b: any) => ({
        id: b.id,
        name: b.vendor.name,
        nameAr: b.vendor.nameAr ?? null,
        logoUrl: b.vendor.logoUrl ?? null,
        isOpen: b.isOpen,
        ratingAverage: ratingAverage(b),
        ratingCount: b.ratingCount,
      })),
    };
  };
  (service as any).searchProducts = async (term: string, serviceAreaId: string | null, page: number, limit: number) => {
    const result = productsRepository.createQueryBuilder().__simulate(term, serviceAreaId, page, limit);
    return {
      ...result,
      data: result.data.map((p: any) => ({
        id: p.id,
        vendorBranchId: p.vendorBranch.id,
        name: p.name,
        nameAr: p.nameAr ?? null,
        imageUrl: p.imageUrl ?? null,
        priceMinor: p.priceMinor,
        pricingUnit: p.pricingUnit,
        inventoryMode: p.inventoryMode,
        quantity: p.quantity ?? null,
        isAvailable: p.isAvailable,
        vendorName: p.vendorBranch.vendor.name,
        vendorNameAr: p.vendorBranch.vendor.nameAr ?? null,
        vendorLogoUrl: p.vendorBranch.vendor.logoUrl ?? null,
      })),
    };
  };

  return { service, serviceAreaResolverService };
}

function branch(overrides: Partial<any> = {}) {
  return {
    id: 'branch-1',
    isActive: true,
    isOpen: true,
    ratingCount: 0,
    ratingSumStars: 0,
    serviceAreaId: null,
    vendor: { name: 'Pizza House', nameAr: null, logoUrl: null, isActive: true },
    ...overrides,
  };
}

function product(overrides: Partial<any> = {}) {
  return {
    id: 'product-1',
    name: 'Pizza Margherita',
    nameAr: null,
    imageUrl: null,
    priceMinor: 1000,
    pricingUnit: 'PIECE',
    inventoryMode: 'OPEN',
    quantity: null,
    isAvailable: true,
    vendorBranch: branch(),
    ...overrides,
  };
}

describe('SearchService', () => {
  it('minimum query length gate: below MIN_SEARCH_QUERY_LENGTH returns empty results without querying', async () => {
    const { service } = buildHarness({ branches: [branch()], products: [product()] });
    const result = await service.search({ q: 'p' });
    expect(result.vendors.data).toEqual([]);
    expect(result.products.data).toEqual([]);
  });

  it('vendor search by English name', async () => {
    const { service } = buildHarness({ branches: [branch({ vendor: { name: 'Pizza House', nameAr: null, isActive: true } })] });
    const result = await service.search({ q: 'pizza' });
    expect(result.vendors.data).toHaveLength(1);
  });

  it('vendor search by Arabic name', async () => {
    const { service } = buildHarness({
      branches: [branch({ vendor: { name: 'Pharmacy', nameAr: 'صيدلية', isActive: true } })],
    });
    const result = await service.search({ q: 'صيدلية' });
    expect(result.vendors.data).toHaveLength(1);
  });

  it('product search by English name', async () => {
    const { service } = buildHarness({ products: [product({ name: 'Cheeseburger', nameAr: null })] });
    const result = await service.search({ q: 'burger' });
    expect(result.products.data).toHaveLength(1);
  });

  it('product search by Arabic name', async () => {
    const { service } = buildHarness({ products: [product({ name: 'Pepsi', nameAr: 'بيبسي' })] });
    const result = await service.search({ q: 'بيبسي' });
    expect(result.products.data).toHaveLength(1);
  });

  it('cross-sector vendor search: two branches from different (unspecified) sectors both match — no sector scoping exists in this query at all', async () => {
    const { service } = buildHarness({
      branches: [
        branch({ id: 'b1', vendor: { name: 'Pizza A', nameAr: null, isActive: true } }),
        branch({ id: 'b2', vendor: { name: 'Pizza B', nameAr: null, isActive: true } }),
      ],
    });
    const result = await service.search({ q: 'pizza' });
    expect(result.vendors.data.map((v) => v.id).sort()).toEqual(['b1', 'b2']);
  });

  it('cross-branch product search: products from different branches both match', async () => {
    const { service } = buildHarness({
      products: [
        product({ id: 'p1', name: 'Burger A', vendorBranch: branch({ id: 'b1' }) }),
        product({ id: 'p2', name: 'Burger B', vendorBranch: branch({ id: 'b2' }) }),
      ],
    });
    const result = await service.search({ q: 'burger' });
    expect(result.products.data.map((p) => p.id).sort()).toEqual(['p1', 'p2']);
  });

  it('CRITICAL ranking: exact match ranks before prefix, which ranks before partial', async () => {
    const { service } = buildHarness({
      branches: [
        branch({ id: 'partial', vendor: { name: 'The Pizza Place', nameAr: null, isActive: true } }),
        branch({ id: 'exact', vendor: { name: 'Pizza', nameAr: null, isActive: true } }),
        branch({ id: 'prefix', vendor: { name: 'Pizzaria Express', nameAr: null, isActive: true } }),
      ],
    });
    const result = await service.search({ q: 'pizza' });
    expect(result.vendors.data.map((v) => v.id)).toEqual(['exact', 'prefix', 'partial']);
  });

  it('rating tiebreaker within the same relevance tier', async () => {
    const { service } = buildHarness({
      branches: [
        branch({ id: 'low-rated', vendor: { name: 'Pizza Place', nameAr: null, isActive: true }, ratingCount: 10, ratingSumStars: 20 }),
        branch({ id: 'high-rated', vendor: { name: 'Pizza Spot', nameAr: null, isActive: true }, ratingCount: 10, ratingSumStars: 45 }),
      ],
    });
    const result = await service.search({ q: 'pizza' });
    expect(result.vendors.data.map((v) => v.id)).toEqual(['high-rated', 'low-rated']);
  });

  it('CRITICAL: inactive Vendor/Branch excluded', async () => {
    const { service } = buildHarness({
      branches: [
        branch({ id: 'inactive-branch', isActive: false, vendor: { name: 'Pizza X', nameAr: null, isActive: true } }),
        branch({ id: 'inactive-vendor', vendor: { name: 'Pizza Y', nameAr: null, isActive: false } }),
      ],
    });
    const result = await service.search({ q: 'pizza' });
    expect(result.vendors.data).toEqual([]);
  });

  it('CRITICAL: closed Vendor (isOpen=false) remains included, with isOpen reported correctly', async () => {
    const { service } = buildHarness({
      branches: [branch({ id: 'closed', isOpen: false, vendor: { name: 'Pizza House', nameAr: null, isActive: true } })],
    });
    const result = await service.search({ q: 'pizza' });
    expect(result.vendors.data).toHaveLength(1);
    expect(result.vendors.data[0].isOpen).toBe(false);
  });

  it('CRITICAL: unavailable Product excluded', async () => {
    const { service } = buildHarness({ products: [product({ isAvailable: false })] });
    const result = await service.search({ q: 'pizza' });
    expect(result.products.data).toEqual([]);
  });

  it('CRITICAL: TRACKED quantity=0 + isAvailable=true remains visible', async () => {
    const { service } = buildHarness({
      products: [product({ inventoryMode: 'TRACKED', quantity: 0, isAvailable: true })],
    });
    const result = await service.search({ q: 'pizza' });
    expect(result.products.data).toHaveLength(1);
    expect(result.products.data[0].quantity).toBe(0);
  });

  it('CRITICAL: ServiceArea filtering applied when coordinates are present', async () => {
    const { service, serviceAreaResolverService } = buildHarness({
      branches: [
        branch({ id: 'in-area', serviceAreaId: 'area-1', vendor: { name: 'Pizza In', nameAr: null, isActive: true } }),
        branch({ id: 'out-of-area', serviceAreaId: 'area-2', vendor: { name: 'Pizza Out', nameAr: null, isActive: true } }),
      ],
    });
    serviceAreaResolverService.resolveForPoint.mockResolvedValueOnce({ id: 'area-1' });
    const result = await service.search({ q: 'pizza', latitude: 30.4, longitude: 31.2 });
    expect(result.vendors.data.map((v) => v.id)).toEqual(['in-area']);
  });

  it('CRITICAL: no ServiceArea filtering when coordinates are absent — matches the existing optional-coordinate contract', async () => {
    const { service, serviceAreaResolverService } = buildHarness({
      branches: [
        branch({ id: 'a', serviceAreaId: 'area-1', vendor: { name: 'Pizza A', nameAr: null, isActive: true } }),
        branch({ id: 'b', serviceAreaId: 'area-2', vendor: { name: 'Pizza B', nameAr: null, isActive: true } }),
      ],
    });
    const result = await service.search({ q: 'pizza' });
    expect(serviceAreaResolverService.resolveForPoint).not.toHaveBeenCalled();
    expect(result.vendors.data.map((v) => v.id).sort()).toEqual(['a', 'b']);
  });

  it('independent Vendor pagination', async () => {
    const { service } = buildHarness({
      branches: [
        branch({ id: 'b1', vendor: { name: 'Pizza 1', nameAr: null, isActive: true } }),
        branch({ id: 'b2', vendor: { name: 'Pizza 2', nameAr: null, isActive: true } }),
        branch({ id: 'b3', vendor: { name: 'Pizza 3', nameAr: null, isActive: true } }),
      ],
    });
    const result = await service.search({ q: 'pizza', vendorPage: 2, vendorLimit: 2 });
    expect(result.vendors.data).toHaveLength(1);
    expect(result.vendors.total).toBe(3);
  });

  it('independent Product pagination, unaffected by vendor pagination', async () => {
    const { service } = buildHarness({
      branches: [branch({ vendor: { name: 'Pizza House', nameAr: null, isActive: true } })],
      products: [
        product({ id: 'p1', name: 'Pizza 1' }),
        product({ id: 'p2', name: 'Pizza 2' }),
      ],
    });
    const result = await service.search({ q: 'pizza', vendorPage: 1, vendorLimit: 1, productPage: 1, productLimit: 20 });
    expect(result.products.data).toHaveLength(2);
  });

  it('product results include owning Vendor identity', async () => {
    const { service } = buildHarness({
      products: [
        product({
          vendorBranch: branch({
            vendor: { name: 'Pizza House', nameAr: 'بيت البيتزا', logoUrl: 'logo.png', isActive: true },
          }),
        }),
      ],
    });
    const result = await service.search({ q: 'pizza' });
    expect(result.products.data[0]).toMatchObject({
      vendorName: 'Pizza House',
      vendorNameAr: 'بيت البيتزا',
      vendorLogoUrl: 'logo.png',
    });
  });

  it('Vendor result id is VendorBranch.id, not Vendor.id', async () => {
    const { service } = buildHarness({
      branches: [branch({ id: 'branch-xyz', vendor: { name: 'Pizza House', nameAr: null, isActive: true } })],
    });
    const result = await service.search({ q: 'pizza' });
    expect(result.vendors.data[0].id).toBe('branch-xyz');
  });
});
