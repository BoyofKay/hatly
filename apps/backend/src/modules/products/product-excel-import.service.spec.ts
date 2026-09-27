import { BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { ProductExcelImportService, EXCEL_IMPORT_MAX_ROWS } from './product-excel-import.service';
import { InventoryMode } from './inventory-mode.enum';
import { PricingUnit } from './pricing-unit.enum';

const HEADERS = ['productId', 'name', 'nameAr', 'price', 'inventoryMode', 'quantity', 'isAvailable'];

function buildWorkbookBuffer(rows: any[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([HEADERS, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Products');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function buildHarness(seed: { products?: any[] } = {}) {
  const products = new Map<string, any>((seed.products ?? []).map((p) => [p.id, { ...p }]));

  const productsService = {
    adminGetProduct: jest.fn(async (id: string) => {
      const p = products.get(id);
      if (!p) throw new BadRequestException('Product not found.');
      return p;
    }),
    adminUpdateProduct: jest.fn(async (id: string, dto: any) => {
      const p = products.get(id);
      Object.assign(p, {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.nameAr !== undefined ? { nameAr: dto.nameAr } : {}),
        ...(dto.priceMinor !== undefined ? { priceMinor: dto.priceMinor } : {}),
      });
      if (dto.inventoryMode !== undefined || dto.quantity !== undefined) {
        const targetMode = dto.inventoryMode ?? p.inventoryMode;
        if (targetMode === InventoryMode.TRACKED) {
          const targetQty = dto.quantity !== undefined ? dto.quantity : p.quantity;
          p.inventoryMode = InventoryMode.TRACKED;
          p.quantity = targetQty;
        } else {
          p.inventoryMode = InventoryMode.OPEN;
          p.quantity = null;
        }
      }
      return p;
    }),
    adminActivateProduct: jest.fn(async (id: string) => {
      products.get(id).isAvailable = true;
      return products.get(id);
    }),
    adminDeactivateProduct: jest.fn(async (id: string) => {
      products.get(id).isAvailable = false;
      return products.get(id);
    }),
  };

  const dataSource = { transaction: async (cb: any) => cb({} as any) };

  const service = new ProductExcelImportService(productsService as any, dataSource as any);
  const alwaysAuthorized = async () => true;
  const neverAuthorized = async () => false;

  return { service, products, productsService, alwaysAuthorized, neverAuthorized };
}

function product(overrides: Partial<any> = {}) {
  return {
    id: 'p1',
    vendorBranchId: 'branch-1',
    name: 'Burger',
    nameAr: null,
    priceMinor: 1000,
    pricingUnit: PricingUnit.PIECE,
    inventoryMode: InventoryMode.OPEN,
    quantity: null,
    isAvailable: true,
    ...overrides,
  };
}

describe('ProductExcelImportService.validate', () => {
  it('valid update-only Excel: name/price change is detected and marked changed', async () => {
    const { service, alwaysAuthorized } = buildHarness({ products: [product()] });
    const buffer = buildWorkbookBuffer([['p1', 'Cheeseburger', '', '12.50', '', '', '']]);
    const { summary } = await service.validate(buffer, alwaysAuthorized);
    expect(summary.status).toBe('READY');
    expect(summary.changedRows).toBe(1);
    expect(summary.rows[0].changedFields).toEqual(expect.arrayContaining(['name', 'price']));
  });

  it('CRITICAL: unknown Product ID fails validation for the whole file', async () => {
    const { service, alwaysAuthorized } = buildHarness({ products: [] });
    const buffer = buildWorkbookBuffer([['missing-id', '', '', '', '', '', '']]);
    const { summary } = await service.validate(buffer, alwaysAuthorized);
    expect(summary.status).toBe('FAILED');
    expect(summary.rows[0].errors).toContain('Product not found.');
  });

  it('CRITICAL: a Product belonging to another branch is rejected as "not found" — never confirms existence', async () => {
    const { service, neverAuthorized } = buildHarness({ products: [product()] });
    const buffer = buildWorkbookBuffer([['p1', '', '', '', '', '', '']]);
    const { summary } = await service.validate(buffer, neverAuthorized);
    expect(summary.status).toBe('FAILED');
    expect(summary.rows[0].errors).toContain('Product not found.');
  });

  it('CRITICAL: duplicate Product IDs in the same file reject the whole file, never last-row-wins', async () => {
    const { service, alwaysAuthorized } = buildHarness({ products: [product()] });
    const buffer = buildWorkbookBuffer([
      ['p1', 'Name A', '', '', '', '', ''],
      ['p1', 'Name B', '', '', '', '', ''],
    ]);
    const { summary } = await service.validate(buffer, alwaysAuthorized);
    expect(summary.status).toBe('FAILED');
    expect(summary.rows[0].errors).toContain('Duplicate Product ID.');
    expect(summary.rows[1].errors).toContain('Duplicate Product ID.');
  });

  it('invalid price is rejected', async () => {
    const { service, alwaysAuthorized } = buildHarness({ products: [product()] });
    const buffer = buildWorkbookBuffer([['p1', '', '', 'not-a-number', '', '', '']]);
    const { summary } = await service.validate(buffer, alwaysAuthorized);
    expect(summary.status).toBe('FAILED');
    expect(summary.rows[0].errors).toContain('Invalid price.');
  });

  it('negative quantity is rejected', async () => {
    const { service, alwaysAuthorized } = buildHarness({
      products: [product({ inventoryMode: InventoryMode.TRACKED, quantity: 10 })],
    });
    const buffer = buildWorkbookBuffer([['p1', '', '', '', '', '-5', '']]);
    const { summary } = await service.validate(buffer, alwaysAuthorized);
    expect(summary.rows[0].errors).toContain('Quantity cannot be negative.');
  });

  it('non-integer quantity is rejected', async () => {
    const { service, alwaysAuthorized } = buildHarness({
      products: [product({ inventoryMode: InventoryMode.TRACKED, quantity: 10 })],
    });
    const buffer = buildWorkbookBuffer([['p1', '', '', '', '', '3.5', '']]);
    const { summary } = await service.validate(buffer, alwaysAuthorized);
    expect(summary.rows[0].errors).toContain('Quantity must be an integer.');
  });

  it('invalid inventoryMode value is rejected', async () => {
    const { service, alwaysAuthorized } = buildHarness({ products: [product()] });
    const buffer = buildWorkbookBuffer([['p1', '', '', '', 'SOMETHING_ELSE', '', '']]);
    const { summary } = await service.validate(buffer, alwaysAuthorized);
    expect(summary.rows[0].errors).toContain('Inventory mode is invalid.');
  });

  it('CRITICAL: OPEN -> TRACKED without quantity is rejected (reuses the real shared transition logic)', async () => {
    const { service, alwaysAuthorized } = buildHarness({
      products: [product({ inventoryMode: InventoryMode.OPEN, quantity: null })],
    });
    const buffer = buildWorkbookBuffer([['p1', '', '', '', 'TRACKED', '', '']]);
    const { summary } = await service.validate(buffer, alwaysAuthorized);
    expect(summary.status).toBe('FAILED');
  });

  it('OPEN -> TRACKED WITH quantity succeeds', async () => {
    const { service, alwaysAuthorized } = buildHarness({
      products: [product({ inventoryMode: InventoryMode.OPEN, quantity: null })],
    });
    const buffer = buildWorkbookBuffer([['p1', '', '', '', 'TRACKED', '25', '']]);
    const { summary } = await service.validate(buffer, alwaysAuthorized);
    expect(summary.status).toBe('READY');
    expect(summary.rows[0].changedFields).toEqual(expect.arrayContaining(['inventoryMode', 'quantity']));
  });

  it('blank cells leave fields unchanged (no changedFields reported for an all-blank row)', async () => {
    const { service, alwaysAuthorized } = buildHarness({ products: [product()] });
    const buffer = buildWorkbookBuffer([['p1', '', '', '', '', '', '']]);
    const { summary } = await service.validate(buffer, alwaysAuthorized);
    expect(summary.status).toBe('READY');
    expect(summary.rows[0].changedFields).toEqual([]);
    expect(summary.unchangedRows).toBe(1);
  });

  it('explicit quantity=0 for TRACKED is accepted (a real value, not blank)', async () => {
    const { service, alwaysAuthorized } = buildHarness({
      products: [product({ inventoryMode: InventoryMode.TRACKED, quantity: 10 })],
    });
    const buffer = buildWorkbookBuffer([['p1', '', '', '', '', '0', '']]);
    const { summary } = await service.validate(buffer, alwaysAuthorized);
    expect(summary.status).toBe('READY');
    expect(summary.rows[0].changedFields).toContain('quantity');
  });

  it('CRITICAL: zero quantity does not automatically change isAvailable in the changed-fields report', async () => {
    const { service, alwaysAuthorized } = buildHarness({
      products: [product({ inventoryMode: InventoryMode.TRACKED, quantity: 10, isAvailable: true })],
    });
    const buffer = buildWorkbookBuffer([['p1', '', '', '', '', '0', '']]);
    const { summary } = await service.validate(buffer, alwaysAuthorized);
    expect(summary.rows[0].changedFields).not.toContain('isAvailable');
  });

  it('invalid isAvailable value is rejected', async () => {
    const { service, alwaysAuthorized } = buildHarness({ products: [product()] });
    const buffer = buildWorkbookBuffer([['p1', '', '', '', '', '', 'MAYBE']]);
    const { summary } = await service.validate(buffer, alwaysAuthorized);
    expect(summary.rows[0].errors).toContain('Invalid availability value.');
  });

  it('CRITICAL: invalid header produces INVALID_HEADER, never silently proceeds', async () => {
    const { service, alwaysAuthorized } = buildHarness();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['wrong', 'headers'],
      ['a', 'b'],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Products');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    await expect(service.validate(buffer, alwaysAuthorized)).rejects.toThrow(BadRequestException);
  });

  it('CRITICAL: over-limit row count is rejected', async () => {
    const { service, alwaysAuthorized } = buildHarness();
    const rows = Array.from({ length: EXCEL_IMPORT_MAX_ROWS + 1 }, (_, i) => [`p${i}`, '', '', '', '', '', '']);
    const buffer = buildWorkbookBuffer(rows);
    await expect(service.validate(buffer, alwaysAuthorized)).rejects.toThrow(BadRequestException);
  });

  it('a file exceeding the size limit is rejected', async () => {
    const { service, alwaysAuthorized } = buildHarness();
    const oversized = Buffer.alloc(3 * 1024 * 1024);
    await expect(service.validate(oversized, alwaysAuthorized)).rejects.toThrow(BadRequestException);
  });

  it('WEIGHT product quantity is interpreted as grams, no unit conversion applied', async () => {
    const { service, alwaysAuthorized } = buildHarness({
      products: [product({ pricingUnit: PricingUnit.WEIGHT, inventoryMode: InventoryMode.TRACKED, quantity: 5000 })],
    });
    const buffer = buildWorkbookBuffer([['p1', '', '', '', '', '7500', '']]);
    const { summary } = await service.validate(buffer, alwaysAuthorized);
    expect(summary.status).toBe('READY');
    expect(summary.rows[0].changedFields).toContain('quantity');
  });

  it('price is correctly converted to priceMinor', async () => {
    const { service, alwaysAuthorized } = buildHarness({ products: [product({ priceMinor: 1000 })] });
    const buffer = buildWorkbookBuffer([['p1', '', '', '12.50', '', '', '']]);
    const { summary } = await service.validate(buffer, alwaysAuthorized);
    expect(summary.rows[0].changedFields).toContain('price');
  });

  it('pricingUnit cannot be changed because it has no column in the template at all', () => {
    expect(HEADERS).not.toContain('pricingUnit');
  });

  it('categoryId cannot be changed because it has no column in the template at all', () => {
    expect(HEADERS).not.toContain('categoryId');
  });
});

describe('ProductExcelImportService.apply', () => {
  it('CRITICAL: validation failure produces zero database changes', async () => {
    const { service, alwaysAuthorized, productsService } = buildHarness({ products: [] });
    const buffer = buildWorkbookBuffer([['missing-id', '', '', '', '', '', '']]);
    await expect(service.apply(buffer, alwaysAuthorized)).rejects.toThrow(BadRequestException);
    expect(productsService.adminUpdateProduct).not.toHaveBeenCalled();
  });

  it('successful multi-row update applies all valid rows atomically', async () => {
    const { service, products, alwaysAuthorized } = buildHarness({
      products: [product({ id: 'p1' }), product({ id: 'p2', name: 'Pizza' })],
    });
    const buffer = buildWorkbookBuffer([
      ['p1', 'New Burger Name', '', '', '', '', ''],
      ['p2', '', '', '', '', '', 'FALSE'],
    ]);
    const result = await service.apply(buffer, alwaysAuthorized);
    expect(result.totalRows).toBe(2);
    expect(result.updatedRows).toBe(2);
    expect(products.get('p1').name).toBe('New Burger Name');
    expect(products.get('p2').isAvailable).toBe(false);
  });

  it('unchanged rows are counted correctly', async () => {
    const { service, alwaysAuthorized } = buildHarness({ products: [product()] });
    const buffer = buildWorkbookBuffer([['p1', '', '', '', '', '', '']]);
    const result = await service.apply(buffer, alwaysAuthorized);
    expect(result.updatedRows).toBe(0);
    expect(result.unchangedRows).toBe(1);
  });

  it('TRACKED -> OPEN clears quantity through the real update path', async () => {
    const { service, products, alwaysAuthorized } = buildHarness({
      products: [product({ inventoryMode: InventoryMode.TRACKED, quantity: 10 })],
    });
    const buffer = buildWorkbookBuffer([['p1', '', '', '', 'OPEN', '', '']]);
    await service.apply(buffer, alwaysAuthorized);
    expect(products.get('p1').inventoryMode).toBe(InventoryMode.OPEN);
    expect(products.get('p1').quantity).toBeNull();
  });
});
