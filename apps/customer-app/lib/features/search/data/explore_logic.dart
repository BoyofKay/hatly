import '../../sectors/domain/sector.dart';
import '../../vendors/domain/vendor.dart';
import 'explore_content_config.dart';

/// Pure composition helpers for Explore (unit-tested; no I/O).

String _fold(String s) => s.trim().toLowerCase();

/// Categories whose Arabic or English name contains [query] (case-insensitive).
/// Local matching against the already-loaded category list — there is no
/// category-search endpoint. Order is preserved; below
/// [kExploreMinQueryLength] characters nothing matches.
List<MarketplaceSector> matchCategories(
  String query,
  List<MarketplaceSector> categories,
) {
  final q = _fold(query);
  if (q.length < kExploreMinQueryLength) return const [];
  return [
    for (final c in categories)
      if (_fold(c.name).contains(q) ||
          (c.nameAr != null && _fold(c.nameAr!).contains(q)))
        c,
  ];
}

/// The subset of the (already ordered) categories surfaced in "Featured
/// categories": pinned slugs first, then the rest in existing order, capped at
/// [count]. Empty when there are fewer than [minTotal] categories.
List<MarketplaceSector> featuredCategories(
  List<MarketplaceSector> ordered, {
  List<String> pinnedSlugs = kExploreFeaturedCategorySlugs,
  int count = kExploreFeaturedCategoryCount,
  int minTotal = kExploreFeaturedCategoryMinTotal,
}) {
  if (ordered.length < minTotal) return const [];
  final pinned = <MarketplaceSector>[
    for (final slug in pinnedSlugs) ...ordered.where((c) => c.slug == slug),
  ];
  final rest = ordered.where((c) => !pinned.contains(c));
  return [...pinned, ...rest].take(count).toList();
}

/// Merges per-sector "newest first" vendor lists into one list by taking the
/// newest of each sector in turn (round-robin). The vendor listing exposes no
/// creation timestamp, so a true global "newest" order cannot be computed —
/// this keeps every sector's own newest-first order without inventing one.
/// Duplicates (same vendor id) are dropped.
List<Vendor> interleaveNewestVendors(
  List<List<Vendor>> perSector, {
  int max = kExploreNewVendorCount,
}) {
  final out = <Vendor>[];
  final seen = <String>{};
  final longest = perSector.fold<int>(0, (m, l) => l.length > m ? l.length : m);
  for (var i = 0; i < longest && out.length < max; i++) {
    for (final list in perSector) {
      if (i < list.length && seen.add(list[i].id)) {
        out.add(list[i]);
        if (out.length >= max) break;
      }
    }
  }
  return out;
}
