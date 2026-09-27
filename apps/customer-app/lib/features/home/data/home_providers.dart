import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../products/data/product_providers.dart';
import '../../products/domain/product.dart';
import '../../sectors/data/sectors_providers.dart';
import '../../sectors/domain/sector.dart';
import '../../vendors/data/vendor_providers.dart';
import '../../vendors/domain/vendor.dart';
import '../domain/home_content.dart';
import 'home_content_config.dart';
import 'home_demo_content.dart';

/// Whether demo content may fill empty sections. Overridable in tests.
final homeDemoEnabledProvider =
    Provider<bool>((ref) => kHomeDemoContentEnabled);

// ---------------------------------------------------------------------------
// Pure composition helpers (unit-tested; no I/O)
// ---------------------------------------------------------------------------

/// Category ordering is data-driven: pinned slugs (config) first in the given
/// order, then everything else by backend `sortOrder`, capped at [max].
List<MarketplaceSector> orderHomeCategories(
  List<MarketplaceSector> sectors, {
  List<String> pinnedSlugs = kHomeCategoryPinnedSlugs,
  int max = kHomeMaxCategories,
}) {
  final sorted = [...sectors]..sort((a, b) {
      final byOrder = a.sortOrder.compareTo(b.sortOrder);
      return byOrder != 0 ? byOrder : a.name.compareTo(b.name);
    });
  final pinned = <MarketplaceSector>[
    for (final slug in pinnedSlugs) ...sorted.where((s) => s.slug == slug),
  ];
  final rest = sorted.where((s) => !pinned.contains(s));
  return [...pinned, ...rest].take(max).toList();
}

/// "Popular": most-reviewed first, then best rated, then name — stable and
/// explainable, using only fields the vendor listing already returns.
List<Vendor> rankPopularVendors(List<Vendor> vendors,
    {int count = kHomePopularVendorCount}) {
  final seen = <String>{};
  final unique = [
    for (final v in vendors)
      if (seen.add(v.id)) v
  ];
  unique.sort((a, b) {
    final byCount = b.ratingCount.compareTo(a.ratingCount);
    if (byCount != 0) return byCount;
    final byRating = b.ratingAverage.compareTo(a.ratingAverage);
    return byRating != 0 ? byRating : a.name.compareTo(b.name);
  });
  return unique.take(count).toList();
}

/// Offers are derived from data that already exists: a product's active offer
/// (flash sale → flash card, other mechanisms → product card) and a vendor's
/// promotion flag. Nothing is invented; free-delivery/bundle cards have no
/// real source yet, so they only appear in demo mode.
List<HomeOffer> buildOffers({
  required List<Vendor> vendors,
  required List<HomeProductEntry> products,
  int max = kHomeMaxOffers,
}) {
  final offers = <HomeOffer>[];
  final seenProducts = <String>{};
  for (final entry in products) {
    final p = entry.product;
    final offer = p.activeOffer;
    if (offer == null || !seenProducts.add(p.id)) continue;
    final discounted = offer.isFlashSale &&
        offer.specialPriceMinor != null &&
        offer.specialPriceMinor! < p.priceMinor;
    offers.add(
      HomeOffer(
        id: 'offer-${p.id}',
        kind: offer.isFlashSale ? HomeOfferKind.flash : HomeOfferKind.product,
        title: p.nameAr ?? p.name,
        imageUrl: p.imageUrl,
        priceMinor: discounted ? offer.specialPriceMinor : p.priceMinor,
        originalPriceMinor: discounted ? p.priceMinor : null,
        targetId: p.id,
      ),
    );
  }
  for (final v in vendors.where((v) => v.hasPromotion)) {
    offers.add(
      HomeOffer(
        id: 'offer-vendor-${v.id}',
        kind: HomeOfferKind.vendor,
        title: v.nameAr ?? v.name,
        imageUrl: v.coverImageUrl ?? v.logoUrl,
        targetId: v.id,
      ),
    );
  }
  return offers.take(max).toList();
}

/// Promo carousel slots come from the same real offers: a product/flash offer
/// promotes the offer, a vendor promotion promotes the vendor.
List<HomePromo> buildPromos(List<HomeOffer> offers,
    {int max = kHomeMaxPromos}) {
  return [
    for (final o in offers.take(max))
      HomePromo(
        id: 'promo-${o.id}',
        kind: o.kind == HomeOfferKind.vendor
            ? HomePromoKind.vendor
            : HomePromoKind.offer,
        title: o.title,
        subtitle: o.subtitle,
        imageUrl: o.imageUrl,
        targetId: o.targetId,
      ),
  ];
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

class HomeSnapshot {
  const HomeSnapshot({
    required this.popularVendors,
    required this.productEntries,
    required this.offers,
    required this.promos,
  });

  final List<Vendor> popularVendors;
  final List<HomeProductEntry> productEntries;
  final List<HomeOffer> offers;
  final List<HomePromo> promos;
}

/// Shop by Category — the real sectors (already API-backed), ordered by
/// [orderHomeCategories]; demo categories only when the API returned none and
/// demo mode is on. The list is NOT capped here: the Home grid shows the first
/// [kHomeMaxCategories] and offers "عرض الكل" when there are more.
final homeCategoriesProvider =
    FutureProvider.autoDispose<List<MarketplaceSector>>((ref) async {
  final demo = ref.watch(homeDemoEnabledProvider);
  List<MarketplaceSector> ordered(List<MarketplaceSector> all) =>
      orderHomeCategories(all, max: all.length);
  List<MarketplaceSector> sectors;
  try {
    sectors = await ref.watch(sectorsProvider.future);
  } catch (_) {
    if (demo) return ordered(demoCategories());
    rethrow;
  }
  if (sectors.isEmpty && demo) return ordered(demoCategories());
  return ordered(sectors);
});

/// Everything below the categories: popular vendors, popular/new products,
/// offers and promos — assembled from the EXISTING repositories only
/// (per-sector vendor listing, per-branch product listing). One failing call
/// degrades to an empty list for that source instead of blanking Home.
final homeSnapshotProvider =
    FutureProvider.autoDispose<HomeSnapshot>((ref) async {
  final demo = ref.watch(homeDemoEnabledProvider);
  final vendorRepo = ref.watch(vendorRepositoryProvider);
  final productRepo = ref.watch(productRepositoryProvider);

  List<MarketplaceSector> sectors = const [];
  try {
    sectors = orderHomeCategories(await ref.watch(sectorsProvider.future));
  } catch (_) {
    if (!demo) rethrow; // real failure → Home shows its retry state
  }

  final vendorLists = await Future.wait([
    for (final s in sectors.take(kHomeVendorSectorFanout))
      vendorRepo.getVendors(category: s.id).catchError((_) => <Vendor>[]),
  ]);
  var vendors = rankPopularVendors([for (final l in vendorLists) ...l]);

  final entries = <HomeProductEntry>[];
  final productLists = await Future.wait([
    for (final v in vendors.take(kHomeProductSourceVendors)) ...[
      productRepo
          .getProducts(v.id,
              sort: 'bestSelling', limit: kHomeProductsPerTagPerVendor)
          .catchError((_) => <Product>[]),
      productRepo
          .getProducts(v.id,
              sort: 'newest', limit: kHomeProductsPerTagPerVendor)
          .catchError((_) => <Product>[]),
    ],
  ]);
  final seen = <String>{};
  // productLists alternates [popular, new, popular, new, ...] per vendor;
  // interleave so the row genuinely mixes both.
  final popularLists = <List<Product>>[];
  final newLists = <List<Product>>[];
  for (var i = 0; i < productLists.length; i++) {
    (i.isEven ? popularLists : newLists).add(productLists[i]);
  }
  final maxLen =
      productLists.fold<int>(0, (m, l) => l.length > m ? l.length : m);
  for (var i = 0; i < maxLen; i++) {
    for (var k = 0; k < popularLists.length; k++) {
      if (i < popularLists[k].length && seen.add(popularLists[k][i].id)) {
        entries.add(HomeProductEntry(
            product: popularLists[k][i], tag: HomeProductTag.popular));
      }
      if (i < newLists[k].length && seen.add(newLists[k][i].id)) {
        entries.add(HomeProductEntry(
            product: newLists[k][i], tag: HomeProductTag.newItem));
      }
    }
  }
  var products = entries.take(kHomeMaxProductEntries).toList();

  var offers = buildOffers(vendors: vendors, products: products);
  var promos = buildPromos(offers);

  if (demo) {
    if (vendors.isEmpty) vendors = demoVendors();
    if (products.isEmpty) products = demoProductEntries();
    if (offers.isEmpty) offers = demoOffers();
    if (promos.isEmpty) promos = demoPromos();
  }

  return HomeSnapshot(
      popularVendors: vendors,
      productEntries: products,
      offers: offers,
      promos: promos);
});
