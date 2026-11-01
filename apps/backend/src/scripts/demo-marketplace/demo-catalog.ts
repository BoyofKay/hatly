import { DEMO_SECTORS, DEMO_VENDORS } from './demo-catalog.data';
import type { DemoBanner } from './demo-types';
import type { DemoCatalog } from './demo-marketplace';

/**
 * General, TRUTHFUL discovery banners: each one just opens a category. No discount, price, offer, delivery promise or date is claimed —
 * real campaign banners are created by the owner in the Admin Dashboard. The artwork (`docs/assets/pack/banners/discover-<sector>.webp`,
 * 1200×600) is the category illustration on a soft background; it carries no text, so the banner's title below is only its accessible label.
 */
export const DEMO_BANNERS: DemoBanner[] = [
  { key: 'discover-restaurants', title: 'Order from local restaurants', titleAr: 'اطلب من مطاعم منطقتك', sector: 'restaurants', sortOrder: 0, imageKey: 'banners/discover-restaurants' },
  { key: 'discover-groceries', title: 'Supermarkets and groceries', titleAr: 'سوبر ماركت وبقالة', sector: 'groceries', sortOrder: 1, imageKey: 'banners/discover-groceries' },
  { key: 'discover-produce', title: 'Fruit and vegetables', titleAr: 'خضار وفاكهة', sector: 'produce', sortOrder: 2, imageKey: 'banners/discover-produce' },
  { key: 'discover-pharmacy', title: 'Pharmacies and personal care', titleAr: 'صيدليات وعناية شخصية', sector: 'pharmacy', sortOrder: 3, imageKey: 'banners/discover-pharmacy' },
  { key: 'discover-bakery', title: 'Sweets and bakeries', titleAr: 'حلويات ومخبوزات', sector: 'bakery', sortOrder: 4, imageKey: 'banners/discover-bakery' },
];

export const DEMO_CATALOG: DemoCatalog = { sectors: DEMO_SECTORS, vendors: DEMO_VENDORS, banners: DEMO_BANNERS };
