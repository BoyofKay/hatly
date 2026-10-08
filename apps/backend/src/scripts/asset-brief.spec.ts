import { buildBrief, STYLE_GUIDE } from './asset-brief';

describe('asset-brief', () => {
  it('builds a product brief from real context and flags weight-sold items', () => {
    const brief = buildBrief({ kind: 'product', entityName: 'Tomatoes', entityNameAr: 'طماطم', vendorName: 'Belbeis Supermarket', categoryName: 'Vegetables', sectorName: 'Groceries', pricingUnit: 'WEIGHT' });
    expect(brief).toContain('"Tomatoes" (طماطم)');
    expect(brief).toContain('sold by Belbeis Supermarket');
    expect(brief).toContain('sold by weight');
  });

  it('does not mention weight for piece-priced products', () => {
    expect(buildBrief({ kind: 'product', entityName: 'Mixed Grill', pricingUnit: 'PIECE' })).not.toContain('sold by weight');
  });

  it('marks subcategory images as reserved and vendor logos as circle-cropped', () => {
    expect(buildBrief({ kind: 'subcategory', entityName: 'Fast Food', sectorName: 'Restaurants' })).toContain('Reserved');
    expect(buildBrief({ kind: 'vendor-logo', entityName: 'Flatini Pizza' })).toContain('circle');
  });

  it('points a catalog product at the marketplace asset that shows the same item', () => {
    expect(buildBrief({ kind: 'catalog-product', entityName: 'Sunflower Oil 1L', sameSubjectAs: 'products/belbeis-supermarket/sunflower-oil-1l' })).toContain('products/belbeis-supermarket/sunflower-oil-1l');
  });

  it('style guide forbids baked-in text and real brand logos', () => {
    expect(STYLE_GUIDE.mustNot.join(' ')).toMatch(/no text/);
    expect(STYLE_GUIDE.mustNot.join(' ')).toMatch(/brand logos/);
  });
});
