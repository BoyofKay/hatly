import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/providers.dart';
import '../../../core/location/device_location_service.dart';
import '../../auth/presentation/auth_gate.dart';
import 'addresses_api.dart';
import '../domain/delivery_zone.dart';
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
    FutureProvider.autoDispose<List<SavedAddress>>((ref) async {
  // A guest has no saved addresses (and Home / Explore / vendor listing read this provider): answer without a request.
  if (!ref.watch(isSignedInProvider)) return const <SavedAddress>[];
  return ref.watch(addressesApiProvider).getAddresses();
});

/// The active Delivery Zones from the backend (PD-009) — the only source of the zone dropdown.
final deliveryZonesProvider =
    FutureProvider.autoDispose<List<DeliveryZone>>((ref) {
  return ref.watch(addressesApiProvider).getDeliveryZones();
});

/// Which address methods can be offered right now (GPS needs the road-distance provider and the Admin pricing; the manual method
/// needs an active delivery area). Never assumed: GPS is offered only when the backend says so.
final addressCapabilitiesProvider =
    FutureProvider.autoDispose<AddressCapabilities>((ref) {
  return ref.watch(addressesApiProvider).getCapabilities();
});
