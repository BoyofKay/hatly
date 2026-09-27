import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/providers.dart';
import 'sectors_api.dart';
import '../domain/sector.dart';

final sectorsApiProvider =
    Provider<SectorsApi>((ref) => SectorsApi(ref.watch(apiClientProvider)));

/// The Home category section's real data source — replaces the static
/// `categoryFixtures` list entirely.
final sectorsProvider =
    FutureProvider.autoDispose<List<MarketplaceSector>>((ref) {
  return ref.watch(sectorsApiProvider).getSectors();
});
