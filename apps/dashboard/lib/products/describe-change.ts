import type { ProductChangeRequest } from '../api/vendor-products';

const egp = (minor: number) => (Number(minor) / 100).toFixed(2);
const FIELD: Record<string, [string, string]> = {
  name: ['Name', 'الاسم'], nameAr: ['Arabic name', 'الاسم بالعربية'], description: ['Description', 'الوصف'], descriptionAr: ['Arabic description', 'الوصف بالعربية'],
  categoryId: ['Category', 'القسم'], imageUrl: ['Image', 'الصورة'], priceMinor: ['Price', 'السعر'],
};

/** R7: plain-language lines for what a product request asks (bilingual via `t`). Each line is "field: current → requested". */
export function describeProductChange(r: Pick<ProductChangeRequest, 'kind' | 'payload' | 'current'>, t: (en: string, ar: string) => string): string[] {
  if (r.kind === 'NEW_PRODUCT') {
    return [
      t(`New product: ${r.current.name} · ${egp(r.current.priceMinor)} EGP`, `منتج جديد: ${r.current.name} · ${egp(r.current.priceMinor)} ج.م`),
      r.payload?.isAvailable === false ? t('Stays inactive after approval', 'يبقى غير مفعّل بعد الموافقة') : t('Goes live once approved', 'يُعرض فور الموافقة'),
    ];
  }
  if (r.kind === 'OPTIONS') {
    const op = String(r.payload?.op ?? '');
    const b = r.payload?.body ?? {};
    const values = Array.isArray(b.values) ? b.values.map((v: any) => `${v.name}${v.priceDeltaMinor ? ` (${egp(v.priceDeltaMinor)})` : ''}`).join(', ') : '';
    const what: Record<string, [string, string]> = {
      CREATE_OPTION: [`Add option "${b.name}"${values ? `: ${values}` : ''}`, `إضافة خيار "${b.name}"${values ? `: ${values}` : ''}`],
      UPDATE_OPTION: [`Change option settings${b.name ? ` → "${b.name}"` : ''}`, `تعديل إعدادات الخيار${b.name ? ` ← "${b.name}"` : ''}`],
      ADD_VALUE: [`Add choice "${b.name}"${b.priceDeltaMinor ? ` (${egp(b.priceDeltaMinor)} EGP)` : ''}`, `إضافة اختيار "${b.name}"${b.priceDeltaMinor ? ` (${egp(b.priceDeltaMinor)} ج.م)` : ''}`],
      UPDATE_VALUE: [
        `Change a choice${b.name ? ` → "${b.name}"` : ''}${b.priceDeltaMinor !== undefined ? ` · price modifier ${egp(b.priceDeltaMinor)} EGP` : ''}`,
        `تعديل اختيار${b.name ? ` ← "${b.name}"` : ''}${b.priceDeltaMinor !== undefined ? ` · فرق السعر ${egp(b.priceDeltaMinor)} ج.م` : ''}`,
      ],
    };
    const pair = what[op] ?? ['Option change', 'تعديل خيار'];
    return [t(pair[0], pair[1])];
  }
  const fmt = (k: string, x: any): string => {
    if (k === 'priceMinor') return `${egp(x)} EGP`;
    if (k === 'categoryId') return (x === r.current.categoryId ? r.current.categoryName : r.payload?.categoryName) ?? '—';
    if (k === 'imageUrl') return x ? t('photo', 'صورة') : '—';
    return x ? String(x) : '—';
  };
  return Object.entries(r.payload ?? {})
    .filter(([k]) => k in FIELD)
    .map(([k, v]) => {
      const [en, ar] = FIELD[k];
      const cur = (r.current as Record<string, any>)[k];
      return t(`${en}: ${fmt(k, cur)} → ${fmt(k, v)}`, `${ar}: ${fmt(k, cur)} ← ${fmt(k, v)}`);
    });
}
