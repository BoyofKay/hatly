import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/network/providers.dart';
import '../../products/data/product_providers.dart';
import '../../products/data/product_repository.dart';
import '../../products/domain/product.dart';
import '../../sectors/data/sectors_providers.dart';
import '../../sectors/domain/sector.dart';
import '../../vendors/data/vendor_providers.dart';
import '../../vendors/domain/vendor.dart';
import '../domain/home_content.dart';
import 'home_content_config.dart';
import 'home_product_sections_api.dart';
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

// ---------------------------------------------------------------------------
// What each Home product section MEANS (one definition, used by the rows and by their "See all" lists)
// ---------------------------------------------------------------------------

/// "Most ordered": the product has really been delivered (the backend's order-based cache). Never an arbitrary product that
/// merely sorts first when nothing has been ordered yet.
bool isMostOrderedProduct(Product p) => p.hasBeenOrdered;

/// "New": created within [days] days. The backend has no configurable "new" flag, so recency is the definition — a product older
/// than the window is not new however a "newest first" sort orders it. A listing with no creation date is never called new.
bool isNewProduct(Product p, DateTime now,
    {int days = kHomeNewProductWindowDays}) {
  final created = p.createdAt;
  if (created == null) return false;
  final age = now.difference(created);
  return !age.isNegative && age < Duration(days: days);
}

/// "Offers": the product carries a currently valid offer. The backend only reports offers checkout would honour (valid window,
/// not exhausted, a real discount, never a weighed product), so presence is the whole test.
bool isOfferProduct(Product p) => p.activeOffer != null;

/// Interleaves per-vendor lists (so one vendor does not take the whole row), de-duplicates by product id and keeps only the
/// products that satisfy [qualifies]. Pure — unit-tested.
List<HomeProductEntry> composeSectionEntries(
  List<List<Product>> perVendor, {
  required bool Function(Product) qualifies,
  required HomeProductTag tag,
  int? max,
}) {
  final seen = <String>{};
  final out = <HomeProductEntry>[];
  final longest = perVendor.fold<int>(0, (m, l) => l.length > m ? l.length : m);
  for (var i = 0; i < longest; i++) {
    for (final list in perVendor) {
      if (i >= list.length) continue;
      final product = list[i];
      if (!qualifies(product) || !seen.add(product.id)) continue;
      out.add(HomeProductEntry(product: product, tag: tag));
      if (max != null && out.length >= max) return out;
    }
  }
  return out;
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
    this.failedSections = const {},
  });

  /// Sections the server could not produce this time (each is shown as its own retry card; the others render normally).
  final Set<HomeSectionKind> failedSections;

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

/// The products of ONE Home section, from the EXISTING per-branch product listing: each source vendor is asked for its own best
/// candidates for the section (`bestSelling` / `newest` / `hasOffers`), then the section's definition (above) decides what
/// qualifies — one failing vendor degrades to nothing for that vendor. Shared by the Home rows and their "See all" screens, so a
/// row and its list can never disagree about what the section means.
Future<List<HomeProductEntry>> loadHomeSection(
  ProductRepository repo,
  List<Vendor> vendors,
  HomeSectionKind kind, {
  required int perVendor,
  DateTime? now,
  int? max,
}) async {
  final lists = await Future.wait([
    for (final v in vendors)
      repo
          .getProducts(
            v.id,
            sort: kind == HomeSectionKind.mostOrdered
                ? 'bestSelling'
                : kind == HomeSectionKind.newest
                    ? 'newest'
                    : null,
            hasOffers: kind == HomeSectionKind.offers ? true : null,
            availableOnly: true,
            limit: perVendor,
          )
          .catchError((_) => <Product>[]),
  ]);
  final clock = now ?? DateTime.now();
  switch (kind) {
    case HomeSectionKind.mostOrdered:
      return composeSectionEntries(lists,
          qualifies: isMostOrderedProduct,
          tag: HomeProductTag.popular,
          max: max);
    case HomeSectionKind.newest:
      return composeSectionEntries(lists,
          qualifies: (p) => isNewProduct(p, clock),
          tag: HomeProductTag.newItem,
          max: max);
    case HomeSectionKind.offers:
      return composeSectionEntries(lists,
          qualifies: isOfferProduct, tag: HomeProductTag.offer, max: max);
  }
}

/// The full list behind a Home section's "See all" — the same definition as the row, with more products per vendor.
final homeSectionProductsProvider = FutureProvider.autoDispose
    .family<List<HomeProductEntry>, HomeSectionKind>((ref, kind) async {
  final vendorRepo = ref.watch(vendorRepositoryProvider);
  final productRepo = ref.watch(productRepositoryProvider);
  final sectors = orderHomeCategories(await ref.watch(sectorsProvider.future));
  final vendorLists = await Future.wait([
    for (final s in sectors.take(kHomeVendorSectorFanout))
      vendorRepo.getVendors(category: s.id).catchError((_) => <Vendor>[]),
  ]);
  final vendors = rankPopularVendors([for (final l in vendorLists) ...l],
      count: kHomeSectionSourceVendors);
  return loadHomeSection(productRepo, vendors, kind,
      perVendor: kHomeSeeAllProductsPerVendor);
});

final homeProductSectionsApiProvider = Provider<HomeProductSectionsApi>(
    (ref) => HomeProductSectionsApi(ref.watch(apiClientProvider)));

/// Everything below the categories: the Offers, Most ordered and New rows (and the promos derived from the offers). It is ONE request to
/// `GET /home/product-sections` — the server composes the three sections (and caches them), where the app used to make three vendor-list
/// requests followed by eighteen per-vendor product requests. A section the server could not produce is listed in
/// [HomeSnapshot.failedSections] and the other sections are unaffected; a whole-request failure is the snapshot's error.
/// Against a backend that predates the endpoint (404) the previous multi-request composition is used, so an app released before its
/// backend still shows Home.
final homeSnapshotProvider =
    FutureProvider.autoDispose<HomeSnapshot>((ref) async {
  final demo = ref.watch(homeDemoEnabledProvider);
  HomeProductSectionsResult? result;
  try {
    result = await ref.watch(homeProductSectionsApiProvider).fetch();
  } on ApiException catch (error) {
    if (error.statusCode == 404 && !demo) return _legacyHomeSnapshot(ref);
    if (!demo) rethrow; // real failure → Home shows its retry state
  }

  List<HomeProductEntry> entries(HomeSectionKind kind, HomeProductTag tag) => [
        for (final p in result?.sections[kind]?.products ?? const <Product>[])
          HomeProductEntry(product: p, tag: tag)
      ];
  final failed = <HomeSectionKind>{
    if (result != null)
      for (final kind in HomeSectionKind.values)
        if (result.sections[kind] == null || result.sections[kind]!.failed)
          kind,
  };
  final ranked = result?.vendors ?? const <Vendor>[];
  final vendors = ranked.take(kHomePopularVendorCount).toList();
  var products = [
    ...entries(HomeSectionKind.mostOrdered, HomeProductTag.popular)
        .take(kHomeMaxProductEntries),
    ...entries(HomeSectionKind.newest, HomeProductTag.newItem)
        .take(kHomeMaxProductEntries),
  ];
  var offers = buildOffers(vendors: ranked, products: [
    ...entries(HomeSectionKind.offers, HomeProductTag.offer),
    ...products
  ]);
  var promos = buildPromos(offers);

  var popularVendors = vendors;
  if (demo) {
    if (popularVendors.isEmpty) popularVendors = demoVendors();
    if (products.isEmpty) products = demoProductEntries();
    if (offers.isEmpty) offers = demoOffers();
    if (promos.isEmpty) promos = demoPromos();
  }

  return HomeSnapshot(
      popularVendors: popularVendors,
      productEntries: products,
      offers: offers,
      promos: promos,
      failedSections: failed);
});

/// The previous composition (sectors → vendor lists → per-vendor product lists), kept only as the fallback for a backend without the
/// aggregation endpoint.
Future<HomeSnapshot> _legacyHomeSnapshot(Ref ref) async {
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
  final ranked = rankPopularVendors([for (final l in vendorLists) ...l],
      count: kHomeSectionSourceVendors > kHomePopularVendorCount
          ? kHomeSectionSourceVendors
          : kHomePopularVendorCount);
  var vendors = ranked.take(kHomePopularVendorCount).toList();

  // Each section is queried on its OWN terms (see the definitions above), so "Offers" is not limited to whatever happened to be in
  // the other two rows, and "Most ordered" / "New" only ever contain products that really are.
  final now = DateTime.now();
  final sections = await Future.wait([
    loadHomeSection(productRepo, ranked, HomeSectionKind.mostOrdered,
        perVendor: kHomeRowProductsPerVendor, now: now),
    loadHomeSection(productRepo, ranked, HomeSectionKind.newest,
        perVendor: kHomeRowProductsPerVendor, now: now),
    loadHomeSection(productRepo, ranked, HomeSectionKind.offers,
        perVendor: kHomeRowProductsPerVendor, now: now),
  ]);
  var products = [
    ...sections[0].take(kHomeMaxProductEntries),
    ...sections[1].take(kHomeMaxProductEntries),
  ];

  var offers =
      buildOffers(vendors: ranked, products: [...sections[2], ...products]);
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
}
