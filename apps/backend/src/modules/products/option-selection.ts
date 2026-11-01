import { BadRequestException } from '@nestjs/common';

/** What an option group looks like to the validator (a ProductOption entity satisfies it). */
export interface OptionGroupLike {
  id: string;
  name: string;
  isRequired: boolean;
  allowsMultiple: boolean;
  minSelections?: number | null;
  maxSelections?: number | null;
  values: Array<{ id: string; priceDeltaMinor?: number | string }>;
}

/**
 * The effective limits of a group. The original flags stay authoritative for rows that never set the explicit columns:
 * `isRequired` means at least one choice, a single-choice group (`!allowsMultiple`) means at most one.
 */
export function effectiveSelectionLimits(group: Pick<OptionGroupLike, 'isRequired' | 'allowsMultiple' | 'minSelections' | 'maxSelections'>): {
  min: number;
  max: number | null;
} {
  const min = Math.max(group.minSelections ?? 0, group.isRequired ? 1 : 0);
  const max = group.allowsMultiple ? (group.maxSelections ?? null) : 1;
  return { min, max };
}

/**
 * Server-side validation of a customer's option choices against the product's CURRENT option groups. Used when an item is added or
 * changed AND again at checkout (a group may have been edited after the item was added — the cart is never trusted to still be valid).
 * Error codes: OPTION_REQUIRED (nothing chosen for a required group), OPTION_MIN_SELECTIONS (some, but fewer than the minimum), OPTION_MAX_SELECTIONS,
 * INVALID_OPTION_SELECTION (two for a single-choice group, or a value that does not belong to the product).
 */
export function validateOptionSelection(groups: OptionGroupLike[], selectedValueIds: string[]): void {
  const selected = new Set(selectedValueIds);

  for (const group of groups) {
    const chosen = group.values.filter((v) => selected.has(v.id)).length;
    const { min, max } = effectiveSelectionLimits(group);

    if (chosen === 0 && min >= 1) {
      throw new BadRequestException({ message: `"${group.name}" requires a selection.`, details: { code: 'OPTION_REQUIRED', optionId: group.id } });
    }
    if (chosen < min) {
      throw new BadRequestException({
        message: `"${group.name}" requires at least ${min} selections.`,
        details: { code: 'OPTION_MIN_SELECTIONS', optionId: group.id, min, chosen },
      });
    }
    if (!group.allowsMultiple && chosen > 1) {
      throw new BadRequestException({ message: `"${group.name}" only allows one selection.`, details: { code: 'INVALID_OPTION_SELECTION', optionId: group.id } });
    }
    if (max !== null && chosen > max) {
      throw new BadRequestException({
        message: `"${group.name}" allows at most ${max} selections.`,
        details: { code: 'OPTION_MAX_SELECTIONS', optionId: group.id, max, chosen },
      });
    }
    for (const v of group.values) selected.delete(v.id);
  }

  if (selected.size > 0) {
    throw new BadRequestException({
      message: 'One or more selected options do not belong to this product.',
      details: { code: 'INVALID_OPTION_SELECTION' },
    });
  }
}

/** A unit price (base + chosen deltas) must never be negative, whatever the options say. */
export function assertNonNegativeUnitPrice(basePriceMinor: number, groups: OptionGroupLike[], selectedValueIds: string[]): void {
  const selected = new Set(selectedValueIds);
  const delta = groups.flatMap((g) => g.values).filter((v) => selected.has(v.id)).reduce((sum, v) => sum + Number(v.priceDeltaMinor ?? 0), 0);
  if (Number(basePriceMinor) + delta < 0) {
    throw new BadRequestException({
      message: 'The selected options do not give a valid price.',
      details: { code: 'INVALID_OPTION_SELECTION' },
    });
  }
}
