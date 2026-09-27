import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/providers.dart';
import '../presentation/driver_location_service.dart';
import '../domain/delivery.dart';
import 'driver_api.dart';

final driverApiProvider = Provider<DriverApi>((ref) => DriverApi(ref.watch(apiClientProvider)));

final driverLocationServiceProvider = Provider<DriverLocationService>((ref) => DriverLocationService());

/// CONFIRMED (approved requirements): GPS reporting runs only while
/// ONLINE, foreground only (a plain periodic `Timer` — no background
/// service exists or is added). Going online/offline both call the
/// real `PATCH driver/online-status` first — the location timer only
/// starts/stops after that call succeeds, so the two can never drift
/// out of sync with the backend's own view of the driver's state.
class DriverOnlineStateNotifier extends StateNotifier<AsyncValue<bool>> {
  DriverOnlineStateNotifier(this._driverApi, this._locationService) : super(const AsyncValue.data(false));

  final DriverApi _driverApi;
  final DriverLocationService _locationService;

  Future<void> setOnline(bool isOnline) async {
    state = const AsyncValue.loading();
    try {
      await _driverApi.setOnlineStatus(isOnline);
      if (isOnline) {
        _locationService.start((position) {
          // Best-effort — a single failed location ping is not shown
          // as an error to the driver; the next periodic tick retries.
          _driverApi.updateLocation(latitude: position.latitude, longitude: position.longitude).catchError((_) {});
        });
      } else {
        _locationService.stop();
      }
      state = AsyncValue.data(isOnline);
    } catch (error, stackTrace) {
      _locationService.stop();
      state = AsyncValue.error(error, stackTrace);
    }
  }

  /// Called on logout — CONFIRMED: stop the location timer and reset
  /// local state; does not itself call the online-status API (not
  /// part of the approved logout behavior — "stop location timer →
  /// clear session → return to login").
  void resetOnLogout() {
    _locationService.stop();
    state = const AsyncValue.data(false);
  }
}

final driverOnlineStateProvider = StateNotifierProvider<DriverOnlineStateNotifier, AsyncValue<bool>>((ref) {
  return DriverOnlineStateNotifier(ref.watch(driverApiProvider), ref.watch(driverLocationServiceProvider));
});

final deliveriesProvider = FutureProvider.autoDispose<List<Delivery>>((ref) {
  return ref.watch(driverApiProvider).listDeliveries();
});

final deliveryDetailProvider = FutureProvider.autoDispose.family<Delivery, String>((ref, deliveryId) {
  return ref.watch(driverApiProvider).getDelivery(deliveryId);
});
