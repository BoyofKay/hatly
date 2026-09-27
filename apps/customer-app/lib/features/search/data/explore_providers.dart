import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../home/data/home_address_provider.dart';
import '../../home/data/home_demo_content.dart';
import '../../home/data/home_providers.dart';
import '../../sectors/domain/sector.dart';
import '../../vendors/data/vendor_providers.dart';
import '../../vendors/domain/vendor.dart';
import 'explore_content_config.dart';
import 'explore_logic.dart';

/// "New on Hatly" vendors — the EXISTING paginated vendor listing with
/// `sort=newest`, fanned out over the first sectors (the API has no
/// cross-sector listing) and interleaved by [interleaveNewestVendors]. One
/// failing sector degrades to nothing for that sector instead of failing the
/// section. Demo vendors appear only when demo content is enabled and the real
/// data is empty.
///
/// Featured vendors, offers and new products come from [homeSnapshotProvider]
/// (the same real sources Home uses); this is the only extra call Explore adds.
final exploreNewVendorsProvider =
    FutureProvider.autoDispose<List<Vendor>>((ref) async {
  final demo = ref.watch(homeDemoEnabledProvider);
  final repo = ref.watch(vendorRepositoryProvider);
  final address = ref.watch(homeActiveAddressProvider).valueOrNull;

  var sectors = const <MarketplaceSector>[];
  try {
    sectors = await ref.watch(homeCategoriesProvider.future);
  } catch (_) {
    if (!demo) rethrow;
  }

  final pages = await Future.wait([
    for (final s in sectors.take(kExploreNewVendorSectorFanout))
      repo
          .getVendorsPage(
            s.id,
            sort: 'newest',
            limit: kExploreNewVendorsPerSector,
            latitude: address?.latitude,
            longitude: address?.longitude,
          )
          .then((page) => page.data)
          .catchError((_) => <Vendor>[]),
  ]);

  final vendors = interleaveNewestVendors(pages);
  if (vendors.isEmpty && demo) {
    return demoVendors().take(kExploreNewVendorCount).toList();
  }
  return vendors;
});
