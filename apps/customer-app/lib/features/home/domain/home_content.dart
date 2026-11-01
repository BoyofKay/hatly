import '../../products/domain/product.dart';

/// What a promo banner promotes. Decides the CTA label and its action — the
/// CTA *component* is the same for every kind.
enum HomePromoKind { product, vendor, offer, freeDelivery, bundle }

/// UI-layer view model for one slot in the rotating promo carousel. It is NOT
/// a backend model and carries no business logic: it is derived from existing
/// offer/vendor/product data (see `home_providers.dart`) or, in demo mode only,
/// from `home_demo_content.dart`.
class HomePromo {
  const HomePromo({
    required this.id,
    required this.kind,
    required this.title,
    this.subtitle,
    this.imageUrl,
    this.targetId,
    this.isDemo = false,
  });

  final String id;
  final HomePromoKind kind;
  final String title;
  final String? subtitle;
  final String? imageUrl;

  /// productId for product/offer promos, vendor (branch) id for vendor/
  /// free-delivery/bundle promos. Null → generic destination.
  final String? targetId;
  final bool isDemo;
}

/// Visual kinds the Offers row can render (mixed offers).
enum HomeOfferKind { product, vendor, freeDelivery, bundle, flash }

class HomeOffer {
  const HomeOffer({
    required this.id,
    required this.kind,
    required this.title,
    this.subtitle,
    this.imageUrl,
    this.priceMinor,
    this.originalPriceMinor,
    this.targetId,
    this.isDemo = false,
  });

  final String id;
  final HomeOfferKind kind;
  final String title;
  final String? subtitle;
  final String? imageUrl;

  /// Price shown on the card (e.g. a flash-sale price), if any.
  final int? priceMinor;

  /// Crossed-out original price when [priceMinor] is a discounted price.
  final int? originalPriceMinor;

  /// productId (product/flash) or vendor branch id (vendor/freeDelivery/bundle).
  final String? targetId;
  final bool isDemo;
}

/// Why a product appears in a Home product section.
enum HomeProductTag { popular, newItem, offer }

/// The three Home product sections and their "See all" lists: "Most ordered", "New" and "Offers".
enum HomeSectionKind { mostOrdered, newest, offers }

class HomeProductEntry {
  const HomeProductEntry(
      {required this.product, required this.tag, this.isDemo = false});

  final Product product;
  final HomeProductTag tag;
  final bool isDemo;
}
