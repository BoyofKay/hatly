import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/providers.dart';
import '../../../core/location/device_location_service.dart';
import 'addresses_api.dart';
import '../domain/saved_address.dart';

final addressesApiProvider =
    Provider<AddressesApi>((ref) => AddressesApi(ref.watch(apiClientProvider)));

final deviceLocationServiceProvider =
    Provider<DeviceLocationService>((ref) => const DeviceLocationService());

/// Refreshed explicitly (see `AddressListScreen`'s own create/deactivate
/// handlers calling `ref.invalidate`) rather than via a stateful
/// controller — the list is small and read-then-occasionally-written,
/// matching the simplicity already used for `productCategoriesProvider`.
final savedAddressesProvider =
    FutureProvider.autoDispose<List<SavedAddress>>((ref) {
  return ref.watch(addressesApiProvider).getAddresses();
});
