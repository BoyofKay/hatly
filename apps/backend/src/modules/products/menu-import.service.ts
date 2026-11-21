import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import * as XLSX from 'xlsx';
import { UploadsService } from '../uploads/uploads.service';
import { Product } from './entities/product.entity';
import { InventoryMode } from './inventory-mode.enum';
import { PricingUnit } from './pricing-unit.enum';
import { ProductOptionsService } from './product-options.service';
import { ProductsService } from './products.service';
import { MAX_OPTION_GROUPS_PER_PRODUCT, MAX_VALUES_PER_OPTION_GROUP } from './dto/product-option.dto';

/**
 * Full menu import for a store branch (owner report 2026-11-21: "I tried to upload a restaurant's menu using the downloaded template and it
 * failed"). The old template (ProductExcelImportService, kept for vendors) can only UPDATE products that already exist — every row needs a
 * productId — so a new restaurant's menu could never be uploaded with it.
 *
 * This import does what onboarding needs, in ONE upload:
 *  - "Menu" sheet: one row per product. productId empty → a NEW product; productId filled → that product is updated. Categories are
 *    matched by name and created when new. Price, unit (piece / kg), stock, availability, Arabic names and descriptions.
 *  - "Options" sheet (optional): option groups and their choices (sizes, add-ons, …), one row per choice, with an extra price.
 *  - Photos (optional): upload a .zip that holds the .xlsx AND the photos; the "image" column names the photo file. Each photo is checked
 *    (real JPEG/PNG/WebP, ≤ 5 MB) and stored exactly like a photo uploaded on the product page.
 *
 * Safety: Validate never writes anything. Apply re-reads and re-checks the same file and runs everything in ONE database transaction —
 * any error and nothing is saved. Re-uploading the same file does not duplicate products (a new row whose name already exists in the
 * branch is refused: use the downloaded template, which carries each product's id).
 */

export const MENU_IMPORT_MAX_UPLOAD_BYTES = 60 * 1024 * 1024;
const MAX_MENU_ROWS = 500;
const MAX_OPTION_ROWS = 3000;
const MAX_PHOTOS = 400;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

interface Col { key: string; en: string; ar: string; width: number }
const MENU_COLS: Col[] = [
  { key: 'productId', en: 'leave empty for a new product', ar: 'اتركه فارغًا للمنتج الجديد', width: 38 },
  { key: 'category', en: 'category', ar: 'القسم', width: 20 },
  { key: 'categoryAr', en: 'category (Arabic)', ar: 'القسم بالعربي', width: 20 },
  { key: 'name', en: 'product name', ar: 'اسم المنتج', width: 26 },
  { key: 'nameAr', en: 'name (Arabic)', ar: 'الاسم بالعربي', width: 26 },
  { key: 'description', en: 'description', ar: 'الوصف', width: 30 },
  { key: 'descriptionAr', en: 'description (Arabic)', ar: 'الوصف بالعربي', width: 30 },
  { key: 'price', en: 'price EGP', ar: 'السعر بالجنيه', width: 12 },
  { key: 'unit', en: 'PIECE or WEIGHT', ar: 'قطعة أو وزن', width: 12 },
  { key: 'stock', en: 'OPEN or TRACKED', ar: 'مفتوح أو محدود', width: 12 },
  { key: 'quantity', en: 'pieces / grams', ar: 'الكمية', width: 10 },
  { key: 'available', en: 'TRUE / FALSE', ar: 'متاح', width: 10 },
  { key: 'image', en: 'photo file name', ar: 'اسم ملف الصورة', width: 22 },
];
const OPTION_COLS: Col[] = [
  { key: 'product', en: 'product name or id', ar: 'اسم المنتج أو رقمه', width: 26 },
  { key: 'group', en: 'option group', ar: 'مجموعة الاختيارات', width: 20 },
  { key: 'groupAr', en: 'group (Arabic)', ar: 'المجموعة بالعربي', width: 20 },
  { key: 'required', en: 'TRUE / FALSE', ar: 'إجباري', width: 10 },
  { key: 'multiple', en: 'TRUE / FALSE', ar: 'اختيار متعدد', width: 10 },
  { key: 'min', en: 'min choices', ar: 'أقل عدد', width: 8 },
  { key: 'max', en: 'max choices', ar: 'أكبر عدد', width: 8 },
  { key: 'choice', en: 'choice', ar: 'الاختيار', width: 20 },
  { key: 'choiceAr', en: 'choice (Arabic)', ar: 'الاختيار بالعربي', width: 20 },
  { key: 'extraPrice', en: 'extra EGP (+/-)', ar: 'سعر إضافي', width: 12 },
];

export interface MenuImportRowReport {
  sheet: 'Menu' | 'Options' | 'Photos';
  rowNumber: number | null;
  label: string | null;
  action: 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'OPTIONS' | 'SKIP';
  errors: string[];
}

export interface MenuImportSummary {
  status: 'READY' | 'FAILED' | 'APPLIED';
  counts: { newProducts: number; updatedProducts: number; unchangedProducts: number; newCategories: number; optionGroups: number; photos: number };
  rows: MenuImportRowReport[];
}

interface MenuRow {
  rowNumber: number;
  productId: string | null;
  category: string | null;
  categoryAr: string | null;
  name: string | null;
  nameAr: string | null;
  description: string | null;
  descriptionAr: string | null;
  priceMinor: number | null;
  unit: PricingUnit | null;
  stock: InventoryMode | null;
  quantity: number | null;
  available: boolean | null;
  image: string | null;
  report: MenuImportRowReport;
}

interface OptionGroupPlan {
  productRef: string;
  rowNumber: number;
  name: string;
  nameAr: string | null;
  isRequired: boolean;
  allowsMultiple: boolean;
  minSelections?: number;
  maxSelections?: number;
  values: Array<{ name: string; nameAr: string | null; priceDeltaMinor: number }>;
  report: MenuImportRowReport;
}

const ROLLBACK = Symbol('menu-import-rollback');
const lc = (s: string) => s.trim().toLocaleLowerCase();

@Injectable()
export class MenuImportService {
  constructor(
    private readonly ds: DataSource,
    private readonly products: ProductsService,
    private readonly options: ProductOptionsService,
    private readonly uploads: UploadsService,
  ) {}

  // ================================================================== template

  async template(branchId: string): Promise<Buffer> {
    await this.requireBranch(branchId);
    const rows: Array<Record<string, any>> = await this.ds.query(
      `SELECT p.id, p.name, p.name_ar, p.description, p.description_ar, p.price_minor, p.pricing_unit, p.inventory_mode, p.quantity, p.is_available,
              c.name AS category, c.name_ar AS category_ar
         FROM products p JOIN product_categories c ON c.id = p.category_id
        WHERE p.vendor_branch_id = $1 AND p.deleted_at IS NULL
        ORDER BY c.sort_order, c.name, p.name`,
      [branchId],
    );
    const menu: any[][] = [MENU_COLS.map((c) => `${c.key} | ${c.ar}`), MENU_COLS.map((c) => c.en)];
    for (const p of rows) {
      menu.push([p.id, p.category, p.category_ar ?? '', p.name, p.name_ar ?? '', p.description ?? '', p.description_ar ?? '', Number(p.price_minor) / 100, p.pricing_unit, p.inventory_mode, p.quantity ?? '', p.is_available ? 'TRUE' : 'FALSE', '']);
    }
    if (rows.length === 0) {
      // A new store: two example rows the admin overwrites (they are real rows — delete them if not wanted).
      menu.push(['', 'Burgers', 'برجر', 'Classic Burger', 'برجر كلاسيك', 'Beef patty, cheese, lettuce', 'لحم بقري وجبنة وخس', 95, 'PIECE', 'OPEN', '', 'TRUE', 'classic-burger.jpg']);
      menu.push(['', 'Grills', 'مشويات', 'Kofta (per kg)', 'كفتة (بالكيلو)', '', '', 420, 'WEIGHT', 'OPEN', '', 'TRUE', '']);
    }
    const options: any[][] = [OPTION_COLS.map((c) => `${c.key} | ${c.ar}`), OPTION_COLS.map((c) => c.en)];
    if (rows.length === 0) {
      options.push(['Classic Burger', 'Size', 'الحجم', 'TRUE', 'FALSE', '', '', 'Single', 'سنجل', 0]);
      options.push(['Classic Burger', 'Size', 'الحجم', '', '', '', '', 'Double', 'دبل', 40]);
      options.push(['Classic Burger', 'Extras', 'إضافات', 'FALSE', 'TRUE', 0, 3, 'Extra cheese', 'جبنة زيادة', 15]);
      options.push(['Classic Burger', 'Extras', 'إضافات', '', '', '', '', 'Bacon', 'بيكون', 25]);
    }
    const wb = XLSX.utils.book_new();
    const instructions = XLSX.utils.aoa_to_sheet(INSTRUCTIONS.map((line) => [line]));
    instructions['!cols'] = [{ wch: 120 }];
    XLSX.utils.book_append_sheet(wb, instructions, 'Instructions');
    const menuSheet = XLSX.utils.aoa_to_sheet(menu);
    menuSheet['!cols'] = MENU_COLS.map((c) => ({ wch: c.width }));
    XLSX.utils.book_append_sheet(wb, menuSheet, 'Menu');
    const optionSheet = XLSX.utils.aoa_to_sheet(options);
    optionSheet['!cols'] = OPTION_COLS.map((c) => ({ wch: c.width }));
    XLSX.utils.book_append_sheet(wb, optionSheet, 'Options');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  // ================================================================== validate / apply

  validate(branchId: string, upload: Buffer): Promise<MenuImportSummary> {
    return this.run(branchId, upload, null);
  }

  async apply(branchId: string, upload: Buffer, actor: { userId: string; role: string }): Promise<MenuImportSummary> {
    const checked = await this.run(branchId, upload, null);
    if (checked.status === 'FAILED') {
      throw new BadRequestException({ message: 'The file has errors. Nothing was saved.', details: { code: 'IMPORT_VALIDATION_FAILED', summary: checked } });
    }
    return this.run(branchId, upload, actor);
  }

  private async run(branchId: string, upload: Buffer, actor: { userId: string; role: string } | null): Promise<MenuImportSummary> {
    await this.requireBranch(branchId);
    const { workbook, photos } = this.unpack(upload);
    const menuRows = this.parseMenu(workbook);
    const groups = this.parseOptions(workbook);
    const counts = { newProducts: 0, updatedProducts: 0, unchangedProducts: 0, newCategories: 0, optionGroups: 0, photos: 0 };
    const extra: MenuImportRowReport[] = [];

    // ---- checks that need the database but write nothing
    const existing: Array<{ id: string; name: string; pricing_unit: string; has_options: boolean }> = await this.ds.query(
      `SELECT p.id, p.name, p.pricing_unit, EXISTS (SELECT 1 FROM product_options o WHERE o.product_id = p.id AND o.deleted_at IS NULL) AS has_options
         FROM products p WHERE p.vendor_branch_id = $1 AND p.deleted_at IS NULL`,
      [branchId],
    );
    const byId = new Map(existing.map((p) => [p.id, p]));
    const byName = new Map(existing.map((p) => [lc(p.name), p]));
    const newNames = new Map<string, number>();
    for (const r of menuRows) {
      if (r.productId) {
        const p = byId.get(r.productId);
        if (!p) r.report.errors.push('productId is not a product of this branch (it may have been deleted). Clear it to add the row as a new product.');
        else if (r.unit && r.unit !== p.pricing_unit) r.report.errors.push('The unit (PIECE / WEIGHT) of an existing product cannot change. Add a new product instead.');
      } else if (r.name) {
        if (byName.has(lc(r.name))) r.report.errors.push(`A product named "${r.name}" already exists in this branch. To change it, use the downloaded template (its row carries the productId).`);
        const seen = newNames.get(lc(r.name));
        if (seen) r.report.errors.push(`The same new product name is also on row ${seen}.`);
        else newNames.set(lc(r.name), r.rowNumber);
      }
      if (r.image) {
        if (!photos) r.report.errors.push('This row names a photo, but the upload is a plain .xlsx. Put the .xlsx and the photos in one .zip and upload the .zip.');
        else if (!photos.has(lc(r.image))) r.report.errors.push(`Photo "${r.image}" is not in the .zip.`);
      }
    }
    const seenIds = new Map<string, number>();
    for (const r of menuRows) {
      if (!r.productId) continue;
      const first = seenIds.get(r.productId);
      if (first) r.report.errors.push(`The same productId is also on row ${first}.`);
      else seenIds.set(r.productId, r.rowNumber);
    }
    // option groups → their product
    const menuByName = new Map(menuRows.filter((r) => r.name).map((r) => [lc(r.name!), r]));
    const groupsPerProduct = new Map<string, number>();
    for (const g of groups) {
      const target = byId.get(g.productRef) ?? byName.get(lc(g.productRef));
      const fromMenu = menuByName.get(lc(g.productRef)) ?? menuRows.find((r) => r.productId === g.productRef);
      if (!target && !fromMenu) g.report.errors.push(`Product "${g.productRef}" is not on the Menu sheet and not in this branch.`);
      const existingTarget = target ?? (fromMenu?.productId ? byId.get(fromMenu.productId) : undefined);
      if (existingTarget?.has_options) {
        g.report.errors.push(`"${existingTarget.name}" already has option groups. Edit them on the product page (or delete them there) — the import only adds options to products without any.`);
      }
      const key = lc(g.productRef);
      groupsPerProduct.set(key, (groupsPerProduct.get(key) ?? 0) + 1);
      if (groupsPerProduct.get(key)! > MAX_OPTION_GROUPS_PER_PRODUCT) g.report.errors.push(`A product can have at most ${MAX_OPTION_GROUPS_PER_PRODUCT} option groups.`);
    }
    if (photos) {
      const used = new Set(menuRows.map((r) => (r.image ? lc(r.image) : '')).filter(Boolean));
      if (used.size > MAX_PHOTOS) extra.push({ sheet: 'Photos', rowNumber: null, label: null, action: 'SKIP', errors: [`At most ${MAX_PHOTOS} photos per upload.`] });
      for (const name of used) {
        const ph = photos.get(name);
        if (ph && ph.content.length > MAX_PHOTO_BYTES) extra.push({ sheet: 'Photos', rowNumber: null, label: ph.name, action: 'SKIP', errors: ['Photo is larger than 5 MB.'] });
      }
    }

    const allReports = () => [...menuRows.map((r) => r.report), ...groups.map((g) => g.report), ...extra];
    const failed = () => allReports().some((r) => r.errors.length > 0);
    if (failed()) return { status: 'FAILED', counts, rows: allReports() };

    // ---- photos are stored before the transaction (storage is not transactional); only on Apply
    const photoUrls = new Map<string, string>();
    if (actor && photos) {
      for (const r of menuRows) {
        if (!r.image || photoUrls.has(lc(r.image))) continue;
        const ph = photos.get(lc(r.image))!;
        try {
          const up = await this.uploads.upload(Buffer.from(ph.content).toString('base64'), ph.name, actor.userId);
          photoUrls.set(lc(r.image), up.url);
        } catch (err: any) {
          r.report.errors.push(`Photo "${r.image}": ${err?.response?.message ?? err?.message ?? 'not a valid image'}`);
        }
      }
      if (failed()) return { status: 'FAILED', counts, rows: allReports() };
    }

    // ---- the database work: one transaction; every row in its own savepoint so all errors are reported; rolled back unless applying
    try {
      await this.ds.transaction(async (m) => {
        const categoryIds = await this.ensureCategories(m, branchId, menuRows, actor !== null, counts);
        const createdIds = new Map<string, string>(); // lc(name) → new product id
        for (const r of menuRows) {
          await this.savepoint(m, r.report, async (sm) => {
            const categoryId = r.category ? categoryIds.get(lc(r.category)) : undefined;
            const imageUrl = r.image ? photoUrls.get(lc(r.image)) ?? `pending:${r.image}` : undefined;
            if (!r.productId) {
              const created = await this.products.adminCreateProduct(
                {
                  vendorBranchId: branchId,
                  categoryId: categoryId!,
                  name: r.name!,
                  ...(r.nameAr ? { nameAr: r.nameAr } : {}),
                  ...(r.description ? { description: r.description } : {}),
                  ...(r.descriptionAr ? { descriptionAr: r.descriptionAr } : {}),
                  ...(imageUrl && actor ? { imageUrl } : {}),
                  priceMinor: r.priceMinor!,
                  pricingUnit: r.unit ?? PricingUnit.PIECE,
                  inventoryMode: r.stock ?? InventoryMode.OPEN,
                  ...(r.quantity !== null ? { quantity: r.quantity } : {}),
                  isAvailable: r.available ?? true,
                },
                { manager: sm },
              );
              createdIds.set(lc(r.name!), created.id);
              r.report.action = 'CREATE';
              counts.newProducts += 1;
              if (r.image) counts.photos += 1;
              return;
            }
            const current = await sm.findOne(Product, { where: { id: r.productId } });
            const patch: Record<string, unknown> = {};
            const setIf = (key: keyof Product, value: unknown) => { if (value !== null && value !== undefined && value !== (current as any)[key]) patch[key] = value; };
            setIf('categoryId', categoryId);
            setIf('name', r.name);
            setIf('nameAr', r.nameAr);
            setIf('description', r.description);
            setIf('descriptionAr', r.descriptionAr);
            setIf('priceMinor', r.priceMinor);
            if (r.image && actor) patch.imageUrl = imageUrl;
            if (r.stock !== null && r.stock !== current!.inventoryMode) patch.inventoryMode = r.stock;
            if (r.quantity !== null && r.quantity !== current!.quantity) patch.quantity = r.quantity;
            const availabilityChanges = r.available !== null && r.available !== current!.isAvailable;
            if (Object.keys(patch).length === 0 && !availabilityChanges) {
              r.report.action = 'UNCHANGED';
              counts.unchangedProducts += 1;
              return;
            }
            if (Object.keys(patch).length > 0) {
              await this.products.adminUpdateProduct(r.productId, patch as any, sm, actor ? { userId: actor.userId, role: actor.role as any, reason: 'IMPORT' } : undefined);
            }
            if (availabilityChanges) {
              if (r.available) await this.products.adminActivateProduct(r.productId, sm);
              else await this.products.adminDeactivateProduct(r.productId, sm);
            }
            r.report.action = 'UPDATE';
            counts.updatedProducts += 1;
            if (r.image) counts.photos += 1;
          });
        }
        for (const g of groups) {
          await this.savepoint(m, g.report, async (sm) => {
            const productId = byId.get(g.productRef)?.id ?? createdIds.get(lc(g.productRef)) ?? byName.get(lc(g.productRef))?.id ?? menuByName.get(lc(g.productRef))?.productId;
            if (!productId) throw new NotFoundException(`Product "${g.productRef}" was not created (see its Menu row).`);
            await this.options.createOption(
              productId,
              {
                name: g.name,
                ...(g.nameAr ? { nameAr: g.nameAr } : {}),
                isRequired: g.isRequired,
                allowsMultiple: g.allowsMultiple,
                ...(g.minSelections !== undefined ? { minSelections: g.minSelections } : {}),
                ...(g.maxSelections !== undefined ? { maxSelections: g.maxSelections } : {}),
                values: g.values.map((v) => ({ name: v.name, ...(v.nameAr ? { nameAr: v.nameAr } : {}), priceDeltaMinor: v.priceDeltaMinor })),
              },
              async () => undefined,
              sm,
            );
            g.report.action = 'OPTIONS';
            counts.optionGroups += 1;
          });
        }
        if (!actor || failed()) throw ROLLBACK;
      });
    } catch (err) {
      if (err !== ROLLBACK) throw err;
    }
    if (failed()) return { status: 'FAILED', counts, rows: allReports() };
    return { status: actor ? 'APPLIED' : 'READY', counts, rows: allReports() };
  }

  /** Runs one row in a savepoint: its error is recorded on the row and the rest of the import continues (the whole thing is rolled back later). */
  private async savepoint(m: EntityManager, report: MenuImportRowReport, fn: (m: EntityManager) => Promise<void>): Promise<void> {
    try {
      await m.transaction(fn);
    } catch (err: any) {
      const msg = err?.response?.message ?? err?.message ?? 'Unexpected error.';
      report.errors.push(Array.isArray(msg) ? msg.join(', ') : String(msg));
    }
  }

  private async ensureCategories(m: EntityManager, branchId: string, rows: MenuRow[], _applying: boolean, counts: MenuImportSummary['counts']): Promise<Map<string, string>> {
    const existing: Array<{ id: string; name: string; sort_order: number }> = await m.query(
      `SELECT id, name, sort_order FROM product_categories WHERE vendor_branch_id = $1 AND deleted_at IS NULL`,
      [branchId],
    );
    const map = new Map(existing.map((c) => [lc(c.name), c.id]));
    let order = existing.reduce((mx, c) => Math.max(mx, c.sort_order ?? 0), 0);
    for (const r of rows) {
      if (!r.category || map.has(lc(r.category))) continue;
      const created = await this.products.adminCreateCategory({ vendorBranchId: branchId, name: r.category, ...(r.categoryAr ? { nameAr: r.categoryAr } : {}), sortOrder: ++order }, m);
      map.set(lc(r.category), created.id);
      counts.newCategories += 1;
    }
    return map;
  }

  // ================================================================== parsing

  private unpack(upload: Buffer): { workbook: XLSX.WorkBook; photos: Map<string, { name: string; content: Uint8Array }> | null } {
    if (upload.length > MENU_IMPORT_MAX_UPLOAD_BYTES) throw this.bad('FILE_TOO_LARGE', 'The upload is larger than 60 MB.');
    if (upload.length < 4 || upload[0] !== 0x50 || upload[1] !== 0x4b) throw this.bad('INVALID_FILE', 'Upload an Excel .xlsx file, or a .zip with the .xlsx and the photos.');
    let container: any;
    try {
      container = XLSX.CFB.read(upload, { type: 'buffer' });
    } catch {
      throw this.bad('INVALID_FILE', 'The file could not be opened. Upload an Excel .xlsx file, or a .zip with the .xlsx and the photos.');
    }
    const entries: Array<{ path: string; name: string; content: Uint8Array }> = [];
    container.FileIndex.forEach((f: any, i: number) => {
      if (f.type === 2 && f.content && f.content.length > 0) entries.push({ path: container.FullPaths[i], name: f.name, content: f.content });
    });
    const isWorkbook = entries.some((e) => e.path.endsWith('[Content_Types].xml'));
    if (isWorkbook) return { workbook: this.readWorkbook(upload), photos: null };
    const books = entries.filter((e) => /\.xlsx$/i.test(e.name) && !e.name.startsWith('~$') && !e.path.includes('__MACOSX'));
    if (books.length !== 1) throw this.bad('ZIP_NEEDS_ONE_XLSX', `The .zip must contain exactly one .xlsx file (found ${books.length}).`);
    const photos = new Map<string, { name: string; content: Uint8Array }>();
    for (const e of entries) {
      if (e.path.includes('__MACOSX') || e.name.startsWith('.')) continue;
      if (/\.(jpe?g|png|webp)$/i.test(e.name)) photos.set(lc(e.name), { name: e.name, content: e.content });
    }
    return { workbook: this.readWorkbook(Buffer.from(books[0].content)), photos };
  }

  private readWorkbook(buffer: Buffer): XLSX.WorkBook {
    try {
      return XLSX.read(buffer, { type: 'buffer' });
    } catch {
      throw this.bad('INVALID_WORKBOOK', 'The Excel file could not be read.');
    }
  }

  /** Rows of a sheet keyed by column key. Row 1 = headers ("key | Arabic"); an optional row 2 of English hints is skipped. */
  private sheetRows(wb: XLSX.WorkBook, sheetName: string, cols: Col[], required: boolean): Array<{ rowNumber: number; v: Record<string, any> }> {
    const name = wb.SheetNames.find((n) => lc(n) === lc(sheetName));
    if (!name) {
      if (required) throw this.bad('MISSING_SHEET', `The "${sheetName}" sheet is missing. Download a fresh template.`);
      return [];
    }
    const raw = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[name], { header: 1, defval: null, raw: true });
    if (raw.length === 0) return [];
    const header = (raw[0] as any[]).map((h) => (h === null || h === undefined ? '' : lc(String(h).split('|')[0])));
    const index = new Map<string, number>();
    for (const c of cols) {
      const at = header.indexOf(lc(c.key));
      if (at >= 0) index.set(c.key, at);
    }
    const missing = cols.filter((c) => !index.has(c.key)).map((c) => c.key);
    const essential = sheetName === 'Menu' ? ['productId', 'category', 'name', 'price'] : ['product', 'group', 'choice'];
    const missingEssential = missing.filter((k) => essential.includes(k));
    if (missingEssential.length > 0) throw this.bad('INVALID_HEADER', `The "${sheetName}" sheet is missing the column(s): ${missingEssential.join(', ')}. Download a fresh template.`);
    const hintRow = raw.length > 1 && cols.some((c) => index.has(c.key) && raw[1]?.[index.get(c.key)!] === c.en);
    const out: Array<{ rowNumber: number; v: Record<string, any> }> = [];
    for (let i = hintRow ? 2 : 1; i < raw.length; i++) {
      const row = raw[i] as any[];
      const v: Record<string, any> = {};
      let any = false;
      for (const c of cols) {
        const at = index.get(c.key);
        const cell = at === undefined ? null : row?.[at];
        const value = cell === null || cell === undefined || (typeof cell === 'string' && cell.trim() === '') ? null : cell;
        v[c.key] = value;
        if (value !== null) any = true;
      }
      if (any) out.push({ rowNumber: i + 1, v });
    }
    return out;
  }

  private parseMenu(wb: XLSX.WorkBook): MenuRow[] {
    const rows = this.sheetRows(wb, 'Menu', MENU_COLS, true);
    if (rows.length > MAX_MENU_ROWS) throw this.bad('TOO_MANY_ROWS', `At most ${MAX_MENU_ROWS} products per upload.`);
    return rows.map(({ rowNumber, v }) => {
      const errors: string[] = [];
      const str = (k: string, max: number) => {
        if (v[k] === null) return null;
        const s = String(v[k]).trim();
        if (s.length > max) errors.push(`${k} is longer than ${max} characters.`);
        return s;
      };
      const productId = str('productId', 36);
      if (productId && !/^[0-9a-f-]{36}$/i.test(productId)) errors.push('productId is not valid. Leave it empty for a new product.');
      const name = str('name', 150);
      const category = str('category', 100);
      const r: MenuRow = {
        rowNumber,
        productId,
        category,
        categoryAr: str('categoryAr', 100),
        name,
        nameAr: str('nameAr', 150),
        description: str('description', 2000),
        descriptionAr: str('descriptionAr', 2000),
        priceMinor: this.money(v.price, 'price', errors, false),
        unit: this.choice(v.unit, { PIECE: PricingUnit.PIECE, WEIGHT: PricingUnit.WEIGHT, KG: PricingUnit.WEIGHT, 'قطعة': PricingUnit.PIECE, 'وزن': PricingUnit.WEIGHT, 'كيلو': PricingUnit.WEIGHT }, 'unit', errors),
        stock: this.choice(v.stock, { OPEN: InventoryMode.OPEN, TRACKED: InventoryMode.TRACKED, 'مفتوح': InventoryMode.OPEN, 'محدود': InventoryMode.TRACKED }, 'stock', errors),
        quantity: null,
        available: this.bool(v.available, 'available', errors),
        image: str('image', 200),
        report: { sheet: 'Menu', rowNumber, label: name ?? productId, action: productId ? 'UPDATE' : 'CREATE', errors },
      };
      if (v.quantity !== null) {
        const q = Number(v.quantity);
        if (!Number.isInteger(q) || q < 0) errors.push('quantity must be a whole number, 0 or more (pieces, or grams for WEIGHT).');
        else r.quantity = q;
      }
      if (!productId) {
        if (!name) errors.push('name is required for a new product.');
        if (!category) errors.push('category is required for a new product.');
        if (r.priceMinor === null && v.price === null) errors.push('price is required for a new product.');
      }
      if (r.priceMinor !== null && r.priceMinor < 1) errors.push('price must be more than 0.');
      if (r.stock === InventoryMode.TRACKED && r.quantity === null && !productId) errors.push('stock TRACKED needs a quantity.');
      if (r.image && /[\\/]/.test(r.image)) r.image = r.image.split(/[\\/]/).pop()!;
      return r;
    });
  }

  private parseOptions(wb: XLSX.WorkBook): OptionGroupPlan[] {
    const rows = this.sheetRows(wb, 'Options', OPTION_COLS, false);
    if (rows.length > MAX_OPTION_ROWS) throw this.bad('TOO_MANY_ROWS', `At most ${MAX_OPTION_ROWS} option rows per upload.`);
    const groups: OptionGroupPlan[] = [];
    const byKey = new Map<string, OptionGroupPlan>();
    for (const { rowNumber, v } of rows) {
      const errors: string[] = [];
      const product = v.product === null ? null : String(v.product).trim();
      const group = v.group === null ? null : String(v.group).trim();
      const choice = v.choice === null ? null : String(v.choice).trim();
      if (!product || !group || !choice) {
        groups.push({ productRef: product ?? '', rowNumber, name: group ?? '', nameAr: null, isRequired: false, allowsMultiple: false, values: [], report: { sheet: 'Options', rowNumber, label: group, action: 'SKIP', errors: ['product, group and choice are all required on every Options row.'] } });
        continue;
      }
      const key = `${lc(product)}\u0000${lc(group)}`;
      let g = byKey.get(key);
      if (!g) {
        g = { productRef: product, rowNumber, name: group, nameAr: v.groupAr === null ? null : String(v.groupAr).trim(), isRequired: false, allowsMultiple: false, values: [], report: { sheet: 'Options', rowNumber, label: `${product} › ${group}`, action: 'OPTIONS', errors } };
        byKey.set(key, g);
        groups.push(g);
      }
      const req = this.bool(v.required, 'required', g.report.errors);
      if (req !== null) g.isRequired = req;
      const mul = this.bool(v.multiple, 'multiple', g.report.errors);
      if (mul !== null) g.allowsMultiple = mul;
      if (v.min !== null) { const n = Number(v.min); if (Number.isInteger(n) && n >= 0) g.minSelections = n; else g.report.errors.push(`Row ${rowNumber}: min must be a whole number.`); }
      if (v.max !== null) { const n = Number(v.max); if (Number.isInteger(n) && n >= 1) g.maxSelections = n; else g.report.errors.push(`Row ${rowNumber}: max must be a whole number, 1 or more.`); }
      const delta = v.extraPrice === null ? 0 : this.money(v.extraPrice, `Row ${rowNumber}: extraPrice`, g.report.errors, true) ?? 0;
      if (g.values.some((x) => lc(x.name) === lc(choice))) g.report.errors.push(`Row ${rowNumber}: the choice "${choice}" is repeated in this group.`);
      g.values.push({ name: choice, nameAr: v.choiceAr === null ? null : String(v.choiceAr).trim(), priceDeltaMinor: delta });
      if (g.values.length > MAX_VALUES_PER_OPTION_GROUP) g.report.errors.push(`A group can have at most ${MAX_VALUES_PER_OPTION_GROUP} choices.`);
    }
    return groups;
  }

  private money(cell: any, field: string, errors: string[], signed: boolean): number | null {
    if (cell === null || cell === undefined) return null;
    const n = typeof cell === 'number' ? cell : Number(String(cell).replace(/[^\d.\-]/g, ''));
    if (!Number.isFinite(n) || (!signed && n < 0)) {
      errors.push(`${field} must be a number in EGP, e.g. 12.50.`);
      return null;
    }
    const minor = Math.round(n * 100);
    if (Math.abs(minor - n * 100) > 0.001) errors.push(`${field} has more than 2 decimals.`);
    return minor;
  }

  private bool(cell: any, field: string, errors: string[]): boolean | null {
    if (cell === null || cell === undefined) return null;
    if (typeof cell === 'boolean') return cell;
    const s = lc(String(cell));
    if (['true', '1', 'yes', 'y', 'نعم', 'متاح'].includes(s)) return true;
    if (['false', '0', 'no', 'n', 'لا', 'غير متاح'].includes(s)) return false;
    errors.push(`${field} must be TRUE or FALSE.`);
    return null;
  }

  private choice<T>(cell: any, map: Record<string, T>, field: string, errors: string[]): T | null {
    if (cell === null || cell === undefined) return null;
    const s = String(cell).trim();
    const hit = map[s.toUpperCase()] ?? map[s];
    if (hit === undefined) errors.push(`${field} must be one of: ${Object.keys(map).filter((k) => /^[A-Z]/.test(k)).join(', ')}.`);
    return hit ?? null;
  }

  private async requireBranch(branchId: string): Promise<void> {
    if (!/^[0-9a-f-]{36}$/i.test(branchId ?? '')) throw this.bad('BRANCH_REQUIRED', 'vendorBranchId is required.');
    const [row] = await this.ds.query(`SELECT 1 FROM vendor_branches WHERE id = $1 AND deleted_at IS NULL`, [branchId]);
    if (!row) throw new NotFoundException('Branch not found.');
  }

  private bad(code: string, message: string): BadRequestException {
    return new BadRequestException({ message, details: { code } });
  }
}

const INSTRUCTIONS = [
  'HATLY — MENU TEMPLATE / قالب المنيو',
  '',
  'HOW TO USE (English)',
  '1) Sheet "Menu": one row per product. Leave productId EMPTY to add a new product. Rows that already have a productId update that product.',
  '2) category: the menu section (e.g. Burgers). A new category name is created automatically. categoryAr is its Arabic name.',
  '3) price: in EGP, e.g. 95 or 12.50. For unit WEIGHT the price is per kilogram.',
  '4) unit: PIECE (sold by piece) or WEIGHT (sold by kg). Empty = PIECE. It cannot be changed later for an existing product.',
  '5) stock: OPEN (always available, not counted) or TRACKED (counted). TRACKED needs quantity (pieces, or grams for WEIGHT). Empty = OPEN.',
  '6) available: TRUE or FALSE. Empty = TRUE for new products, unchanged for existing ones.',
  '7) Photos: put this .xlsx and the photos (JPG / PNG / WebP, up to 5 MB each) in ONE .zip, write each photo file name in the "image" column, and upload the .zip.',
  '8) Sheet "Options" (optional): sizes, add-ons… One row per choice. Repeat the product name and group name on each row.',
  '   required TRUE = the customer must choose. multiple TRUE = several choices allowed (min / max). extraPrice = added to the price (can be negative).',
  '   Options are added only to products that have no options yet; existing options are edited on the product page.',
  '9) Upload → "Check file" shows every problem by row. Nothing is saved until you press "Import". If any row has an error, nothing is saved.',
  '10) Do not rename the column headers (row 1). Row 2 is a hint row and is ignored.',
  '',
  'طريقة الاستخدام (عربي)',
  '١) ورقة "Menu": صف لكل منتج. اترك عمود productId فارغًا لإضافة منتج جديد. الصف الذي به productId يعدّل ذلك المنتج.',
  '٢) category: قسم المنيو (مثل برجر). القسم الجديد يُنشأ تلقائيًا. categoryAr هو اسمه بالعربي.',
  '٣) price: بالجنيه مثل 95 أو 12.50. للمنتجات بالوزن السعر لكل كيلو.',
  '٤) unit: PIECE (بالقطعة) أو WEIGHT (بالكيلو). الفارغ = PIECE. لا يمكن تغييرها لاحقًا لمنتج موجود.',
  '٥) stock: OPEN (متاح دائمًا) أو TRACKED (بكمية محسوبة) ويحتاج quantity (قطع، أو جرامات للوزن).',
  '٦) available: TRUE أو FALSE.',
  '٧) الصور: ضع ملف الإكسل والصور (JPG / PNG / WebP حتى 5 ميجا) في ملف ‎.zip واحد، واكتب اسم ملف الصورة في عمود image، ثم ارفع ملف ‎.zip.',
  '٨) ورقة "Options" (اختيارية): الأحجام والإضافات. صف لكل اختيار مع تكرار اسم المنتج والمجموعة في كل صف.',
  '   required = إجباري، multiple = أكثر من اختيار (min / max)، extraPrice = سعر إضافي (يمكن أن يكون سالبًا).',
  '٩) ارفع الملف ثم "فحص الملف" لرؤية الأخطاء لكل صف. لا يُحفظ شيء قبل الضغط على "استيراد"، وإذا وُجد خطأ لا يُحفظ أي شيء.',
  '١٠) لا تغيّر عناوين الأعمدة في الصف الأول. الصف الثاني للإرشاد ويتم تجاهله.',
];
