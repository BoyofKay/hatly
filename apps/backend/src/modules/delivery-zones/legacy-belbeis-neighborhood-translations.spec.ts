import { INITIAL_NEIGHBORHOOD_FEE_MINOR, LEGACY_ZONE_TRANSLATIONS } from './legacy-belbeis-neighborhood-translations';

describe('Production Belbeis locality migration safety', () => {
  it('preserves all 11 exact parent names and all 75 original Arabic second-level entries', () => {
    expect(LEGACY_ZONE_TRANSLATIONS).toHaveLength(11);
    expect(LEGACY_ZONE_TRANSLATIONS.map((z) => z.children.length))
      .toEqual([25, 5, 4, 8, 9, 8, 4, 3, 4, 4, 1]);
    expect(LEGACY_ZONE_TRANSLATIONS.reduce((n, z) => n + z.children.length, 0)).toBe(75);
    expect(LEGACY_ZONE_TRANSLATIONS[10]).toMatchObject({
      parentEn: 'Unlisted Zone',
      parentAr: 'نطاق غير موجود',
      children: [{ nameAr: 'منطقة توصيل غير مدرجة', name: 'Unlisted Delivery Area' }],
    });
  });

  it('each child has exactly one nonempty Arabic name and one editable English name', () => {
    for (const zone of LEGACY_ZONE_TRANSLATIONS) {
      expect(zone.parentEn.trim()).not.toBe('');
      expect(zone.parentAr.trim()).not.toBe('');
      expect(new Set(zone.children.map((c) => c.nameAr)).size).toBe(zone.children.length);
      for (const child of zone.children) {
        expect(child.nameAr.trim()).not.toBe('');
        expect(child.name.trim()).not.toBe('');
        expect(child.nameAr).not.toMatch(/[,،;|\r\n]/);
        expect(child.name).not.toMatch(/[,،;|\r\n]/);
      }
    }
  });

  it('uses 15 EGP in integer minor units for each new child fee', () => {
    expect(INITIAL_NEIGHBORHOOD_FEE_MINOR).toBe(1500);
  });
});
