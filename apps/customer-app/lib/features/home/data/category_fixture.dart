import 'package:flutter/material.dart';
import '../../../core/localization/l10n/app_localizations.dart';

/// ============================================================
/// TEMPORARY PRESENTATION FIXTURE — NOT A BUSINESS DECISION.
/// ============================================================
/// These are the example categories the Phase 2B brief lists
/// ("Restaurants, Groceries, Pharmacy, Bakery, Drinks, Desserts, Fast
/// Food ... these are examples only"). There is no catalog/category
/// API on the backend yet. The string `id` on each entry is also the
/// value used to filter the (also fixture) vendor list by category —
/// see FixtureVendorRepository — so tapping a category chip visibly
/// does something in this phase, without either side pretending to be
/// backed by a real catalog.
class CategoryFixtureItem {
  const CategoryFixtureItem({required this.id, required this.icon});

  final String id;
  final IconData icon;
}

const List<CategoryFixtureItem> categoryFixtures = [
  CategoryFixtureItem(id: 'restaurants', icon: Icons.restaurant_outlined),
  CategoryFixtureItem(
      id: 'groceries', icon: Icons.local_grocery_store_outlined),
  CategoryFixtureItem(id: 'pharmacy', icon: Icons.local_pharmacy_outlined),
  CategoryFixtureItem(id: 'bakery', icon: Icons.bakery_dining_outlined),
  CategoryFixtureItem(id: 'drinks', icon: Icons.local_bar_outlined),
  CategoryFixtureItem(id: 'desserts', icon: Icons.icecream_outlined),
  CategoryFixtureItem(id: 'fast_food', icon: Icons.lunch_dining_outlined),
];

/// Maps a fixture category id to its localized label. A small fixed
/// switch rather than a dynamic lookup — appropriate for a fixture set
/// this small, and it keeps every category's Arabic/English label
/// reviewable in the ARB files like any other UI string.
String categoryLabel(BuildContext context, String categoryId) {
  final l10n = AppLocalizations.of(context);
  switch (categoryId) {
    case 'restaurants':
      return l10n.categoryRestaurants;
    case 'groceries':
      return l10n.categoryGroceries;
    case 'pharmacy':
      return l10n.categoryPharmacy;
    case 'bakery':
      return l10n.categoryBakery;
    case 'drinks':
      return l10n.categoryDrinks;
    case 'desserts':
      return l10n.categoryDesserts;
    case 'fast_food':
      return l10n.categoryFastFood;
    default:
      return categoryId;
  }
}
