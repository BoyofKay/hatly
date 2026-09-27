import 'package:flutter/material.dart';

/// CONFIRMED (Marketplace Sector Taxonomy): kept presentation-only in
/// Flutter — the backend deliberately does NOT store an icon
/// configuration for a Sector (see MarketplaceSector entity's own
/// comment). Keyed by `slug` (the sector's stable identifier), never
/// `name` (which Admin can freely rename without breaking this
/// mapping). An unmapped slug — e.g. a brand-new sector Admin just
/// created — falls back to a generic icon rather than breaking.
IconData sectorIcon(String slug) {
  switch (slug) {
    case 'restaurants':
      return Icons.restaurant_outlined;
    case 'groceries':
    case 'grocery':
      return Icons.local_grocery_store_outlined;
    case 'pharmacy':
      return Icons.local_pharmacy_outlined;
    case 'bakery':
      return Icons.bakery_dining_outlined;
    case 'drinks':
      return Icons.local_bar_outlined;
    case 'desserts':
      return Icons.icecream_outlined;
    case 'fast_food':
    case 'fast-food':
      return Icons.lunch_dining_outlined;
    default:
      return Icons.storefront_outlined;
  }
}
