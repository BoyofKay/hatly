/**
 * CONFIRMED business decision (Chunk 12A — Inventory Foundation).
 * Explicit source of truth for whether a Product tracks finite stock —
 * deliberately NOT inferred from `quantity` being null/non-null (a
 * null quantity is ambiguous on its own; the mode makes the intent
 * explicit). See Product.quantity's own comment for the full
 * OPEN/TRACKED nullability contract.
 */
export enum InventoryMode {
  OPEN = 'OPEN',
  TRACKED = 'TRACKED',
}
