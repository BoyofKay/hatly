/**
 * Owner decision 2026-11-28: search matches Arabic spelling variants (أ/إ/آ → ا, ى → ي, ة → ه, diacritics), index-backed.
 */
import { bootWorld, World } from './support/world';
import { Scenario, expectData } from './support/actors';

describe('E2E — Arabic search spelling', () => {
  let world: World;
  let s: Scenario;

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    const area = await s.serviceArea({ radiusMeters: 50000 });
    const v = await s.vendor({ name: 'Al Amal Pharmacy', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    await world.ds.query(`UPDATE vendors SET name_ar = 'صيدلية الأمل' WHERE id = $1`, [v.vendorId]);
    const p = await s.product(v, { name: 'Ahmad Tea', priceMinor: 5000, inventoryMode: 'OPEN' });
    await world.ds.query(`UPDATE products SET name_ar = 'شاي أحمد الإنجليزي' WHERE id = $1`, [p.id]);
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  const search = async (q: string) => expectData<any>(await world.api('get', '/search', { query: { q } }));

  it.each([
    ['صيدليه الامل', 'store: ة typed as ه, أ typed as ا'],
    ['صَيدلية الأمل', 'store: with a diacritic'],
  ])('finds the store for "%s" (%s)', async (q) => {
    const r = await search(q);
    expect(r.vendors.data.map((x: any) => x.name ?? x.vendorName).join('|')).toContain('Al Amal Pharmacy');
  });

  it.each([['احمد'], ['الانجليزي'], ['AHMAD']])('finds the product for "%s"', async (q) => {
    const r = await search(q);
    expect(r.products.data.length).toBeGreaterThan(0);
  });

  it('the normalized names are indexed (trigram GIN on hatly_norm)', async () => {
    const rows = await world.ds.query(`SELECT indexname FROM pg_indexes WHERE indexname LIKE '%norm_trgm'`);
    expect(rows.length).toBe(6);
  });
});
