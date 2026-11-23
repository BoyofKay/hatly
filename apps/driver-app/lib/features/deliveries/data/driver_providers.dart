import 'dart:typed_data';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import '../../../core/network/providers.dart';
import '../presentation/driver_location_service.dart';
import '../presentation/driver_polling_service.dart';
import '../presentation/proof_of_delivery_sheet.dart';
import '../../earnings/domain/earnings.dart';
import '../domain/delivery.dart';
import 'driver_api.dart';

final Provider<DriverApi> driverApiProvider =
    Provider<DriverApi>((ref) => DriverApi(ref.watch(apiClientProvider)));

final driverLocationServiceProvider =
    Provider<DriverLocationService>((ref) => DriverLocationService());

/// M4 — Proof of Delivery. The REAL photo picker (device camera) — a Riverpod
/// provider, not a widget-constructor default, specifically so a widget test that
/// pumps `DeliveryDetailScreen` as a whole (not `ProofOfDeliverySheet` in
/// isolation) can override it, the exact same pattern already established for
/// `driverLocationServiceProvider`/`Geolocator` (no platform channel in tests).
Future<({Uint8List bytes, String filename})?> _pickPhotoFromCamera() async {
  // Downscaled on the device (long edge 1600 px): a full-resolution camera photo is several MB of mobile data and server
  // memory; 1600 px is ample to read a delivery proof.
  final picked = await ImagePicker().pickImage(
      source: ImageSource.camera,
      imageQuality: 85,
      maxWidth: 1600,
      maxHeight: 1600);
  if (picked == null) return null;
  return (bytes: await picked.readAsBytes(), filename: picked.name);
}

final proofOfDeliveryPhotoPickerProvider =
    Provider<PickPhotoBytes>((ref) => _pickPhotoFromCamera);

/// CONFIRMED (approved requirements): GPS reporting runs only while
/// ONLINE, foreground only (a plain periodic `Timer` — no background
/// service exists or is added). Going online/offline both call the
/// real `PATCH driver/online-status` first — the location timer only
/// starts/stops after that call succeeds, so the two can never drift
/// out of sync with the backend's own view of the driver's state.
class DriverOnlineStateNotifier extends StateNotifier<AsyncValue<bool>> {
  DriverOnlineStateNotifier(this._driverApi, this._locationService)
      : super(const AsyncValue.data(false));

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
          _driverApi
              .updateLocation(
                  latitude: position.latitude, longitude: position.longitude)
              .catchError((_) {});
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

  /// Owner report (2026-11-15): after closing and reopening the app the switch showed OFFLINE although the server still had the driver
  /// online (and dispatching to him) — the switch only ever started at `false`. This reads the server's switch on launch and whenever the
  /// app comes back to the front, and starts / stops the location timer to match. Never while a toggle is in flight; an unreadable status
  /// changes nothing.
  Future<void> syncFromServer() async {
    if (state.isLoading) return;
    final serverOnline = await _driverApi.getOnlineStatus();
    if (serverOnline == null || state.isLoading) return;
    if (serverOnline) {
      _startLocation();
    } else {
      _locationService.stop();
    }
    state = AsyncValue.data(serverOnline);
  }

  void _startLocation() {
    _locationService.start((position) {
      _driverApi
          .updateLocation(latitude: position.latitude, longitude: position.longitude)
          .catchError((_) {});
    });
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

final StateNotifierProvider<DriverOnlineStateNotifier, AsyncValue<bool>>
    driverOnlineStateProvider =
    StateNotifierProvider<DriverOnlineStateNotifier, AsyncValue<bool>>((ref) {
  return DriverOnlineStateNotifier(
      ref.watch(driverApiProvider), ref.watch(driverLocationServiceProvider));
});

final deliveriesProvider = FutureProvider.autoDispose<List<Delivery>>((ref) {
  return ref.watch(driverApiProvider).listDeliveries();
});

/// R17: Operations phone for the "Call Operations" button (null hides it). Cached for the session; a failure just hides the button.
final operationsPhoneProvider = FutureProvider<String?>((ref) async {
  try {
    return await ref.watch(driverApiProvider).getOperationsPhone();
  } catch (_) {
    return null;
  }
});

final deliveryDetailProvider =
    FutureProvider.autoDispose.family<Delivery, String>((ref, deliveryId) {
  return ref.watch(driverApiProvider).getDelivery(deliveryId);
});

/// M4 — Driver polling / refresh fallback. A fresh instance per screen that
/// keeps it alive (Home, Delivery Detail — each `ref.watch`es this once,
/// purely to establish the keep-alive subscription for its own lifetime) —
/// `autoDispose` stops the timer (via `ref.onDispose`) the moment that
/// screen goes away, so a poll can never outlive the screen that started it
/// or keep running after logout navigates away from it.
final driverPollingServiceProvider =
    Provider.autoDispose<DriverPollingService>((ref) {
  final service = DriverPollingService();
  ref.onDispose(service.dispose);
  return service;
});

/// The driver's recorded money (open-period preview + closed periods). Re-read when the screen is opened or refreshed.
final earningsProvider = FutureProvider.autoDispose<DriverEarnings>((ref) => ref.watch(driverApiProvider).getEarnings());

/// Read-only Admin-managed driver display name. Refreshed across navigation/session reloads.
final driverProfileNameProvider = FutureProvider.autoDispose<String?>((ref) async {
  return ref.watch(driverApiProvider).getProfileName();
});
