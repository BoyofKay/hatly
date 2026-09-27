/// A vendor's own menu/catalog section (e.g. "Starters", "Mains") —
/// mirrors the backend's proposed `ProductCategory` entity (not yet
/// implemented — see the Phase 2C assessment). This is a DIFFERENT
/// concept from `home/data/category_fixture.dart`'s marketplace-wide
/// categories (Restaurants, Groceries, ...): those filter WHICH
/// vendors show up on Home; these filter WHICH products show up
/// within one already-chosen vendor's menu. Keeping them as separate
/// types (not sharing a model) avoids conflating "kind of vendor" with
/// "section of one vendor's menu".
class ProductCategoryInfo {
  const ProductCategoryInfo(
      {required this.id, required this.name, this.nameAr});

  final String id;
  final String name;
  final String? nameAr;
}
