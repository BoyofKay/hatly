import { BadRequestException } from '@nestjs/common';
import { Product } from './entities/product.entity';
import { InventoryMode } from './inventory-mode.enum';

/**
 * Excel Inventory & Price Management — extracted from
 * `ProductsService`'s own private `resolveInventoryFieldsForUpdate`
 * (Chunk 12A) into a standalone, pure, exported function. CONFIRMED
 * zero behavior change: `ProductsService`'s own method now simply
 * delegates to this exact same logic, so every existing caller
 * (single-row admin/vendor update) is byte-identical to before. This
 * is what lets the new `ProductExcelImportService` reuse the EXACT
 * same OPEN/TRACKED transition rules per row — including for its
 * "dry run" changed-field detection during Validate — without a
 * second implementation of these rules anywhere.
 */
export function resolveInventoryFieldsForUpdate(
  product: Product,
  inventoryModeInput: InventoryMode | undefined,
  quantityInput: number | undefined,
): { inventoryMode: InventoryMode; quantity: number | null } {
  // Mode not mentioned in this request → stays whatever it currently
  // is; only quantity (if given) applies against that existing mode.
  const targetMode = inventoryModeInput ?? product.inventoryMode;

  if (targetMode === InventoryMode.TRACKED) {
    // Quantity not mentioned in this request → falls back to the
    // product's current quantity (TRACKED→TRACKED, quantity
    // untouched). If that's still null (OPEN→TRACKED with no
    // quantity given), this correctly rejects below.
    const targetQuantity = quantityInput !== undefined ? quantityInput : product.quantity;
    if (targetQuantity === null || targetQuantity === undefined) {
      throw new BadRequestException({
        message: 'A TRACKED product requires a quantity.',
        details: { code: 'TRACKED_QUANTITY_REQUIRED' },
      });
    }
    return { inventoryMode: InventoryMode.TRACKED, quantity: targetQuantity };
  }

  // OPEN (explicit or unchanged) — quantity is never authoritative
  // here; normalize to null even if a quantity was also supplied in
  // the same request, per the confirmed decision.
  return { inventoryMode: InventoryMode.OPEN, quantity: null };
}
