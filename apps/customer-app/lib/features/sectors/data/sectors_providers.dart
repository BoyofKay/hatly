import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/providers.dart';
import 'sectors_api.dart';
import '../domain/sector.dart';
import '../domain/subcategory.dart';

final sectorsApiProvider =
    Provider<SectorsApi>((ref) => SectorsApi(ref.watch(apiClientProvider)));

/// The Home category section's real data source — replaces the static
/// `categoryFixtures` list entirely.
final sectorsProvider =
    FutureProvider.autoDispose<List<MarketplaceSector>>((ref) {
  return ref.watch(sectorsApiProvider).getSectors();
});

/// Consolidated customer-commerce milestone, Part E — the subcategory
/// chip row's real data source on the Vendor List screen. `.family` by
/// sectorId so switching sectors (or Home's own preview, which never
/// requests this) gets its own independently-cached, independently-
/// erroring result.
final subcategoriesProvider = FutureProvider.autoDispose
    .family<List<MarketplaceSubcategory>, String>((ref, sectorId) {
  return ref.watch(sectorsApiProvider).getSubcategories(sectorId);
});
