import '../../products/domain/product.dart';
import '../../sectors/domain/sector.dart';
import '../../vendors/domain/vendor.dart';
import '../domain/home_content.dart';

/// ============================================================
/// DEMO / MOCK CONTENT — NOT BACKEND DATA. UI LAYER ONLY.
/// ============================================================
/// Used only when `kHomeDemoContentEnabled` is true and the real data source
/// returned nothing for a section (see `home_providers.dart`). Delete this
/// file's usages, not the widgets, when real promo/offer/cover-image data
/// exists. No images are referenced on purpose: cards render the soft image
/// placeholder until real assets exist.

const String _demoPrefix = 'demo-';

List<MarketplaceSector> demoCategories() {
  const items = <(String, String, String)>[
    ('restaurants', 'Restaurants', 'مطاعم'),
    ('groceries', 'Groceries', 'بقالة'),
    ('pharmacy', 'Pharmacy', 'صيدليات'),
    ('bakery', 'Bakery', 'مخبوزات'),
    ('drinks', 'Drinks', 'مشروبات'),
    ('desserts', 'Desserts', 'حلويات'),
    ('fast_food', 'Fast food', 'وجبات سريعة'),
    ('coffee', 'Coffee', 'قهوة'),
    ('fruit', 'Fruit & veg', 'خضار وفاكهة'),
    ('butcher', 'Butcher', 'جزارة'),
    ('flowers', 'Flowers', 'ورود'),
    ('stationery', 'Stationery', 'مكتبة'),
  ];
  return [
    for (var i = 0; i < items.length; i++)
      MarketplaceSector(
        id: '$_demoPrefix${items[i].$1}',
        name: items[i].$2,
        nameAr: items[i].$3,
        slug: items[i].$1,
        sortOrder: i,
      ),
  ];
}

List<Vendor> demoVendors() => const [
      Vendor(
        id: '${_demoPrefix}vendor-1',
        name: 'Al Salam Grill',
        nameAr: 'مشويات السلام',
        category: 'restaurants',
        ratingAverage: 4.6,
        ratingCount: 312,
        etaMinMinutes: 25,
        etaMaxMinutes: 35,
        deliveryFeeMinor: 1500,
        isOpen: true,
        hasPromotion: true,
      ),
      Vendor(
        id: '${_demoPrefix}vendor-2',
        name: 'Cairo Bakery House',
        nameAr: 'بيت القاهرة للمخبوزات',
        category: 'bakery',
        ratingAverage: 4.8,
        ratingCount: 154,
        etaMinMinutes: 15,
        etaMaxMinutes: 25,
        deliveryFeeMinor: 1000,
        isOpen: true,
      ),
      Vendor(
        id: '${_demoPrefix}vendor-3',
        name: 'Nile Pharmacy',
        nameAr: 'صيدلية النيل',
        category: 'pharmacy',
        ratingAverage: 4.9,
        ratingCount: 421,
        etaMinMinutes: 20,
        etaMaxMinutes: 30,
        deliveryFeeMinor: 1200,
        isOpen: true,
      ),
      Vendor(
        id: '${_demoPrefix}vendor-4',
        name: 'Sweet Corner Desserts',
        nameAr: 'ركن الحلويات',
        category: 'desserts',
        ratingAverage: 4.5,
        ratingCount: 203,
        etaMinMinutes: 30,
        etaMaxMinutes: 45,
        deliveryFeeMinor: 1500,
        isOpen: false,
        hasPromotion: true,
      ),
    ];

List<HomeProductEntry> demoProductEntries() => const [
      HomeProductEntry(
        isDemo: true,
        tag: HomeProductTag.popular,
        product: Product(
          id: '${_demoPrefix}product-1',
          vendorBranchId: '${_demoPrefix}vendor-1',
          categoryId: '${_demoPrefix}c1',
          name: 'Mixed grill plate',
          nameAr: 'طبق مشويات مشكل',
          priceMinor: 18500,
          isAvailable: true,
        ),
      ),
      HomeProductEntry(
        isDemo: true,
        tag: HomeProductTag.newItem,
        product: Product(
          id: '${_demoPrefix}product-2',
          vendorBranchId: '${_demoPrefix}vendor-2',
          categoryId: '${_demoPrefix}c2',
          name: 'Cheese croissant',
          nameAr: 'كرواسون بالجبنة',
          priceMinor: 3500,
          isAvailable: true,
        ),
      ),
      HomeProductEntry(
        isDemo: true,
        tag: HomeProductTag.popular,
        product: Product(
          id: '${_demoPrefix}product-3',
          vendorBranchId: '${_demoPrefix}vendor-4',
          categoryId: '${_demoPrefix}c3',
          name: 'Chocolate lava cake',
          nameAr: 'كيك الشوكولاتة الساخن',
          priceMinor: 6000,
          isAvailable: false,
        ),
      ),
      HomeProductEntry(
        isDemo: true,
        tag: HomeProductTag.newItem,
        product: Product(
          id: '${_demoPrefix}product-4',
          vendorBranchId: '${_demoPrefix}vendor-3',
          categoryId: '${_demoPrefix}c4',
          name: 'Vitamin C 1000mg',
          nameAr: 'فيتامين سي ١٠٠٠',
          priceMinor: 9500,
          isAvailable: true,
        ),
      ),
    ];

List<HomeOffer> demoOffers() => const [
      HomeOffer(
        id: '${_demoPrefix}offer-flash',
        kind: HomeOfferKind.flash,
        title: 'Mixed grill plate',
        subtitle: 'مشويات السلام',
        priceMinor: 15000,
        originalPriceMinor: 18500,
        targetId: '${_demoPrefix}product-1',
        isDemo: true,
      ),
      HomeOffer(
        id: '${_demoPrefix}offer-vendor',
        kind: HomeOfferKind.vendor,
        title: 'خصم على كل المنتجات',
        subtitle: 'ركن الحلويات',
        targetId: '${_demoPrefix}vendor-4',
        isDemo: true,
      ),
      HomeOffer(
        id: '${_demoPrefix}offer-free',
        kind: HomeOfferKind.freeDelivery,
        title: 'توصيل مجاني',
        subtitle: 'للطلبات فوق ٢٠٠ ج.م',
        targetId: '${_demoPrefix}vendor-2',
        isDemo: true,
      ),
      HomeOffer(
        id: '${_demoPrefix}offer-bundle',
        kind: HomeOfferKind.bundle,
        title: 'باكدج العيلة',
        subtitle: 'وجبة لـ 4 أفراد',
        priceMinor: 32000,
        targetId: '${_demoPrefix}vendor-1',
        isDemo: true,
      ),
      HomeOffer(
        id: '${_demoPrefix}offer-product',
        kind: HomeOfferKind.product,
        title: 'Cheese croissant',
        subtitle: 'بيت القاهرة للمخبوزات',
        priceMinor: 3000,
        originalPriceMinor: 3500,
        targetId: '${_demoPrefix}product-2',
        isDemo: true,
      ),
    ];

List<HomePromo> demoPromos() => const [
      HomePromo(
        id: '${_demoPrefix}promo-product',
        kind: HomePromoKind.product,
        title: 'طبق المشويات المشكل',
        subtitle: 'جديد من مشويات السلام',
        targetId: '${_demoPrefix}product-1',
        isDemo: true,
      ),
      HomePromo(
        id: '${_demoPrefix}promo-vendor',
        kind: HomePromoKind.vendor,
        title: 'ركن الحلويات',
        subtitle: 'حلويات طازجة كل يوم',
        targetId: '${_demoPrefix}vendor-4',
        isDemo: true,
      ),
      HomePromo(
        id: '${_demoPrefix}promo-offer',
        kind: HomePromoKind.offer,
        title: 'عروض نهاية الأسبوع',
        subtitle: 'خصومات لفترة محدودة',
        isDemo: true,
      ),
      HomePromo(
        id: '${_demoPrefix}promo-free',
        kind: HomePromoKind.freeDelivery,
        title: 'توصيل مجاني',
        subtitle: 'على طلبك الأول',
        isDemo: true,
      ),
      HomePromo(
        id: '${_demoPrefix}promo-bundle',
        kind: HomePromoKind.bundle,
        title: 'باكدج العيلة',
        subtitle: 'وفّر أكتر مع الباكدج',
        targetId: '${_demoPrefix}vendor-1',
        isDemo: true,
      ),
    ];

bool isDemoId(String? id) => id != null && id.startsWith(_demoPrefix);
