import { MediaKind } from './marketplace-media-inventory';

/**
 * Global art direction shared by every asset. Kept here (and emitted into the manifest) so an external generator
 * applies one consistent look. Derived from the app's documented design language (off-white surfaces, brand orange
 * #FF7A1A, calm commerce look) — not from any invented brand.
 */
export const STYLE_GUIDE = {
  look: 'Clean, realistic, appetising commerce imagery for an Egyptian (Belbeis, Sharqia) delivery marketplace. Soft natural studio light, shallow shadow, neutral warm off-white background (#FAFAFA to #F4EFEA), one clear hero subject, true-to-life colours.',
  mustNot: [
    'no text, captions, prices, watermarks or UI chrome baked into the image',
    'no real-world brand logos or trademarked packaging (use generic, unbranded packaging)',
    'no people or hands unless the brief says so',
    'no borders, rounded-corner masks or drop frames (the app applies its own radius/circle crop)',
  ],
  format: 'webp, sRGB, quality ~80; tiles < 150 KB, product images < 300 KB',
  cropSafety: 'The app crops with BoxFit.cover: keep the subject centred and fully inside the central square; leave edge margin.',
};

export interface BriefContext {
  kind: MediaKind;
  entityName: string;
  entityNameAr?: string | null;
  sectorName?: string;
  sectorNames?: string;
  vendorName?: string;
  categoryName?: string;
  pricingUnit?: string;
  /** Real product names that belong to this sector / vendor, used only as context for what the subject area covers. */
  sampleProducts?: string[];
  /** For a catalog product: the marketplace product key that depicts the same item, so one picture can be reused. */
  sameSubjectAs?: string;
}

const withAr = (name: string, ar?: string | null) => (ar ? `"${name}" (${ar})` : `"${name}"`);
const examples = (list?: string[]) => (list && list.length ? ` Typical items sold here include: ${list.join(', ')}.` : '');

export function buildBrief(ctx: BriefContext): string {
  switch (ctx.kind) {
    case 'sector':
      return (
        `Category tile image for the ${withAr(ctx.entityName, ctx.entityNameAr)} marketplace sector, shown as a square tile on the Home "Shop by category" grid. ` +
        `One clear, instantly recognisable hero composition that represents the whole sector (a small, tidy arrangement of 2-3 typical items, not a crowded collage).` +
        examples(ctx.sampleProducts)
      );
    case 'subcategory':
      return (
        `Subcategory image for ${withAr(ctx.entityName, ctx.entityNameAr)} within the ${ctx.sectorName ?? 'parent'} sector. Square, one clear hero subject representing this subcategory. ` +
        `Reserved: the Customer app does not render subcategory images today (chips are text), so this is the lowest-priority asset.`
      );
    case 'vendor-logo':
      return (
        `Original logo mark for the vendor ${withAr(ctx.entityName, ctx.entityNameAr)}, a ${ctx.sectorNames || ctx.sectorName || 'local'} business in Belbeis, Egypt. ` +
        `Simple, flat, memorable emblem centred on a plain background with ~10% padding; it is displayed inside a circle (64 dp in lists, 84 dp on the vendor page), so keep it legible when circle-cropped. ` +
        `Invent a clean emblem only; do not copy any real brand. Latin or Arabic wordmark is optional and must match the vendor name exactly.` +
        examples(ctx.sampleProducts)
      );
    case 'product': {
      const sold = ctx.pricingUnit === 'WEIGHT' ? ' It is sold by weight, so show it loose or as a natural portion, not as a branded pack.' : '';
      return (
        `Product photo of ${withAr(ctx.entityName, ctx.entityNameAr)}` +
        `${ctx.categoryName ? `, menu/shelf category "${ctx.categoryName}"` : ''}` +
        `${ctx.vendorName ? `, sold by ${ctx.vendorName}` : ''}${ctx.sectorName ? ` (${ctx.sectorName})` : ''}. ` +
        `Show the item exactly as a customer would receive it, as the single hero subject, plated/presented naturally for its type.${sold}`
      );
    }
    case 'catalog-product':
      return (
        `Catalog product photo of ${withAr(ctx.entityName, ctx.entityNameAr)}. Single hero subject, generic unbranded packaging.` +
        (ctx.sameSubjectAs ? ` This is the same item as marketplace asset "${ctx.sameSubjectAs}"; reuse that picture's subject and styling.` : '')
      );
  }
}
