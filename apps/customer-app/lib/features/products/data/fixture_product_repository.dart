import '../domain/product.dart';
import '../domain/product_category.dart';
import '../domain/product_option.dart';
import 'product_repository.dart';

/// ============================================================
/// TEMPORARY PRESENTATION FIXTURE — NOT REAL BACKEND DATA.
/// ============================================================
///
/// There is no Product/ProductCategory/ProductOption schema on the
/// backend at all yet — no entities, no migration, no endpoints. See
/// the Phase 2C assessment for the minimum backend work this would
/// need. This class exists ONLY so the Vendor Details / Product
/// Details screens have something real-shaped to render, and follows
/// the exact same isolation pattern as FixtureVendorRepository from
/// Phase 2B:
///   - kept out of `domain/` entirely
///   - the ONLY implementation of `ProductRepository` right now
///   - swappable for a real `ApiProductRepository` later via one line
///     in `product_providers.dart`
///
/// The same 3 categories x products are returned for every
/// `vendorBranchId` — there's no per-vendor menu variation modeled,
/// since the point is to exercise the UI's real data flow (category
/// filter -> product list -> product details -> options), not to
/// simulate a realistic catalog for every fixture vendor.
class FixtureProductRepository implements ProductRepository {
  static const _categories = [
    ProductCategoryInfo(id: 'starters', name: 'Starters', nameAr: 'مقبلات'),
    ProductCategoryInfo(id: 'mains', name: 'Mains', nameAr: 'أطباق رئيسية'),
    ProductCategoryInfo(id: 'drinks', name: 'Drinks', nameAr: 'مشروبات'),
  ];

  static final List<Product> _products = [
    const Product(
      id: 'fixture-product-1',
      vendorBranchId: '*', // matches any vendorBranchId — see class doc
      categoryId: 'starters',
      name: 'Garlic Bread',
      nameAr: 'خبز بالثوم',
      description: 'Toasted flatbread with garlic butter and herbs.',
      descriptionAr: 'خبز محمص بزبدة الثوم والأعشاب.',
      priceMinor: 4500,
      isAvailable: true,
      options: [
        ProductOption(
          id: 'opt-spice-level',
          name: 'Spice level',
          nameAr: 'مستوى الحرارة',
          isRequired: true,
          allowsMultiple: false,
          values: [
            ProductOptionValue(id: 'mild', name: 'Mild', nameAr: 'خفيف'),
            ProductOptionValue(id: 'spicy', name: 'Spicy', nameAr: 'حار'),
          ],
        ),
      ],
    ),
    const Product(
      id: 'fixture-product-2',
      vendorBranchId: '*',
      categoryId: 'starters',
      name: 'Green Salad',
      nameAr: 'سلطة خضراء',
      description: 'Mixed greens, tomato, cucumber, olive oil dressing.',
      descriptionAr: 'خضروات مشكلة وطماطم وخيار مع صلصة زيت الزيتون.',
      priceMinor: 3800,
      isAvailable: true,
    ),
    const Product(
      id: 'fixture-product-3',
      vendorBranchId: '*',
      categoryId: 'mains',
      name: 'Grilled Chicken Plate',
      nameAr: 'صحن فراخ مشوية',
      description: 'Half chicken, rice, grilled vegetables.',
      descriptionAr: 'نصف فرخة، أرز، خضار مشوي.',
      priceMinor: 12000,
      isAvailable: true,
      options: [
        ProductOption(
          id: 'opt-size',
          name: 'Size',
          nameAr: 'الحجم',
          isRequired: true,
          allowsMultiple: false,
          values: [
            ProductOptionValue(id: 'regular', name: 'Regular', nameAr: 'عادي'),
            ProductOptionValue(
                id: 'large',
                name: 'Large (+15 EGP)',
                nameAr: 'كبير (+15 جنيه)',
                priceDeltaMinor: 1500),
          ],
        ),
        ProductOption(
          id: 'opt-addons',
          name: 'Add-ons',
          nameAr: 'إضافات',
          isRequired: false,
          allowsMultiple: true,
          values: [
            ProductOptionValue(
                id: 'extra-rice',
                name: 'Extra rice',
                nameAr: 'أرز إضافي',
                priceDeltaMinor: 800),
            ProductOptionValue(
                id: 'extra-sauce',
                name: 'Extra sauce',
                nameAr: 'صوص إضافي',
                priceDeltaMinor: 500),
          ],
        ),
      ],
    ),
    const Product(
      id: 'fixture-product-4',
      vendorBranchId: '*',
      categoryId: 'mains',
      name: 'Beef Kofta',
      nameAr: 'كفتة لحم',
      description: 'Seasoned ground beef skewers with rice.',
      descriptionAr: 'أسياخ لحم مفروم متبل مع أرز.',
      priceMinor: 13500,
      isAvailable: false,
    ),
    const Product(
      id: 'fixture-product-5',
      vendorBranchId: '*',
      categoryId: 'drinks',
      name: 'Fresh Lemonade',
      nameAr: 'ليموناضة طازجة',
      priceMinor: 2500,
      isAvailable: true,
    ),
    const Product(
      id: 'fixture-product-6',
      vendorBranchId: '*',
      categoryId: 'drinks',
      name: 'Mint Iced Tea',
      nameAr: 'شاي مثلج بالنعناع',
      priceMinor: 2200,
      isAvailable: true,
    ),
  ];

  @override
  Future<List<ProductCategoryInfo>> getCategories(String vendorBranchId) async {
    await Future.delayed(const Duration(milliseconds: 400));
    return List.unmodifiable(_categories);
  }

  @override
  Future<List<Product>> getProducts(
    String vendorBranchId, {
    String? categoryId,
    String? sort,
    String? search,
    int? page,
    int? limit,
    bool? availableOnly,
    bool? hasOffers,
    int? minPriceMinor,
    int? maxPriceMinor,
  }) async {
    await Future.delayed(const Duration(milliseconds: 600));
    // Discovery params are accepted (to satisfy the interface) but not
    // honored here — this fixture is no longer the active
    // implementation for product listing (see ApiProductRepository);
    // kept only as a lightweight fallback shape.
    if (categoryId == null) return List.unmodifiable(_products);
    return List.unmodifiable(
        _products.where((p) => p.categoryId == categoryId));
  }

  @override
  Future<Product> getProductDetails(String productId) async {
    await Future.delayed(const Duration(milliseconds: 400));
    for (final product in _products) {
      if (product.id == productId) return product;
    }
    throw StateError('No fixture product found for id "$productId".');
  }
}
