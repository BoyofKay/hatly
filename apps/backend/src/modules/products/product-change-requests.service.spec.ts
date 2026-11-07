import { isDirectValueChange, splitVendorProductPatch } from './product-change-requests.service';

const current = { priceMinor: 1000, name: 'Burger', nameAr: null, description: 'Beef', descriptionAr: null, categoryId: 'c1', imageUrl: null } as any;

describe('R7 — splitVendorProductPatch', () => {
  it('a price reduction applies directly; an increase waits for Hatly; an unchanged price is dropped', () => {
    expect(splitVendorProductPatch(current, { priceMinor: 900 })).toEqual({ direct: { priceMinor: 900 }, gated: {} });
    expect(splitVendorProductPatch(current, { priceMinor: 1100 })).toEqual({ direct: {}, gated: { priceMinor: 1100 } });
    expect(splitVendorProductPatch(current, { priceMinor: 1000 })).toEqual({ direct: {}, gated: {} });
  });

  it('changed details wait for Hatly; unchanged ones (incl. blank vs null) are dropped; inventory applies directly', () => {
    const r = splitVendorProductPatch(current, { name: 'Cheeseburger', description: 'Beef', nameAr: '', categoryId: 'c2', inventoryMode: 'TRACKED', quantity: 3 });
    expect(r.gated).toEqual({ name: 'Cheeseburger', categoryId: 'c2' });
    expect(r.direct).toEqual({ inventoryMode: 'TRACKED', quantity: 3 });
  });

  it('undefined fields are ignored', () => {
    expect(splitVendorProductPatch(current, { name: undefined, priceMinor: undefined })).toEqual({ direct: {}, gated: {} });
  });
});

describe('R7 — isDirectValueChange', () => {
  it('only lowering (or keeping) a modifier without renaming applies directly', () => {
    expect(isDirectValueChange(500, { priceDeltaMinor: 300 })).toBe(true);
    expect(isDirectValueChange(500, { priceDeltaMinor: 500 })).toBe(true);
    expect(isDirectValueChange(500, { priceDeltaMinor: 600 })).toBe(false);
    expect(isDirectValueChange(500, { priceDeltaMinor: 300, name: 'Large' })).toBe(false);
    expect(isDirectValueChange(500, { nameAr: 'كبير' })).toBe(false);
    expect(isDirectValueChange(500, {})).toBe(false);
  });
});
