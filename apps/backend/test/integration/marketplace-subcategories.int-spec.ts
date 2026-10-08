import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { TestData } from './support/test-data';
import { MarketplaceSector } from '../../src/modules/sectors/entities/marketplace-sector.entity';
import { MarketplaceSubcategory } from '../../src/modules/sectors/entities/marketplace-subcategory.entity';
import { VendorBranchSubcategory } from '../../src/modules/sectors/entities/vendor-branch-subcategory.entity';

/**
 * Consolidated customer-commerce milestone (Part E — Sector
 * Subcategories), real PostgreSQL proof of the NEW schema this
 * milestone adds: `marketplace_subcategories` and the genuine
 * many-to-many join `vendor_branch_subcategories`. The generic
 * `schema-integrity.int-spec.ts` / `referential-integrity.int-spec.ts`
 * suites already prove every FK this migration declares is real and
 * validated (no changes were needed there — this migration's inline
 * `REFERENCES` clauses satisfied those generic checks automatically);
 * this file proves the behavior those structural checks don't reach:
 * actual INSERT-time constraint enforcement.
 *
 * `vendor_branch_subcategories` has no surrogate `id` (a composite
 * primary key on the pair itself — see the entity's own doc comment),
 * so this file cleans up its own rows directly rather than through
 * `TestData`'s generic `id`-keyed tracking.
 */
describe('Real PostgreSQL — marketplace_subcategories / vendor_branch_subcategories', () => {
  let ds: DataSource;
  let data: TestData;
  const branchSubcategoryPairs: Array<{ vendorBranchId: string; subcategoryId: string }> = [];

  beforeAll(async () => {
    const { AppDataSource } = await import('../../src/database/data-source');
    ds = AppDataSource;
    if (!ds.isInitialized) await ds.initialize();
    data = new TestData(ds);
  });

  afterEach(async () => {
    for (const { vendorBranchId, subcategoryId } of branchSubcategoryPairs.splice(0)) {
      await ds.query('DELETE FROM vendor_branch_subcategories WHERE vendor_branch_id = $1 AND subcategory_id = $2', [
        vendorBranchId,
        subcategoryId,
      ]);
    }
    await data.dispose();
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  async function makeSector(): Promise<MarketplaceSector> {
    return data.save<MarketplaceSector>(MarketplaceSector, {
      name: 'Restaurants',
      slug: `restaurants-${randomUUID()}`,
      sortOrder: 0,
      isActive: true,
    });
  }

  async function makeSubcategory(sectorId: string, overrides: Partial<MarketplaceSubcategory> = {}): Promise<MarketplaceSubcategory> {
    return data.save<MarketplaceSubcategory>(MarketplaceSubcategory, {
      sectorId,
      name: 'Burgers',
      sortOrder: 0,
      isActive: true,
      ...overrides,
    });
  }

  async function assignBranchToSubcategory(vendorBranchId: string, subcategoryId: string): Promise<void> {
    await ds.getRepository(VendorBranchSubcategory).insert({ vendorBranchId, subcategoryId });
    branchSubcategoryPairs.push({ vendorBranchId, subcategoryId });
  }

  it('creates a subcategory row under a real sector', async () => {
    const sector = await makeSector();
    const subcategory = await makeSubcategory(sector.id);
    expect(subcategory.id).toBeDefined();
    expect(subcategory.sectorId).toBe(sector.id);
  });

  it('rejects a subcategory whose sectorId does not reference a real sector (real FK constraint)', async () => {
    await expect(makeSubcategory(randomUUID())).rejects.toThrow(/foreign key/i);
  });

  it('assigns a branch to a subcategory — a real row in the join table', async () => {
    const sector = await makeSector();
    const subcategory = await makeSubcategory(sector.id);
    const branch = await data.vendorBranch();
    await assignBranchToSubcategory(branch.id, subcategory.id);

    const [row] = await ds.query(
      'SELECT * FROM vendor_branch_subcategories WHERE vendor_branch_id = $1 AND subcategory_id = $2',
      [branch.id, subcategory.id],
    );
    expect(row).toBeDefined();
  });

  it('a branch can be assigned to MULTIPLE subcategories — the genuine many-to-many this milestone requires', async () => {
    const sector = await makeSector();
    const subcategoryA = await makeSubcategory(sector.id, { name: 'Burgers' });
    const subcategoryB = await makeSubcategory(sector.id, { name: 'Pizza' });
    const branch = await data.vendorBranch();
    await assignBranchToSubcategory(branch.id, subcategoryA.id);
    await assignBranchToSubcategory(branch.id, subcategoryB.id);

    const rows = await ds.query('SELECT subcategory_id FROM vendor_branch_subcategories WHERE vendor_branch_id = $1', [branch.id]);
    expect(rows.map((r: any) => r.subcategory_id).sort()).toEqual([subcategoryA.id, subcategoryB.id].sort());
  });

  it('rejects a duplicate (vendor_branch_id, subcategory_id) pair — the composite primary key enforces "assigned at most once"', async () => {
    const sector = await makeSector();
    const subcategory = await makeSubcategory(sector.id);
    const branch = await data.vendorBranch();
    await assignBranchToSubcategory(branch.id, subcategory.id);

    await expect(assignBranchToSubcategory(branch.id, subcategory.id)).rejects.toThrow(/duplicate key/i);
  });

  it('rejects a join row referencing a nonexistent vendor branch (real FK constraint)', async () => {
    const sector = await makeSector();
    const subcategory = await makeSubcategory(sector.id);
    await expect(assignBranchToSubcategory(randomUUID(), subcategory.id)).rejects.toThrow(/foreign key/i);
  });

  it('rejects a join row referencing a nonexistent subcategory (real FK constraint)', async () => {
    const branch = await data.vendorBranch();
    await expect(assignBranchToSubcategory(branch.id, randomUUID())).rejects.toThrow(/foreign key/i);
  });
});
