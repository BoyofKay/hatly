/**
 * Full menu import (2026-11-21, owner report: "the downloaded template failed for a restaurant's menu"). Over real HTTP and PostgreSQL:
 * the template of a NEW branch, a filled menu with categories / products / options, photos in a .zip, check-then-import, no duplicates on
 * re-upload, updates through the downloaded (pre-filled) template, and "any error → nothing saved".
 */
import * as request from 'supertest';
import * as XLSX from 'xlsx';
import { bootWorld, World } from './support/world';
import { Actor, Scenario, VendorFixture } from './support/actors';
import { Permission } from '../../src/modules/permissions/permission.enum';
import { PNG_1X1_BASE64 } from '../../src/modules/uploads/image-test-fixtures';

describe('E2E — menu import', () => {
  let world: World;
  let s: Scenario;
  let admin: Actor;
  let vendor: VendorFixture;
  const png = Buffer.from(PNG_1X1_BASE64, 'base64');

  const get = (path: string) =>
    request(world.baseUrl).get(`/api/v1${path}`).set('Authorization', `Bearer ${admin.accessToken}`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  const post = (step: 'validate' | 'apply', file: Buffer, name: string, branchId = vendor.branchId) =>
    request(world.baseUrl).post(`/api/v1/admin/menu-import/${step}?vendorBranchId=${branchId}`).set('Authorization', `Bearer ${admin.accessToken}`).attach('file', file, { filename: name });

  const readTemplate = async (): Promise<XLSX.WorkBook> => {
    const res = await get(`/admin/menu-import/template?vendorBranchId=${vendor.branchId}`);
    expect(res.status).toBe(200);
    return XLSX.read(res.body as Buffer, { type: 'buffer' });
  };
  const toXlsx = (wb: XLSX.WorkBook) => XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const zipOf = (files: Record<string, Buffer>) => {
    const cfb = XLSX.CFB.utils.cfb_new();
    for (const [name, content] of Object.entries(files)) XLSX.CFB.utils.cfb_add(cfb, `/${name}`, content);
    return XLSX.CFB.write(cfb, { type: 'buffer', fileType: 'zip' }) as Buffer;
  };
  const rows = (wb: XLSX.WorkBook, sheet: string) => XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sheet], { header: 1, defval: null });
  const setRows = (wb: XLSX.WorkBook, sheet: string, data: any[][]) => { wb.Sheets[sheet] = XLSX.utils.aoa_to_sheet(data); };
  const productCount = async () => Number((await world.ds.query(`SELECT count(*) FROM products WHERE vendor_branch_id = $1 AND deleted_at IS NULL`, [vendor.branchId]))[0].count);

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    admin = await s.admin([Permission.MANAGE_CATALOG], 'Menu Importer');
    const area = await s.serviceArea({ name: 'Menu Area' });
    vendor = await s.vendor({ serviceAreaId: area.id, lat: area.lat, lng: area.lng, name: 'Menu Test Grill' });
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  it('a new branch gets a template with Instructions, Menu and Options sheets and example rows', async () => {
    const wb = await readTemplate();
    expect(wb.SheetNames).toEqual(['Instructions', 'Menu', 'Options']);
    const menu = rows(wb, 'Menu');
    expect(String(menu[0][0])).toMatch(/^productId/);
    expect(menu.length).toBe(4); // header + hint + 2 examples
    expect(rows(wb, 'Options').length).toBe(6);
  });

  it('the example template as a plain .xlsx is refused with a clear row error (it names a photo but no .zip was sent) — nothing saved', async () => {
    const before = await productCount();
    const res = await post('validate', toXlsx(await readTemplate()), 'menu.xlsx');
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('FAILED');
    const errs = JSON.stringify(res.body.data.rows);
    expect(errs).toContain('.zip');
    expect(await productCount()).toBe(before);
  });

  it('a .zip with the filled template and the photo: check is READY and writes nothing; import creates categories, products, options and the photo', async () => {
    const wb = await readTemplate();
    const zip = zipOf({ 'menu.xlsx': toXlsx(wb), 'classic-burger.jpg': png });
    const before = await productCount();

    const check = await post('validate', zip, 'menu.zip');
    expect(check.status).toBe(201);
    expect(check.body.data.status).toBe('READY');
    expect(check.body.data.counts).toEqual({ newProducts: 2, updatedProducts: 0, unchangedProducts: 0, newCategories: 2, optionGroups: 2, photos: 1 });
    expect(await productCount()).toBe(before);

    const done = await post('apply', zip, 'menu.zip');
    expect(done.status).toBe(201);
    expect(done.body.data.status).toBe('APPLIED');
    expect(await productCount()).toBe(before + 2);
    const [burger] = await world.ds.query(`SELECT id, price_minor, image_url, pricing_unit, name_ar FROM products WHERE vendor_branch_id = $1 AND name = 'Classic Burger'`, [vendor.branchId]);
    expect(burger).toEqual(expect.objectContaining({ pricing_unit: 'PIECE', name_ar: 'برجر كلاسيك' }));
    expect(Number(burger.price_minor)).toBe(9500);
    expect(burger.image_url).toMatch(/^\/uploads\/files\/.+\.png$/);
    const [kofta] = await world.ds.query(`SELECT pricing_unit, price_minor FROM products WHERE vendor_branch_id = $1 AND name = 'Kofta (per kg)'`, [vendor.branchId]);
    expect(kofta.pricing_unit).toBe('WEIGHT');
    const groups = await world.ds.query(
      `SELECT o.name, o.is_required, o.allows_multiple, count(v.id)::int AS choices FROM product_options o JOIN product_option_values v ON v.option_id = o.id
        WHERE o.product_id = $1 GROUP BY o.id ORDER BY o.name`,
      [burger.id],
    );
    expect(groups).toEqual([
      { name: 'Extras', is_required: false, allows_multiple: true, choices: 2 },
      { name: 'Size', is_required: true, allows_multiple: false, choices: 2 },
    ]);
    const cats = await world.ds.query(`SELECT name, name_ar FROM product_categories WHERE vendor_branch_id = $1 AND name IN ('Burgers','Grills') ORDER BY name`, [vendor.branchId]);
    expect(cats).toEqual([{ name: 'Burgers', name_ar: 'برجر' }, { name: 'Grills', name_ar: 'مشويات' }]);
  });

  it('uploading the same file again creates no duplicates: it is refused and nothing changes', async () => {
    const before = await productCount();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['productId', 'category', 'name', 'price'], ['', 'Burgers', 'Classic Burger', 95]]), 'Menu');
    const res = await post('apply', toXlsx(wb), 'again.xlsx');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('already exists');
    expect(await productCount()).toBe(before);
  });

  it('the downloaded template now carries productIds: changing a price updates only that product', async () => {
    const wb = await readTemplate();
    const menu = rows(wb, 'Menu');
    expect(menu.length).toBe(2 + (await productCount()));
    const priceCol = menu[0].findIndex((h: string) => String(h).startsWith('price'));
    const nameCol = menu[0].findIndex((h: string) => String(h).startsWith('name |'));
    const burgerRow = menu.findIndex((r) => r[nameCol] === 'Classic Burger');
    menu[burgerRow][priceCol] = 105.5;
    setRows(wb, 'Menu', menu);
    setRows(wb, 'Options', [rows(wb, 'Options')[0]]); // options are edited on the product page once they exist
    const res = await post('apply', toXlsx(wb), 'menu.xlsx');
    expect(res.status).toBe(201);
    expect(res.body.data.counts.updatedProducts).toBe(1);
    expect(res.body.data.counts.newProducts).toBe(0);
    const [burger] = await world.ds.query(`SELECT price_minor FROM products WHERE vendor_branch_id = $1 AND name = 'Classic Burger'`, [vendor.branchId]);
    expect(Number(burger.price_minor)).toBe(10550);
  });

  it('every row problem is reported at once (missing price, bad unit, unknown option product), and nothing is saved', async () => {
    const before = await productCount();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['productId', 'category', 'categoryAr', 'name', 'nameAr', 'price', 'unit'],
      ['', 'Drinks', 'مشروبات', 'Cola', 'كولا', '', 'PIECE'],
      ['', 'Drinks', 'مشروبات', 'Juice', 'عصير', 20, 'LITRE'],
      ['', 'Drinks', 'مشروبات', 'Water', 'مياه', 10, 'PIECE'],
      ['', 'Drinks', 'مشروبات', 'Tea', '', 10, 'PIECE'],
    ]), 'Menu');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['product', 'group', 'choice'], ['Ghost Product', 'Size', 'Big']]), 'Options');
    const res = await post('validate', toXlsx(wb), 'bad.xlsx');
    expect(res.body.data.status).toBe('FAILED');
    const byRow = Object.fromEntries(res.body.data.rows.filter((r: any) => r.sheet === 'Menu').map((r: any) => [r.rowNumber, r.errors]));
    expect(byRow[2].join(' ')).toContain('price is required');
    expect(byRow[3].join(' ')).toContain('unit must be one of');
    expect(byRow[4]).toEqual([]);
    expect(byRow[5].join(' ')).toContain('nameAr (Arabic name) is required');
    expect(JSON.stringify(res.body.data.rows.filter((r: any) => r.sheet === 'Options'))).toContain('Ghost Product');
    expect((await post('apply', toXlsx(wb), 'bad.xlsx')).status).toBe(400);
    expect(await productCount()).toBe(before);
  });

  it('a file that is not a spreadsheet is refused, and the import needs MANAGE_CATALOG', async () => {
    expect((await post('validate', Buffer.from('hello'), 'x.xlsx')).status).toBe(400);
    const other = await s.admin([Permission.VIEW_ORDERS], 'No Catalog');
    const res = await request(world.baseUrl).post(`/api/v1/admin/menu-import/validate?vendorBranchId=${vendor.branchId}`).set('Authorization', `Bearer ${other.accessToken}`).attach('file', Buffer.from('x'), { filename: 'x.xlsx' });
    expect(res.status).toBe(403);
  });
});
