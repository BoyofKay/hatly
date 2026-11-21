import { StockActor } from './products.service';
import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { ProductChangeRequestsService, splitVendorProductPatch } from './product-change-requests.service';
import { DataSource } from 'typeorm';
import * as XLSX from 'xlsx';
import { ProductsService } from './products.service';
import { Product } from './entities/product.entity';
import { InventoryMode } from './inventory-mode.enum';
import { resolveInventoryFieldsForUpdate } from './resolve-inventory-fields';

/**
 * Excel Inventory & Price Management. The single shared service both
 * `VendorProductsController` and `AdminProductsController` call —
 * CONFIRMED per the approved design: no VendorExcelImportService +
 * AdminExcelImportService duplication. Every row's actual field
 * update reuses `ProductsService.adminUpdateProduct`/
 * `adminActivateProduct`/`adminDeactivateProduct` verbatim (via the
 * new optional `manager` parameter on those methods) — this class
 * contains ONLY parsing, validation orchestration, and the
 * all-or-nothing transaction wrapper; it never reimplements a single
 * business rule (price conversion, OPEN/TRACKED transitions,
 * isAvailable semantics) that already exists elsewhere.
 */

export const EXCEL_IMPORT_MAX_ROWS = 500;
export const EXCEL_IMPORT_MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;

const EXPECTED_HEADERS = ['productId', 'name', 'nameAr', 'price', 'inventoryMode', 'quantity', 'isAvailable'];

export interface ExcelImportRowResult {
  rowNumber: number;
  productId: string | null;
  productName: string | null;
  changedFields: string[];
  errors: string[];
}

export interface ExcelImportValidationSummary {
  status: 'READY' | 'FAILED';
  totalRows: number;
  changedRows: number;
  unchangedRows: number;
  rows: ExcelImportRowResult[];
}

export interface ExcelImportApplyResult {
  totalRows: number;
  updatedRows: number;
  unchangedRows: number;
  /** R7 (vendor imports only): rows whose price increase / name change was sent to Hatly for approval instead of applied. */
  sentForApproval?: number;
}

interface ParsedRowIntent {
  rowNumber: number;
  productId: string;
  name?: string;
  nameAr?: string;
  priceMinor?: number;
  inventoryMode?: InventoryMode;
  quantity?: number;
  isAvailable?: boolean;
}

/**
 * `authorize` is the ONLY place branch ownership is decided — Vendor
 * callers pass a real ownership check (backed by
 * VendorStaffAuthorizationService); Admin callers pass a function that
 * always resolves `true`, since `MANAGE_CATALOG` already gated the
 * whole endpoint before this service is ever reached. CONFIRMED: no
 * branch/vendor identifier is ever read from the Excel file itself —
 * those columns don't exist in EXPECTED_HEADERS at all.
 */
export type BranchAuthorizer = (vendorBranchId: string) => Promise<boolean>;

@Injectable()
export class ProductExcelImportService {
  constructor(
    private readonly productsService: ProductsService,
    private readonly dataSource: DataSource,
    @Optional() private readonly governance?: ProductChangeRequestsService,
  ) {}

  generateTemplate(products: Product[]): Buffer {
    const rows: any[][] = [EXPECTED_HEADERS];
    for (const p of products) {
      rows.push([
        p.id,
        p.name,
        p.nameAr ?? '',
        (p.priceMinor / 100).toFixed(2),
        p.inventoryMode,
        p.quantity === null || p.quantity === undefined ? '' : p.pricingUnit === 'WEIGHT' ? p.quantity / 1000 : p.quantity,
        p.isAvailable ? 'TRUE' : 'FALSE',
      ]);
    }
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const instructions = XLSX.utils.aoa_to_sheet([
      ['Instructions'],
      ['productId identifies the Product and never changes it.'],
      ['Leave a cell blank to keep its current value unchanged.'],
      ['price is a normal currency value, e.g. 12.50 (not minor units).'],
      ['For WEIGHT products, quantity is in KILOGRAMS (e.g. 12.5, up to 3 decimals). For PIECE products, quantity is a count of pieces.'],
      ['inventoryMode can be OPEN or TRACKED.'],
      ['TRACKED requires a quantity in the same row.'],
      ['isAvailable accepts TRUE/FALSE (or 1/0).'],
      ['quantity = 0 is a real value, not "no change".'],
      ['Category and Pricing Unit cannot be changed through this import.'],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Products');
    XLSX.utils.book_append_sheet(workbook, instructions, 'Instructions');
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  /**
   * Validate-only — CONFIRMED never touches the database. Used both
   * by the standalone Validate endpoint AND as the mandatory first
   * step of Apply (which always re-validates the freshly re-submitted
   * file server-side, never trusting a client preview payload).
   */
  async validate(
    buffer: Buffer,
    authorize: BranchAuthorizer,
  ): Promise<{ summary: ExcelImportValidationSummary; intents: ParsedRowIntent[] }> {
    if (buffer.length > EXCEL_IMPORT_MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException({
        message: 'Maximum file size is 2 MB.',
        details: { code: 'FILE_TOO_LARGE' },
      });
    }

    const sheetRows = this.parseWorkbook(buffer);
    const dataRows = sheetRows.slice(1);
    if (dataRows.length > EXCEL_IMPORT_MAX_ROWS) {
      throw new BadRequestException({
        message: 'Maximum 500 rows allowed.',
        details: { code: 'TOO_MANY_ROWS' },
      });
    }

    const rowResults: ExcelImportRowResult[] = [];
    const intents: ParsedRowIntent[] = [];
    const seenProductIds = new Map<string, number[]>(); // productId -> row numbers seen

    for (let i = 0; i < dataRows.length; i++) {
      const rowNumber = i + 2; // header is row 1, first data row is row 2 — matches how a Vendor sees it in Excel
      const raw = dataRows[i];
      const errors: string[] = [];

      const productIdCell = this.cellString(raw[0]);
      if (!productIdCell) {
        errors.push('Product ID is required.');
        rowResults.push({ rowNumber, productId: null, productName: null, changedFields: [], errors });
        continue;
      }
      if (!seenProductIds.has(productIdCell)) seenProductIds.set(productIdCell, []);
      seenProductIds.get(productIdCell)!.push(rowNumber);

      let product: Product | null = null;
      try {
        product = await this.productsService.adminGetProduct(productIdCell);
      } catch {
        errors.push('Product not found.');
      }

      if (product) {
        const owns = await authorize(product.vendorBranchId);
        if (!owns) {
          // Same "not found" convention this codebase already uses
          // everywhere for cross-branch access — never confirms the
          // product exists to an unauthorized caller.
          errors.push('Product not found.');
          product = null;
        }
      }

      const changedFields: string[] = [];
      let intent: ParsedRowIntent | null = null;

      if (product) {
        intent = { rowNumber, productId: productIdCell };

        const nameCell = this.cellString(raw[1]);
        if (nameCell !== null) {
          intent.name = nameCell;
          if (nameCell !== product.name) changedFields.push('name');
        }

        const nameArCell = this.cellString(raw[2]);
        if (nameArCell !== null) {
          intent.nameAr = nameArCell;
          if (nameArCell !== (product.nameAr ?? '')) changedFields.push('nameAr');
        }

        const priceCell = raw[3];
        if (priceCell !== undefined && priceCell !== null && String(priceCell).trim() !== '') {
          const priceMinor = this.parsePriceToMinor(priceCell, errors);
          if (priceMinor !== null) {
            intent.priceMinor = priceMinor;
            if (priceMinor !== product.priceMinor) changedFields.push('price');
          }
        }

        const inventoryModeCell = this.cellString(raw[4]);
        let parsedInventoryMode: InventoryMode | undefined;
        if (inventoryModeCell !== null) {
          const upper = inventoryModeCell.toUpperCase();
          if (upper !== 'OPEN' && upper !== 'TRACKED') {
            errors.push('Inventory mode is invalid.');
          } else {
            parsedInventoryMode = upper as InventoryMode;
            intent.inventoryMode = parsedInventoryMode;
          }
        }

        const quantityCell = raw[5];
        let parsedQuantity: number | undefined;
        if (quantityCell !== undefined && quantityCell !== null && String(quantityCell).trim() !== '') {
          const typed = Number(String(quantityCell).replace(',', '.'));
          // WEIGHT products: the sheet holds kilograms (12.5), stored as grams; PIECE products: whole pieces.
          const isWeight = product.pricingUnit === 'WEIGHT';
          const asNumber = isWeight ? Math.round(typed * 1000) : typed;
          if (!Number.isFinite(typed)) {
            errors.push(isWeight ? 'Quantity must be a number of kg, e.g. 12.5.' : 'Quantity must be an integer.');
          } else if (typed < 0) {
            errors.push('Quantity cannot be negative.');
          } else if (isWeight ? Math.abs(typed * 1000 - asNumber) > 1e-6 : !Number.isInteger(typed)) {
            errors.push(isWeight ? 'Quantity in kg can have at most 3 decimals.' : 'Quantity must be an integer.');
          } else {
            parsedQuantity = asNumber;
            intent.quantity = asNumber;
          }
        }

        // Dry-run the EXACT same transition logic adminUpdateProduct
        // uses, purely to detect the resulting {mode, quantity} for
        // changed-field reporting and to surface a TRACKED-without-
        // quantity error at validation time (never at apply time only).
        if (parsedInventoryMode !== undefined || parsedQuantity !== undefined) {
          try {
            const resolved = resolveInventoryFieldsForUpdate(product, parsedInventoryMode, parsedQuantity);
            if (resolved.inventoryMode !== product.inventoryMode || resolved.quantity !== product.quantity) {
              if (!changedFields.includes('inventoryMode') && resolved.inventoryMode !== product.inventoryMode) {
                changedFields.push('inventoryMode');
              }
              if (!changedFields.includes('quantity') && resolved.quantity !== product.quantity) {
                changedFields.push('quantity');
              }
            }
          } catch (err: any) {
            const message = err?.response?.message ?? 'Quantity is required when switching to TRACKED.';
            errors.push(message);
          }
        }

        const isAvailableCell = this.cellString(raw[6]);
        if (isAvailableCell !== null) {
          const normalized = isAvailableCell.trim().toUpperCase();
          if (normalized === 'TRUE' || normalized === '1') {
            intent.isAvailable = true;
            if (product.isAvailable !== true) changedFields.push('isAvailable');
          } else if (normalized === 'FALSE' || normalized === '0') {
            intent.isAvailable = false;
            if (product.isAvailable !== false) changedFields.push('isAvailable');
          } else {
            errors.push('Invalid availability value.');
          }
        }
      }

      rowResults.push({
        rowNumber,
        productId: productIdCell,
        productName: product?.name ?? null,
        changedFields,
        errors,
      });
      if (product && errors.length === 0 && intent) {
        intents.push(intent);
      }
    }

    // Duplicate productId detection — CONFIRMED: rejects the whole
    // file, never last-row-wins.
    for (const [productId, rowNumbers] of seenProductIds.entries()) {
      if (rowNumbers.length > 1) {
        for (const rowResult of rowResults) {
          if (rowResult.productId === productId) {
            rowResult.errors.push('Duplicate Product ID.');
          }
        }
      }
    }

    const hasAnyError = rowResults.some((r) => r.errors.length > 0);
    const changedRows = rowResults.filter((r) => r.errors.length === 0 && r.changedFields.length > 0).length;
    const unchangedRows = rowResults.filter((r) => r.errors.length === 0 && r.changedFields.length === 0).length;

    return {
      summary: {
        status: hasAnyError ? 'FAILED' : 'READY',
        totalRows: rowResults.length,
        changedRows,
        unchangedRows,
        rows: rowResults,
      },
      intents: hasAnyError ? [] : intents,
    };
  }

  /**
   * Re-parses and re-validates the SAME re-submitted file from
   * scratch — CONFIRMED, never trusts a client preview payload as
   * authorization or as the set of changes to apply. All-or-nothing:
   * a single `dataSource.transaction` wraps every row's update.
   */
  async apply(buffer: Buffer, authorize: BranchAuthorizer, actor?: StockActor): Promise<ExcelImportApplyResult> {
    const { summary, intents } = await this.validate(buffer, authorize);
    if (summary.status === 'FAILED') {
      throw new BadRequestException({
        message: 'Validation failed. No changes were applied.',
        details: { code: 'IMPORT_VALIDATION_FAILED', rows: summary.rows },
      });
    }

    let updated = 0;
    let sentForApproval = 0;
    // R7: a VENDOR import follows the same rule as the screens, per row — price reductions, inventory and availability apply; a price
    // increase or a name change goes to Hatly; a product that is not approved yet is edited directly but never made available here.
    const governed = actor?.role === 'VENDOR' && this.governance ? this.governance : null;
    await this.dataSource.transaction(async (manager) => {
      for (const intent of intents) {
        const rowResult = summary.rows.find((r) => r.productId === intent.productId);
        if (governed) {
          const product = await this.productsService.adminGetProduct(intent.productId, manager);
          const fields: Record<string, unknown> = { name: intent.name, nameAr: intent.nameAr, priceMinor: intent.priceMinor, inventoryMode: intent.inventoryMode, quantity: intent.quantity };
          const live = product.approvalStatus === 'APPROVED';
          const { direct, gated } = live ? splitVendorProductPatch(product, fields) : { direct: fields, gated: {} as Record<string, unknown> };
          if (Object.values(direct).some((v) => v !== undefined)) {
            await this.productsService.adminUpdateProduct(intent.productId, direct as any, manager, { ...actor!, reason: 'IMPORT' });
          }
          if (Object.keys(gated).length > 0) {
            await governed.submitUpdate(manager, product, gated, { id: actor!.userId, role: actor!.role }, 'EXCEL');
            sentForApproval += 1;
          }
          if (intent.isAvailable !== undefined) {
            if (!live) await governed.setPendingAvailability(manager, intent.productId, intent.isAvailable);
            else if (intent.isAvailable) await this.productsService.adminActivateProduct(intent.productId, manager);
            else await this.productsService.adminDeactivateProduct(intent.productId, manager);
          }
          if (rowResult && rowResult.changedFields.length > 0) updated += 1;
          continue;
        }
        const hasFieldChanges =
          intent.name !== undefined ||
          intent.nameAr !== undefined ||
          intent.priceMinor !== undefined ||
          intent.inventoryMode !== undefined ||
          intent.quantity !== undefined;

        if (hasFieldChanges) {
          await this.productsService.adminUpdateProduct(
            intent.productId,
            {
              name: intent.name,
              nameAr: intent.nameAr,
              priceMinor: intent.priceMinor,
              inventoryMode: intent.inventoryMode,
              quantity: intent.quantity,
            } as any,
            manager,
            actor ? { ...actor, reason: 'IMPORT' } : undefined,
          );
        }
        if (intent.isAvailable !== undefined) {
          if (intent.isAvailable) {
            await this.productsService.adminActivateProduct(intent.productId, manager);
          } else {
            await this.productsService.adminDeactivateProduct(intent.productId, manager);
          }
        }
        if (rowResult && rowResult.changedFields.length > 0) {
          updated += 1;
        }
      }
    });

    return {
      totalRows: summary.totalRows,
      updatedRows: updated,
      unchangedRows: summary.totalRows - updated,
      ...(governed ? { sentForApproval } : {}),
    };
  }

  private parseWorkbook(buffer: Buffer): any[][] {
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: 'buffer' });
    } catch {
      throw new BadRequestException({
        message: 'Invalid or unreadable Excel file.',
        details: { code: 'INVALID_WORKBOOK' },
      });
    }

    const sheetName = workbook.SheetNames.find((n) => n.toLowerCase() !== 'instructions') ?? workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      throw new BadRequestException({
        message: 'Invalid or unreadable Excel file.',
        details: { code: 'INVALID_WORKBOOK' },
      });
    }

    const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null });
    if (rows.length === 0) {
      throw new BadRequestException({
        message: 'Invalid or unreadable Excel file.',
        details: { code: 'INVALID_WORKBOOK' },
      });
    }

    const header = (rows[0] as any[]).map((h) => (h ? String(h).trim() : ''));
    const headerMatches =
      header.length >= EXPECTED_HEADERS.length &&
      EXPECTED_HEADERS.every((expected, index) => header[index]?.toLowerCase() === expected.toLowerCase());
    if (!headerMatches) {
      throw new BadRequestException({ message: 'Invalid Excel header.', details: { code: 'INVALID_HEADER' } });
    }

    return rows;
  }

  private cellString(value: any): string | null {
    if (value === undefined || value === null) return null;
    const str = String(value).trim();
    return str === '' ? null : str;
  }

  private parsePriceToMinor(cell: any, errors: string[]): number | null {
    const asNumber = Number(cell);
    if (Number.isNaN(asNumber) || asNumber < 0) {
      errors.push('Invalid price.');
      return null;
    }
    // Same rounding convention already used by the Vendor Dashboard's
    // own price input — never a second conversion rule.
    return Math.round(asNumber * 100);
  }
}
